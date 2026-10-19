const encoder = new TextEncoder();
const DOMAIN = encoder.encode('phpffmpeg-ctr-hmac-v2\n');
const MAX_RECORD = 65536;
const FINAL = 0x80000000;
let aesKey;
let hmacKey;
let preamble;
let baseCounter;
let nextSequence = 0;
let sawFinal = false;

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function bytesToBigInt(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function counterFor(sequence, byteLength) {
  const start = bytesToBigInt(baseCounter) + BigInt(sequence) * 4096n;
  const last = start + BigInt(Math.ceil(byteLength / 16) - 1);
  if (last >= (1n << 128n)) throw new Error('AES-CTR counter overflow');
  return Uint8Array.from(start.toString(16).padStart(32, '0').match(/../g), pair => Number.parseInt(pair, 16));
}

function validatePreamble(bytes) {
  if (bytes.length !== 40 || new TextDecoder().decode(bytes.subarray(0, 8)) !== 'PFFHLS2\n') throw new Error('Invalid CTR/HMAC V2 preamble');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(22, false) !== 0 || view.getUint16(16, false) > 1023 || view.getUint16(18, false) === 0) throw new Error('Invalid CTR/HMAC V2 preamble fields');
}

async function handle(message) {
  if (message.type === 'init') {
    const master = new Uint8Array(message.masterKey);
    preamble = new Uint8Array(message.preamble).slice();
    validatePreamble(preamble);
    if (master.length !== 32) throw new Error('CTR/HMAC V2 master key must be exactly 32 bytes');
    if (message.assetIdBytes && !equal(preamble.subarray(8, 16), new Uint8Array(message.assetIdBytes))) throw new Error('Preamble assetId mismatch');
    if (message.keyId !== undefined && new DataView(preamble.buffer).getUint16(16, false) !== message.keyId) throw new Error('Preamble keyId mismatch');
    const salt = preamble.subarray(24, 40);
    const context = preamble.subarray(8, 22);
    const aesInfo = concat(encoder.encode('phpffmpeg-ctr-hmac-v2\0aes-128-ctr\0'), context);
    const macInfo = concat(encoder.encode('phpffmpeg-ctr-hmac-v2\0hmac-sha256\0'), context);
    const material = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveKey']);
    aesKey = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: aesInfo }, material, { name: 'AES-CTR', length: 128 }, false, ['decrypt']);
    hmacKey = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: macInfo }, material, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['verify']);
    master.fill(0);
    baseCounter = null;
    nextSequence = 0;
    sawFinal = false;
    return { ready: true };
  }
  if (message.type === 'decrypt') {
    if (sawFinal) throw new Error('Data received after final record');
    if (!aesKey || !hmacKey || (baseCounter === null && nextSequence !== 0)) throw new Error('Worker is not initialized');
    const bytes = new Uint8Array(message.record);
    if (bytes.length < 57) throw new Error('Truncated V2 record');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sequence = view.getUint32(0, false);
    const counter = bytes.subarray(4, 20);
    const lengthAndFlags = view.getUint32(20, false);
    const isFinal = (lengthAndFlags & FINAL) !== 0;
    const length = lengthAndFlags & 0x7fffffff;
    if (length < 1 || length > MAX_RECORD || bytes.length !== 24 + length + 32) throw new Error('Invalid V2 record length');
    if (sequence !== nextSequence) throw new Error(`Out-of-order V2 record ${sequence}; expected ${nextSequence}`);
    if (sequence > 0xffffffff) throw new Error('V2 record sequence overflow');
    if (sequence === 0 && baseCounter === null) baseCounter = counter.slice();
    if (!equal(counter, counterFor(sequence, length))) throw new Error('V2 record counter is inconsistent');
    const header = bytes.subarray(0, 24);
    const ciphertext = bytes.subarray(24, 24 + length);
    const tag = bytes.subarray(24 + length);
    const valid = await crypto.subtle.verify('HMAC', hmacKey, tag, concat(DOMAIN, preamble, header, ciphertext));
    if (!valid) throw new Error('V2 record authentication failed');
    const clear = await crypto.subtle.decrypt({ name: 'AES-CTR', counter, length: 128 }, aesKey, ciphertext);
    nextSequence += 1;
    sawFinal = isFinal;
    const result = { sequence, final: isFinal, clear };
    if (isFinal) {
      aesKey = null;
      hmacKey = null;
      baseCounter = null;
    }
    return result;
  }
  if (message.type === 'finish') {
    if (!sawFinal) throw new Error('V2 object ended without authenticated FINAL record');
    return { complete: true, recordCount: nextSequence };
  }
  throw new Error('Unsupported V2 worker operation');
}

function equal(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}

self.addEventListener('message', event => {
  const { id, ...message } = event.data;
  Promise.resolve().then(() => handle(message)).then(
    result => self.postMessage({ id, result }, result?.clear ? [result.clear] : []),
    error => {
      aesKey = null;
      hmacKey = null;
      preamble = null;
      baseCounter = null;
      nextSequence = 0;
      sawFinal = false;
      self.postMessage({ id, error: error.message });
    },
  );
});
