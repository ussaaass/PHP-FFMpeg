import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(process.argv[2] || 'player/.test-output');
const vector = JSON.parse(await readFile(new URL('../../tests/fixtures/ctr-hmac-v1.json', import.meta.url), 'utf8'));
const masterKey = Uint8Array.from(Buffer.from(vector.masterKeyHex, 'hex'));
const messages = new Map();
let listener;
globalThis.self = {
  addEventListener: (_type, callback) => { listener = callback; },
  postMessage: message => messages.get(message.id)?.(message),
};
await import(new URL('../src/record-worker.js', import.meta.url));

async function workerCall(id, message) {
  return new Promise((resolveMessage, rejectMessage) => {
    messages.set(id, response => {
      messages.delete(id);
      if (response.error) rejectMessage(new Error(response.error));
      else resolveMessage(response.result);
    });
    listener({ data: { id, ...message } });
  });
}

const vectorRecord = Uint8Array.from(Buffer.from(vector.recordHex, 'hex'));
let requestId = 1;
const vectorMetadata = [{
  sequence: 0,
  counter: vector.baseCounterBase64,
  ciphertextLength: vector.clearBytes,
  tagLength: 32,
}];
const initializeVectorWorker = () => workerCall(requestId++, {
  type: 'init',
  contentId: vector.contentId,
  baseCounter: vector.baseCounterBase64,
  records: vectorMetadata,
  masterKey: masterKey.slice().buffer,
});
await initializeVectorWorker();
const vectorClear = await workerCall(requestId++, { type: 'decrypt', record: vectorRecord.buffer });
assert.equal(Buffer.from(vectorClear.clear).toString('utf8'), vector.clearUtf8);
assert.equal((await workerCall(requestId++, { type: 'finish' })).clearSha256, vector.clearSha256);

await initializeVectorWorker();
const badCounter = vectorRecord.slice();
badCounter[4] ^= 1;
await assert.rejects(workerCall(requestId++, { type: 'decrypt', record: badCounter.buffer }), /counter is inconsistent/);
await initializeVectorWorker();
const outOfOrder = vectorRecord.slice();
new DataView(outOfOrder.buffer).setUint32(0, 1, false);
await assert.rejects(workerCall(requestId++, { type: 'decrypt', record: outOfOrder.buffer }), /does not match sidecar metadata/);
await initializeVectorWorker();
await assert.rejects(workerCall(requestId++, { type: 'decrypt', record: vectorRecord.slice(0, -1).buffer }), /Invalid record length/);

const segmentPaths = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.enc.m4s')) segmentPaths.push(path);
  }
}
await walk(root);
assert.ok(segmentPaths.length > 0, 'PHP package must contain encrypted fMP4 segments');

{
  const segmentPath = segmentPaths[0];
  const sidecar = JSON.parse(await readFile(`${segmentPath}.json`, 'utf8'));
  const ciphertext = await readFile(segmentPath);
  const firstLength = 24 + sidecar.records[0].ciphertextLength + sidecar.records[0].tagLength;
  await workerCall(requestId++, {
    type: 'init', contentId: sidecar.contentId, baseCounter: sidecar.baseCounter,
    records: sidecar.records, masterKey: masterKey.slice().buffer,
  });
  const corrupted = Uint8Array.from(ciphertext.subarray(0, firstLength));
  corrupted[corrupted.length - 1] ^= 1;
  await assert.rejects(workerCall(requestId++, { type: 'decrypt', record: corrupted.buffer }), /authentication failed/);
}

for (const segmentPath of segmentPaths) {
  const sidecar = JSON.parse(await readFile(`${segmentPath}.json`, 'utf8'));
  const ciphertext = await readFile(segmentPath);
  const keyCopy = masterKey.slice();
  await workerCall(requestId++, {
    type: 'init', contentId: sidecar.contentId, baseCounter: sidecar.baseCounter,
    records: sidecar.records, masterKey: keyCopy.buffer,
  });

  const clearParts = [];
  let offset = 0;
  for (const record of sidecar.records) {
    const length = 24 + record.ciphertextLength + record.tagLength;
    const bytes = Uint8Array.from(ciphertext.subarray(offset, offset + length));
    assert.equal(bytes.byteLength, length, `${segmentPath}: complete record bytes`);
    const result = await workerCall(requestId++, { type: 'decrypt', record: bytes.buffer });
    clearParts.push(Buffer.from(result.clear));
    offset += length;
  }
  assert.equal(offset, ciphertext.length, `${segmentPath}: no trailing bytes`);
  const clear = Buffer.concat(clearParts);
  assert.equal(clear.length, sidecar.clearBytes, `${segmentPath}: clear byte count`);
  assert.equal(createHash('sha256').update(clear).digest('hex'), sidecar.clearSha256, `${segmentPath}: clear SHA-256`);
  assert.equal((await workerCall(requestId++, { type: 'finish' })).clearSha256, sidecar.clearSha256);
}

console.log(`Fixed vector, negative authentication/metadata cases, and PHP-to-Worker interoperability passed for ${segmentPaths.length} encrypted segments.`);
