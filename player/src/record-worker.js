import { Sha256Stream } from './sha256-stream.js';

const PROFILE = 'phpffmpeg-ctr-hmac-v1';
const DOMAIN = new TextEncoder().encode(`${PROFILE}\n`);
const encoder = new TextEncoder();
let aesKey;
let hmacKey;
let contentId;
let baseCounter;
let records;
let clearHash;

function concat(...values) {
  const size = values.reduce((total, value) => total + value.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function decodeBase64(value) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

function addCounter(base, sequence) {
  const value = BigInt(`0x${Array.from(base, byte => byte.toString(16).padStart(2, '0')).join('')}`)
    + BigInt(sequence) * 4096n;
  if (value >= (1n << 128n)) throw new Error('AES-CTR counter overflow');
  const hex = value.toString(16).padStart(32, '0');
  return Uint8Array.from(hex.match(/../g), pair => Number.parseInt(pair, 16));
}

async function deriveKey(masterKey, info, algorithm, usages) {
  const material = await crypto.subtle.importKey('raw', masterKey, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(contentId), info: encoder.encode(info) },
    material,
    algorithm,
    false,
    usages,
  );
}

async function handle(message) {
  if (message.type === 'init') {
    contentId = message.contentId;
    baseCounter = decodeBase64(message.baseCounter);
    records = message.records;
    const masterKey = new Uint8Array(message.masterKey);
    if (masterKey.byteLength !== 32) throw new Error('CTR/HMAC V1 master key must be 32 bytes');
    aesKey = await deriveKey(masterKey, `${PROFILE}\0aes-128-ctr`, { name: 'AES-CTR', length: 128 }, ['decrypt']);
    hmacKey = await deriveKey(masterKey, `${PROFILE}\0hmac-sha256`, { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['verify']);
    masterKey.fill(0);
    clearHash = new Sha256Stream();
    return { ready: true };
  }
  if (message.type === 'finish') return { clearSha256: clearHash.digestHex() };

  const bytes = new Uint8Array(message.record);
  if (bytes.length < 56) throw new Error('Record is shorter than its header and tag');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sequence = view.getUint32(0, false);
  const counter = bytes.subarray(4, 20);
  const length = view.getUint32(20, false);
  if (length > 65536 || bytes.length !== 24 + length + 32) throw new Error('Invalid record length');
  const expected = records[sequence];
  if (!expected || expected.sequence !== sequence || expected.ciphertextLength !== length || expected.tagLength !== 32) {
    throw new Error(`Record ${sequence} does not match sidecar metadata`);
  }
  if (base64(counter) !== expected.counter || base64(addCounter(baseCounter, sequence)) !== expected.counter) {
    throw new Error(`Record ${sequence} counter is inconsistent`);
  }

  const header = bytes.subarray(0, 24);
  const ciphertext = bytes.subarray(24, 24 + length);
  const tag = bytes.subarray(24 + length);
  const authenticated = concat(DOMAIN, encoder.encode(contentId), new Uint8Array([0]), header, ciphertext);
  if (!await crypto.subtle.verify('HMAC', hmacKey, tag, authenticated)) {
    throw new Error(`Record ${sequence} authentication failed`);
  }
  const clear = await crypto.subtle.decrypt({ name: 'AES-CTR', counter, length: 128 }, aesKey, ciphertext);
  clearHash.update(new Uint8Array(clear));
  return { sequence, clear };
}

function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

self.addEventListener('message', event => {
  const { id, ...message } = event.data;
  Promise.resolve().then(() => handle(message)).then(
    result => self.postMessage({ id, result }, result?.clear ? [result.clear] : []),
    error => self.postMessage({ id, error: error.message }),
  );
});
