import { createCipheriv, createHmac, randomBytes } from 'node:crypto';

export const RECORD_SIZE = 65_536;
export const HEADER_SIZE = 24;
export const TAG_SIZE = 32;
export const DOMAIN = Buffer.from('php-ffmpeg-hls-ctr-demo-v1\n', 'utf8');
export const AES_KEY = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
export const HMAC_KEY = Buffer.from(
  '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  'hex',
);

const MAX_COUNTER = (1n << 128n) - 1n;

function addRecordCounter(baseCounter, sequence) {
  const base = BigInt(`0x${baseCounter.toString('hex')}`);
  const counter = base + BigInt(sequence) * 4096n;
  if (counter > MAX_COUNTER) {
    throw new Error('AES-CTR counter overflow');
  }

  return Buffer.from(counter.toString(16).padStart(32, '0'), 'hex');
}

function recordTag(contentId, header, ciphertext) {
  return createHmac('sha256', HMAC_KEY)
    .update(DOMAIN)
    .update(Buffer.from(contentId, 'utf8'))
    .update(Buffer.from([0]))
    .update(header)
    .update(ciphertext)
    .digest();
}

export function encryptSegment(clearSegment, contentId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(contentId)) {
    throw new Error('contentId must be a lowercase ASCII UUID');
  }

  const baseCounter = randomBytes(16);
  const records = [];
  const metadata = [];
  let offset = 0;
  let sequence = 0;

  while (offset < clearSegment.length) {
    const clear = clearSegment.subarray(offset, offset + RECORD_SIZE);
    const counter = addRecordCounter(baseCounter, sequence);
    const cipher = createCipheriv('aes-128-ctr', AES_KEY, counter);
    const ciphertext = Buffer.concat([cipher.update(clear), cipher.final()]);
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt32BE(sequence, 0);
    counter.copy(header, 4);
    header.writeUInt32BE(ciphertext.length, 20);
    const tag = recordTag(contentId, header, ciphertext);

    records.push(header, ciphertext, tag);
    metadata.push({
      sequence,
      counter: counter.toString('base64'),
      ciphertextLength: ciphertext.length,
      tagLength: TAG_SIZE,
    });
    offset += clear.length;
    sequence += 1;
  }

  if (clearSegment.length === 0) {
    throw new Error('Cannot encrypt an empty media fragment');
  }

  return {
    encrypted: Buffer.concat(records),
    baseCounter: baseCounter.toString('base64'),
    records: metadata,
  };
}

export function getDemoKeys() {
  return {
    aesCtrKey: AES_KEY.toString('base64'),
    hmacKey: HMAC_KEY.toString('base64'),
  };
}
