import { RequestPurpose } from './constants.js';
import { assetIdToBytes } from './playback-info.js';

const PREAMBLE_LENGTH = 40;
const HEADER_LENGTH = 24;
const TAG_LENGTH = 32;
const MAX_RECORD_LENGTH = 65_536;
const MAGIC = new TextEncoder().encode('PFFHLS2\n');

function createStats() {
  return {
    aborted: false, loaded: 0, total: 0, retry: 0, chunkCount: 0, bwEstimate: 0,
    loading: { start: performance.now(), first: 0, end: 0 },
    parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 },
  };
}

function concat(left, right) {
  const output = new Uint8Array(left.length + right.length);
  output.set(left);
  output.set(right, left.length);
  return output;
}

function parseMediaFragments(buffer) {
  let offset = 0;
  let fragmentStart = -1;
  let prefixStart = -1;
  const fragments = [];
  while (offset + 8 <= buffer.length) {
    let size = new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getUint32(0, false);
    const type = String.fromCharCode(...buffer.subarray(offset + 4, offset + 8));
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > buffer.length) break;
      const largeSize = new DataView(buffer.buffer, buffer.byteOffset + offset + 8, 8).getBigUint64(0, false);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MP4 box is too large');
      size = Number(largeSize);
      headerSize = 16;
    }
    if (size < headerSize) throw new Error(`Invalid ${type} MP4 box length`);
    if (offset + size > buffer.length) break;
    if (type === 'moof') {
      if (fragmentStart !== -1) throw new Error('A new moof arrived before the prior mdat');
      fragmentStart = prefixStart === -1 ? offset : prefixStart;
      prefixStart = -1;
    } else if (type === 'mdat') {
      if (fragmentStart === -1) throw new Error('An mdat arrived without its moof');
      fragments.push(buffer.slice(fragmentStart, offset + size));
      fragmentStart = -1;
    } else if ((type === 'styp' || type === 'sidx') && fragmentStart === -1) {
      if (prefixStart === -1) prefixStart = offset;
    } else {
      throw new Error(`Unexpected ${type} box in V2 fMP4 media`);
    }
    offset += size;
  }
  const keepFrom = fragmentStart !== -1 ? fragmentStart : prefixStart !== -1 ? prefixStart : offset;
  return { fragments, remainder: buffer.slice(keepFrom) };
}

function isMagic(bytes) {
  return bytes.length >= MAGIC.length && MAGIC.every((byte, index) => bytes[index] === byte);
}

export class V2CtrFragmentLoader {
  constructor({ playbackInfo, masterKey, requestOptions = () => ({}), onSegmentAuthenticated = () => {} }) {
    this.playbackInfo = playbackInfo;
    this.masterKey = masterKey;
    this.requestOptions = requestOptions;
    this.onSegmentAuthenticated = onSegmentAuthenticated;
    this.abortController = null;
    this.worker = null;
    this.pendingWorkerMessages = new Map();
    this.nextWorkerRequestId = 1;
    this.stats = createStats();
    this.completed = false;
  }

  load(context, _config, callbacks) {
    this.context = context;
    this.callbacks = callbacks;
    this.abortController = new AbortController();
    this.completed = false;
    this.stats = createStats();
    this.run(context, callbacks).catch(error => {
      this.cleanupWorker();
      if (this.abortController?.signal.aborted) {
        this.stats.aborted = true;
        callbacks.onAbort?.(this.stats, context, null);
      } else {
        this.completed = true;
        callbacks.onError?.({ code: Number.isInteger(error.status) ? error.status : 0, text: error.message || 'V2 media load failed' }, context, null, this.stats);
      }
    });
  }

  async run(context, callbacks) {
    const options = await this.getRequestOptions(context.url, RequestPurpose.SEGMENT, context);
    const response = await fetch(context.url, { ...options, method: 'GET', signal: this.abortController.signal, cache: 'no-store' });
    if (!response.ok) throw Object.assign(new Error(`Media request failed with HTTP ${response.status}`), { status: response.status });
    const declaredLength = Number(response.headers.get('content-length'));
    this.stats.total = Number.isSafeInteger(declaredLength) && declaredLength > 0 ? declaredLength : 0;
    if (!response.body?.getReader) {
      const data = new Uint8Array(await response.arrayBuffer());
      if (isMagic(data)) throw new Error('CTR/HMAC V2 requires a streaming response body');
      this.finishClearResponse(response, data, context, callbacks);
      return;
    }

    const reader = response.body.getReader();
    let received = 0;
    let sniff = new Uint8Array(0);
    let mode = null;
    let clearParts = [];
    let pending = new Uint8Array(0);
    let pendingClear = new Uint8Array(0);
    let preamble = null;
    let recordCount = 0;
    let mediaFragmentCount = 0;
    let sawFinal = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        if (!this.stats.loading.first) this.stats.loading.first = performance.now();
        received += value.byteLength;
        this.stats.loaded = received;
        if (mode === null) {
          sniff = concat(sniff, value);
          if (sniff.length < MAGIC.length) continue;
          mode = isMagic(sniff) ? 'v2' : 'clear';
          if (mode === 'clear') { clearParts.push(sniff); sniff = new Uint8Array(0); continue; }
          pending = sniff;
          sniff = new Uint8Array(0);
        } else if (mode === 'clear') {
          clearParts.push(value.slice());
          continue;
        } else {
          if (sawFinal) throw new Error('Data received after the authenticated FINAL record');
          pending = concat(pending, value);
        }

        if (!preamble && pending.length >= PREAMBLE_LENGTH) {
          preamble = pending.slice(0, PREAMBLE_LENGTH);
          this.validatePreamble(preamble);
          pending = pending.slice(PREAMBLE_LENGTH);
          this.stats.parsing.start = performance.now();
          await this.initializeWorker(preamble);
        }
        while (preamble && pending.length >= HEADER_LENGTH) {
          const view = new DataView(pending.buffer, pending.byteOffset, pending.byteLength);
          const sequence = view.getUint32(0, false);
          const lengthAndFlags = view.getUint32(20, false);
          const clearLength = lengthAndFlags & 0x7fffffff;
          if (clearLength < 1 || clearLength > MAX_RECORD_LENGTH) throw new Error(`Invalid V2 record length at sequence ${sequence}`);
          const recordLength = HEADER_LENGTH + clearLength + TAG_LENGTH;
          if (pending.length < recordLength) break;
          const record = pending.slice(0, recordLength);
          const result = await this.workerRequest({ type: 'decrypt', record: record.buffer }, [record.buffer]);
          pending = pending.slice(recordLength);
          recordCount += 1;
          if (result.final) sawFinal = true;
          if (sawFinal && pending.length > 0) throw new Error('Data follows the authenticated FINAL record');
          if (!this.stats.parsing.start) this.stats.parsing.start = performance.now();
          pendingClear = concat(pendingClear, new Uint8Array(result.clear));
          const parsed = parseMediaFragments(pendingClear);
          pendingClear = parsed.remainder;
          for (const fragment of parsed.fragments) {
            mediaFragmentCount += 1;
            this.stats.chunkCount += 1;
            callbacks.onProgress?.(this.stats, context, fragment.buffer, null);
          }
          this.stats.parsing.end = performance.now();
          if (pendingClear.length > 2 * 1024 * 1024) throw new Error('Incomplete MP4 fragment exceeded the 2 MiB streaming limit');
        }
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }

    if (mode === 'clear') {
      const clear = new Uint8Array(clearParts.reduce((size, part) => size + part.length, 0));
      let offset = 0;
      for (const part of clearParts) { clear.set(part, offset); offset += part.length; }
      this.finishClearResponse(response, clear, context, callbacks);
      return;
    }
    if (mode !== 'v2' || !preamble) throw new Error('Truncated or unsupported media object preamble');
    if (pending.length !== 0) throw new Error('Media object ended with a truncated encrypted record');
    const completion = await this.workerRequest({ type: 'finish' });
    if (this.stats.total > 0 && received !== this.stats.total) throw new Error('Media response byte count disagrees with Content-Length');
    if (pendingClear.length !== 0) throw new Error('Media object ended with an incomplete MP4 moof/mdat unit');
    this.onSegmentAuthenticated({
      level: context.frag?.level,
      sequence: context.frag?.sn,
      assetId: this.playbackInfo.assetId,
      keyId: this.playbackInfo.keyId,
      recordCount,
      mediaFragmentCount,
      objectBytes: received,
      complete: completion.complete,
    });
    this.stats.loading.end = performance.now();
    this.stats.parsing.end = this.stats.loading.end;
    this.completed = true;
    callbacks.onSuccess({ url: response.url, data: new ArrayBuffer(0), code: response.status, text: 'CTR/HMAC V2 verified and media units emitted' }, this.stats, context, null);
    this.cleanupWorker();
  }

  finishClearResponse(response, bytes, context, callbacks) {
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    this.stats.loaded = bytes.byteLength;
    this.stats.total = bytes.byteLength;
    this.stats.loading.end = performance.now();
    this.completed = true;
    callbacks.onSuccess({ url: response.url, data, code: response.status, text: response.statusText }, this.stats, context, null);
  }

  validatePreamble(preamble) {
    if (!isMagic(preamble)) throw new Error('Invalid CTR/HMAC V2 preamble');
    const view = new DataView(preamble.buffer, preamble.byteOffset, preamble.byteLength);
    if (view.getUint16(22, false) !== 0 || view.getUint16(16, false) > 1023 || view.getUint16(18, false) === 0) throw new Error('Invalid CTR/HMAC V2 preamble fields');
    if (preamble.subarray(8, 16).some((byte, index) => byte !== assetIdToBytes(this.playbackInfo.assetId)[index]) || view.getUint16(16, false) !== this.playbackInfo.keyId) {
      throw new Error('V2 preamble asset/key identity does not match PlaybackInfo');
    }
  }

  async initializeWorker(preamble) {
    this.worker = new Worker(new URL('./v2-record-worker.js', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', event => {
      const pending = this.pendingWorkerMessages.get(event.data.id);
      if (!pending) return;
      this.pendingWorkerMessages.delete(event.data.id);
      if (event.data.error) pending.reject(new Error(event.data.error));
      else pending.resolve(event.data.result);
    });
    this.worker.addEventListener('error', event => {
      for (const pending of this.pendingWorkerMessages.values()) pending.reject(new Error(event.message));
      this.pendingWorkerMessages.clear();
    });
    const keyCopy = this.masterKey.slice();
    const assetBytes = assetIdToBytes(this.playbackInfo.assetId);
    return this.workerRequest({
      type: 'init',
      preamble: preamble.buffer.slice(preamble.byteOffset, preamble.byteOffset + preamble.byteLength),
      assetIdBytes: assetBytes.buffer,
      keyId: this.playbackInfo.keyId,
      masterKey: keyCopy.buffer,
    }, [keyCopy.buffer, assetBytes.buffer]);
  }

  async workerRequest(message, transfer = []) {
    const id = this.nextWorkerRequestId++;
    const result = new Promise((resolve, reject) => this.pendingWorkerMessages.set(id, { resolve, reject }));
    this.worker.postMessage({ id, ...message }, transfer);
    return result;
  }

  async getRequestOptions(url, purpose, context) {
    const options = await this.requestOptions({ url, purpose, context, signal: this.abortController.signal });
    return options && typeof options === 'object' ? options : {};
  }

  abort() {
    if (!this.completed) this.abortController?.abort();
    this.stats.aborted = true;
    this.cleanupWorker();
  }

  destroy() { this.abort(); }

  cleanupWorker() {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pendingWorkerMessages.values()) pending.reject(new Error('V2 decrypt worker terminated'));
    this.pendingWorkerMessages.clear();
  }
}
