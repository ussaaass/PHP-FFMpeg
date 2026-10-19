import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const vector = JSON.parse(await readFile(new URL('../../doc/vectors/CTR-HMAC-V2-001.json', import.meta.url), 'utf8'));
const responses = new Map();
let listener;
globalThis.self = {
  addEventListener: (_type, callback) => { listener = callback; },
  postMessage: (message, _transfer = []) => responses.get(message.id)?.(message),
};
await import('../src/v2-record-worker.js');

let requestId = 0;
function call(message) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    responses.set(id, response => {
      responses.delete(id);
      if (response.error) reject(new Error(response.error));
      else resolve(response.result);
    });
    listener({ data: { id, ...message } });
  });
}
const masterKey = Uint8Array.from(Buffer.from(vector.inputs.masterKeyHex, 'hex'));
const preamble = Uint8Array.from(Buffer.from(vector.derived.preambleHex, 'hex'));
const object = Uint8Array.from(Buffer.from(vector.object.hex, 'hex'));
async function initialize() {
  await call({ type: 'init', preamble: preamble.slice().buffer, masterKey: masterKey.slice().buffer, keyId: vector.fields.keyId });
}
await initialize();
let offset = 40;
const clearParts = [];
for (const expected of vector.records) {
  const size = 24 + Buffer.from(expected.ciphertextHex, 'hex').length + 32;
  const record = object.slice(offset, offset + size);
  const result = await call({ type: 'decrypt', record: record.buffer });
  assert.equal(result.sequence, expected.sequence);
  assert.equal(result.final, expected.sequence === vector.records.length - 1);
  assert.equal(Buffer.from(result.clear).toString('hex'), vector.inputs.clearRecords[expected.sequence].hex);
  clearParts.push(Buffer.from(result.clear));
  offset += size;
}
assert.equal(offset, object.length);
assert.equal((await call({ type: 'finish' })).recordCount, 2);
assert.equal(Buffer.concat(clearParts).toString('hex'), vector.inputs.clearRecords.map(record => record.hex).join(''));

const wrongKey = masterKey.slice();
wrongKey[0] ^= 1;
await call({ type: 'init', preamble: preamble.slice().buffer, masterKey: wrongKey.buffer, keyId: vector.fields.keyId });
const wrongKeyRecord = object.slice(40, 40 + 24 + 24 + 32);
await assert.rejects(call({ type: 'decrypt', record: wrongKeyRecord.buffer }), /authentication failed/);

await initialize();
const tampered = object.slice(40, 40 + 24 + 24 + 32);
tampered[24] ^= 1;
await assert.rejects(call({ type: 'decrypt', record: tampered.buffer }), /authentication failed/);
await assert.rejects(call({ type: 'finish' }), /without authenticated FINAL/);

await initialize();
const truncated = object.slice(40, 40 + 24 + 12);
await assert.rejects(call({ type: 'decrypt', record: truncated.buffer }), /Truncated/);

await initialize();
const wrongSequence = object.slice(40, 40 + 24 + 24 + 32);
new DataView(wrongSequence.buffer).setUint32(0, 1, false);
await assert.rejects(call({ type: 'decrypt', record: wrongSequence.buffer }), /Out-of-order/);

await initialize();
const overflow = new Uint8Array(24 + 17 + 32);
overflow.fill(0xff, 4, 20);
new DataView(overflow.buffer).setUint32(20, 17, false);
await assert.rejects(call({ type: 'decrypt', record: overflow.buffer }), /counter overflow/);

await initialize();
const firstRecord = object.slice(40, 40 + 24 + 24 + 32);
await call({ type: 'decrypt', record: firstRecord.buffer });
const secondOffset = 40 + firstRecord.length;
const badCounter = object.slice(secondOffset);
badCounter[19] ^= 1;
await assert.rejects(call({ type: 'decrypt', record: badCounter.buffer }), /counter is inconsistent/);

await assert.rejects(call({ type: 'init', preamble: Uint8Array.from([0, ...preamble.slice(1)]).buffer, masterKey: masterKey.slice().buffer }), /Invalid CTR\/HMAC V2 preamble/);
const invalidPreamble = preamble.slice();
new DataView(invalidPreamble.buffer).setUint16(16, 1024, false);
await assert.rejects(call({ type: 'init', preamble: invalidPreamble.buffer, masterKey: masterKey.slice().buffer }), /preamble fields/);

await initialize();
const oversized = object.slice(40, 40 + 24 + 24 + 32);
new DataView(oversized.buffer).setUint32(20, 0x80010001, false);
await assert.rejects(call({ type: 'decrypt', record: oversized.buffer }), /record length/);

await initialize();
const nonFinalRecord = object.slice(40, 40 + 24 + 24 + 32);
await call({ type: 'decrypt', record: nonFinalRecord.buffer });
await assert.rejects(call({ type: 'finish' }), /without authenticated FINAL/);

await initialize();
const finalRecordOffset = 40 + 24 + 24 + 32;
await call({ type: 'decrypt', record: object.slice(40, finalRecordOffset).buffer });
const badFinal = object.slice(finalRecordOffset);
badFinal[20] ^= 0x80;
await assert.rejects(call({ type: 'decrypt', record: badFinal.buffer }), /authentication failed/);

await initialize();
const validFirst = object.slice(40, 40 + 24 + 24 + 32);
await call({ type: 'decrypt', record: validFirst.buffer });
const validLast = object.slice(finalRecordOffset);
await call({ type: 'decrypt', record: validLast.buffer });
await assert.rejects(call({ type: 'decrypt', record: validLast.buffer }), /after final/);

console.log('CTR/HMAC V2 Worker fixed vector, final marker, authentication failure, truncation, and sequence checks passed.');
