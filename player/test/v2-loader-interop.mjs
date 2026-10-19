import assert from 'node:assert/strict';
import { createCipheriv, createHmac, hkdfSync } from 'node:crypto';
import { V2CtrFragmentLoader } from '../src/v2-fragment-loader.js';
import { PlaybackProfile, RequestPurpose } from '../src/constants.js';

const masterKey = Buffer.from(Array.from({ length: 32 }, (_value, index) => index));
const info = {
  profile: PlaybackProfile.CTR_HMAC_V2,
  assetId: '42',
  keyId: 7,
  versionId: 'version-test',
  keyUri: 'https://app.example.test/key',
  masterPlaylistUri: 'https://cdn.example.test/master.m3u8',
};

function box(type, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(type, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function makeObject(clear) {
  const contentId = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
  const baseCounter = Buffer.alloc(16);
  const preamble = Buffer.concat([
    Buffer.from('PFFHLS2\n'), Buffer.from('000000000000002a', 'hex'),
    Buffer.from([0, 7, 2, 208, 0, 0, 0, 0]), contentId,
  ]);
  const context = preamble.subarray(8, 22);
  const aesKey = Buffer.from(hkdfSync('sha256', masterKey, contentId, Buffer.concat([Buffer.from('phpffmpeg-ctr-hmac-v2\0aes-128-ctr\0'), context]), 16));
  const macKey = Buffer.from(hkdfSync('sha256', masterKey, contentId, Buffer.concat([Buffer.from('phpffmpeg-ctr-hmac-v2\0hmac-sha256\0'), context]), 32));
  const chunks = [];
  for (let offset = 0, sequence = 0; offset < clear.length; offset += 65536, sequence += 1) {
    const plain = clear.subarray(offset, Math.min(offset + 65536, clear.length));
    const counter = Buffer.from((BigInt(`0x${baseCounter.toString('hex')}`) + BigInt(sequence) * 4096n).toString(16).padStart(32, '0'), 'hex');
    const cipher = createCipheriv('aes-128-ctr', aesKey, counter);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const header = Buffer.alloc(24);
    header.writeUInt32BE(sequence, 0);
    counter.copy(header, 4);
    header.writeUInt32BE(ciphertext.length + (offset + plain.length === clear.length ? 0x80000000 : 0), 20);
    const tag = createHmac('sha256', macKey).update('phpffmpeg-ctr-hmac-v2\n').update(preamble).update(header).update(ciphertext).digest();
    chunks.push(Buffer.concat([header, ciphertext, tag]));
  }
  return { object: Buffer.concat([preamble, ...chunks]), recordChunks: [Buffer.concat(chunks.slice(0, 1)), ...chunks.slice(1)] };
}

const firstClear = Buffer.concat([box('moof', Buffer.alloc(0)), box('mdat', Buffer.alloc(65520, 0x51))]);
assert.equal(firstClear.length, 65536);
const secondClear = Buffer.concat([box('moof', Buffer.alloc(0)), box('mdat', Buffer.from('tail'))]);
const clear = Buffer.concat([firstClear, secondClear]);
const encrypted = makeObject(clear);
const wireChunks = [encrypted.object.subarray(0, 40), ...encrypted.recordChunks];

let workerMessageHandler;
const workerBus = { current: null };
globalThis.self = {
  addEventListener: (_type, callback) => { workerMessageHandler = callback; },
  postMessage: data => workerBus.current?.emit('message', { data }),
};
await import('../src/v2-record-worker.js');
globalThis.Worker = class FakeWorker {
  constructor() { this.listeners = new Map(); workerBus.current = this; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  postMessage(data) { queueMicrotask(() => workerMessageHandler({ data })); }
  emit(type, event) { this.listeners.get(type)?.(event); }
  terminate() { if (workerBus.current === this) workerBus.current = null; }
};

const originalFetch = globalThis.fetch;
async function runObject(objectChunks, onProgress = () => {}) {
  const requests = [];
  let sent = 0;
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    const stream = new ReadableStream({
      pull(controller) {
        if (sent >= objectChunks.length) { controller.close(); return; }
        controller.enqueue(new Uint8Array(objectChunks[sent++]));
      },
    }, { highWaterMark: 0 });
    return new Response(stream, { status: 200, headers: { 'content-length': String(objectChunks.reduce((sum, chunk) => sum + chunk.length, 0)), etag: '"fixture-etag"' } });
  };
  const loader = new V2CtrFragmentLoader({ playbackInfo: info, masterKey: new Uint8Array(masterKey), requestOptions: async request => { assert.equal(request.purpose, RequestPurpose.SEGMENT); return {}; } });
  try {
    const result = await new Promise((resolve, reject) => loader.load(
      { url: 'https://cdn.example.test/media/000000000000002a/7/720/version-test/abc-00000.m4s?sig=keep', frag: { level: 0, sn: 0 } },
      {},
      {
        onProgress: (_stats, _context, data) => onProgress(new Uint8Array(data), sent),
        onSuccess: (...args) => resolve(args),
        onError: response => reject(new Error(response.text)),
        onAbort: () => reject(new Error('unexpected abort')),
      },
    ));
    return { requests, result, sent };
  } finally {
    loader.destroy();
    globalThis.fetch = originalFetch;
  }
}

const emitted = [];
const success = await runObject(wireChunks, (fragment, chunksSent) => emitted.push({ fragment: Buffer.from(fragment), chunksSent }));
assert.deepEqual(emitted.map(item => item.fragment), [firstClear, secondClear]);
assert.equal(emitted[0].chunksSent, 2, 'the first complete MP4 unit must be emitted before the final record is read');
assert.equal(success.requests.length, 1);
assert.equal(success.requests[0].url, 'https://cdn.example.test/media/000000000000002a/7/720/version-test/abc-00000.m4s?sig=keep');
assert.equal(success.requests.some(request => request.url.endsWith('.json')), false);
assert.equal(success.result[0].data.byteLength, 0, 'MSE payload is delivered only through complete progressive media-unit callbacks');

const corruptedRecords = encrypted.recordChunks.map(chunk => Buffer.from(chunk));
corruptedRecords[0][24] ^= 1;
const failedAppends = [];
await assert.rejects(runObject([wireChunks[0], ...corruptedRecords], fragment => failedAppends.push(fragment)), /authentication failed/);
assert.equal(failedAppends.length, 0, 'an unauthenticated record must not produce a media append');

console.log('CTR/HMAC V2 loader streams authenticated MP4 units without sidecars and fails closed on tampering.');
