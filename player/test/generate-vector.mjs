import { createCipheriv, createHash, createHmac, hkdfSync } from 'node:crypto';

const profile = 'phpffmpeg-ctr-hmac-v1';
const masterKey = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');
const contentId = '00000000-0000-4000-8000-000000000001';
const baseCounter = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
const clear = Buffer.from('CTR-HMAC-V1 fixed interoperability vector\n', 'utf8');
const aesKey = Buffer.from(hkdfSync('sha256', masterKey, Buffer.from(contentId), Buffer.from(profile + '\0aes-128-ctr'), 16));
const macKey = Buffer.from(hkdfSync('sha256', masterKey, Buffer.from(contentId), Buffer.from(profile + '\0hmac-sha256'), 32));
const cipher = createCipheriv('aes-128-ctr', aesKey, baseCounter);
const ciphertext = Buffer.concat([cipher.update(clear), cipher.final()]);
const header = Buffer.concat([Buffer.from([0, 0, 0, 0]), baseCounter, Buffer.from([0, 0, 0, clear.length])]);
const domain = Buffer.from(profile + '\n', 'utf8');
const tag = createHmac('sha256', macKey).update(Buffer.concat([domain, Buffer.from(contentId), Buffer.from([0]), header, ciphertext])).digest();
const record = Buffer.concat([header, ciphertext, tag]);

process.stdout.write(JSON.stringify({
  profile,
  masterKeyHex: masterKey.toString('hex'),
  contentId,
  baseCounterBase64: baseCounter.toString('base64'),
  clearUtf8: clear.toString('utf8'),
  clearBytes: clear.length,
  clearSha256: createHash('sha256').update(clear).digest('hex'),
  ciphertextHex: ciphertext.toString('hex'),
  tagHex: tag.toString('hex'),
  recordHex: record.toString('hex'),
  recordBytes: record.length,
}, null, 2) + '\n');
