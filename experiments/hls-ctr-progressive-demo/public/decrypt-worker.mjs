import { Sha256Stream } from './sha256-stream.mjs';

const DOMAIN = new TextEncoder().encode('php-ffmpeg-hls-ctr-demo-v1\n');
let aesKey;
let hmacKey;
let contentIdBytes;
let baseCounter;
let records;
let clearHash;

function concat(...arrays) {
  const size = arrays.reduce((total, value) => total + value.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const value of arrays) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function equal(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

function addCounter(base64, sequence) {
  const base = BigInt(`0x${Array.from(atob(base64), (char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`);
  const value = base + BigInt(sequence) * 4096n;
  if (value >= (1n << 128n)) throw new Error('CTR counter overflow');
  const hex = value.toString(16).padStart(32, '0');
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
}

function decodeBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function handleMessage(message) {
  if (message.type === 'init') {
    aesKey = await crypto.subtle.importKey('raw', decodeBase64(message.aesCtrKey), 'AES-CTR', false, ['decrypt']);
    hmacKey = await crypto.subtle.importKey(
      'raw', decodeBase64(message.hmacKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    contentIdBytes = new TextEncoder().encode(message.contentId);
    baseCounter = message.baseCounter;
    records = message.records;
    clearHash = new Sha256Stream();
    return { ready: true };
  }
  if (message.type === 'finish') return { clearSha256: clearHash.digestHex() };

  const recordBytes = new Uint8Array(message.record);
  if (recordBytes.length < 56) throw new Error('Record is shorter than header and tag');
  const view = new DataView(recordBytes.buffer, recordBytes.byteOffset, recordBytes.byteLength);
  const sequence = view.getUint32(0, false);
  const counter = recordBytes.subarray(4, 20);
  const length = view.getUint32(20, false);
  if (length > 65_536 || recordBytes.length !== 24 + length + 32) throw new Error('Invalid record length');
  const expected = records[sequence];
  if (!expected || expected.sequence !== sequence || expected.ciphertextLength !== length || expected.tagLength !== 32) {
    throw new Error(`Record ${sequence} does not match sidecar metadata`);
  }
  if (!equal(counter, decodeBase64(expected.counter))) throw new Error(`Record ${sequence} has an unexpected counter`);
  if (!equal(counter, addCounter(baseCounter, sequence))) throw new Error(`Record ${sequence} counter is inconsistent`);

  const header = recordBytes.subarray(0, 24);
  const ciphertext = recordBytes.subarray(24, 24 + length);
  const tag = recordBytes.subarray(24 + length);
  const authenticated = concat(DOMAIN, contentIdBytes, new Uint8Array([0]), header, ciphertext);
  const valid = await crypto.subtle.verify('HMAC', hmacKey, tag, authenticated);
  if (!valid) throw new Error(`Record ${sequence} authentication failed`);

  const clear = await crypto.subtle.decrypt(
    { name: 'AES-CTR', counter, length: 128 },
    aesKey,
    ciphertext,
  );
  clearHash.update(new Uint8Array(clear));
  return { sequence, clear };
}

self.addEventListener('message', (event) => {
  const { id, ...message } = event.data;
  handleMessage(message)
    .then((result) => self.postMessage({ id, result }, result?.clear ? [result.clear] : []))
    .catch((error) => self.postMessage({ id, error: error.message, stack: error.stack }));
});
