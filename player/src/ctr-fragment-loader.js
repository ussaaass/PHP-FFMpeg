import { KeyProviderTimeout, PlaybackProfile, RequestPurpose } from './constants.js';

const RECORD_MAX_BYTES = 65_536;

function stats() {
  return {
    aborted: false,
    loaded: 0,
    total: 0,
    retry: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: performance.now(), first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  };
}

function resetStats(target) {
  const fresh = stats();
  for (const key of Object.keys(fresh)) target[key] = fresh[key];
  return target;
}

function concat(left, right) {
  if (left.length === 0) return right.slice();
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left);
  merged.set(right, left.length);
  return merged;
}

function extractMediaFragments(buffer) {
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
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`MP4 box ${type} is too large`);
      size = Number(largeSize);
      headerSize = 16;
    }
    if (size < headerSize) throw new Error(`Invalid ${type} MP4 box length`);
    if (offset + size > buffer.length) break;

    if (type === 'moof') {
      if (fragmentStart !== -1) throw new Error('Received a new moof before the prior mdat');
      fragmentStart = prefixStart === -1 ? offset : prefixStart;
      prefixStart = -1;
    } else if (type === 'mdat') {
      if (fragmentStart === -1) throw new Error('Received an mdat without its moof');
      fragments.push(buffer.slice(fragmentStart, offset + size));
      fragmentStart = -1;
    } else if ((type === 'styp' || type === 'sidx') && fragmentStart === -1) {
      if (prefixStart === -1) prefixStart = offset;
    } else {
      throw new Error(`Unexpected ${type} box in an encrypted fMP4 segment`);
    }
    offset += size;
  }

  const keepFrom = fragmentStart !== -1 ? fragmentStart : prefixStart !== -1 ? prefixStart : offset;
  return { fragments, remainder: buffer.slice(keepFrom) };
}

function sidecarUrl(segmentUrl) {
  const url = new URL(segmentUrl);
  url.pathname += '.json';
  url.search = '';
  url.hash = '';
  return url.href;
}

function sameResource(left, right) {
  const a = new URL(left);
  const b = new URL(right);
  return a.origin === b.origin && a.pathname === b.pathname;
}

export class CtrFragmentLoader {
  constructor({ keyProvider, requestOptions = () => ({}), keyProviderTimeoutMilliseconds = KeyProviderTimeout.DEFAULT_MILLISECONDS, onSegmentAuthenticated = () => {} }) {
    if (!Number.isInteger(keyProviderTimeoutMilliseconds) || keyProviderTimeoutMilliseconds < 1 || keyProviderTimeoutMilliseconds > KeyProviderTimeout.MAXIMUM_MILLISECONDS) {
      throw new RangeError(`keyProviderTimeoutMilliseconds must be an integer from 1 to ${KeyProviderTimeout.MAXIMUM_MILLISECONDS}`);
    }
    this.keyProvider = keyProvider;
    this.requestOptions = requestOptions;
    this.keyProviderTimeoutMilliseconds = keyProviderTimeoutMilliseconds;
    this.onSegmentAuthenticated = onSegmentAuthenticated;
    this.abortController = null;
    this.worker = null;
    this.pendingWorkerMessages = new Map();
    this.nextWorkerRequestId = 1;
    this.stats = stats();
    this.context = null;
    this.callbacks = null;
    this.completed = false;
  }

  load(context, _loaderConfig, callbacks) {
    this.context = context;
    this.callbacks = callbacks;
    this.abortController = new AbortController();
    this.completed = false;
    // hls.js assigns frag.stats to loader.stats before calling load(). Keep the
    // same object identity so its fragment controller sees live byte/timing data.
    resetStats(this.stats);
    this.run(context, callbacks).catch(error => {
      this.cleanupWorker();
      if (this.abortController?.signal.aborted) {
        callbacks.onAbort?.(this.stats, context, null);
      } else {
        this.completed = true;
        callbacks.onError?.({ code: error.status || 0, text: error.message }, context, null, this.stats);
      }
    });
  }

  async run(context, callbacks) {
    if (/\.enc\.m4s(?:$|\?)/i.test(context.url)) {
      await this.loadEncrypted(context, callbacks);
      return;
    }

    const response = await fetch(context.url, {
      ...await this.getRequestOptions(context.url, RequestPurpose.SEGMENT, context),
      signal: this.abortController.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw Object.assign(new Error(`Media request failed with HTTP ${response.status}`), { status: response.status });
    const data = await response.arrayBuffer();
    this.stats.loaded = data.byteLength;
    this.stats.total = data.byteLength;
    this.stats.loading.end = performance.now();
    this.completed = true;
    callbacks.onSuccess({ url: response.url, data, code: response.status, text: response.statusText }, this.stats, context, null);
  }

  async loadEncrypted(context, callbacks) {
    const { sidecar, masterKey } = await this.loadMetadataAndKey(context.url);
    await this.initializeWorker(sidecar, masterKey);

    let offset = 0;
    let expectedTotal = null;
    let etag = null;
    let pending = new Uint8Array(0);
    let pendingClear = new Uint8Array(0);
    let recordCount = 0;
    let mediaFragmentCount = 0;
    let retries = 0;

    while (expectedTotal === null || offset < expectedTotal) {
      if (offset > 0 && !etag) throw new Error('Cannot resume encrypted media without an ETag');
      const options = await this.getRequestOptions(context.url, RequestPurpose.SEGMENT, context);
      const headers = new Headers(options.headers || undefined);
      if (offset > 0) {
        headers.set('Range', `bytes=${offset}-`);
        headers.set('If-Range', etag);
      }
      let response;
      try {
        response = await fetch(context.url, {
          ...options,
          method: 'GET',
          headers,
          signal: this.abortController.signal,
          cache: 'no-store',
        });
      } catch (error) {
        if (this.abortController.signal.aborted) throw error;
        if (++retries > 3) throw error;
        this.stats.retry = retries;
        continue;
      }
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        await response.body?.cancel().catch(() => {});
        if (++retries > 3) throw new Error(`Encrypted segment request failed with retryable HTTP ${response.status} after 3 retries`);
        this.stats.retry = retries;
        continue;
      }
      const responseEtag = response.headers.get('etag');
      if (offset === 0) {
        if (response.status !== 200) throw Object.assign(new Error(`Initial encrypted segment returned HTTP ${response.status}`), { status: response.status });
        expectedTotal = Number(response.headers.get('content-length'));
        etag = responseEtag;
        this.stats.total = expectedTotal;
      } else {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
        if (response.status !== 206 || !range || Number(range[1]) !== offset || Number(range[3]) !== expectedTotal || responseEtag !== etag) {
          throw new Error('Range resume response did not match the original object and record boundary');
        }
      }
      if (!Number.isSafeInteger(expectedTotal) || expectedTotal <= 0 || expectedTotal !== sidecar.cipherBytes) {
        throw new Error('Encrypted segment Content-Length disagrees with its sidecar');
      }
      if (!response.body?.getReader) throw new Error('Encrypted segment response does not support streaming');

      const reader = response.body.getReader();
      let retryStream = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value?.byteLength && !this.stats.loading.first) this.stats.loading.first = performance.now();
          pending = concat(pending, value);
          while (pending.length >= 24) {
            const view = new DataView(pending.buffer, pending.byteOffset, pending.byteLength);
            const sequence = view.getUint32(0, false);
            const length = view.getUint32(20, false);
            if (length > RECORD_MAX_BYTES) throw new Error(`CTR/HMAC record ${sequence} exceeds the maximum size`);
            const recordLength = 24 + length + 32;
            if (pending.length < recordLength) break;
            if (sequence !== recordCount) throw new Error(`Out-of-order record ${sequence}; expected ${recordCount}`);

            const record = pending.slice(0, recordLength);
            const result = await this.workerRequest({ type: 'decrypt', record: record.buffer }, [record.buffer]);
            pending = pending.slice(recordLength);
            offset += recordLength;
            recordCount += 1;
            this.stats.loaded = offset;
            if (!this.stats.loading.first) {
              this.stats.loading.first = performance.now();
              this.stats.parsing.start = this.stats.loading.first;
            }
            pendingClear = concat(pendingClear, new Uint8Array(result.clear));
            const parsed = extractMediaFragments(pendingClear);
            pendingClear = parsed.remainder;
            for (const fragment of parsed.fragments) {
              mediaFragmentCount += 1;
              this.stats.chunkCount += 1;
              callbacks.onProgress?.(this.stats, context, fragment, null);
            }
            // FRAG_BUFFERED fires for each progressively appended moof/mdat,
            // before onSuccess for the complete encrypted segment. Keep the
            // processing timestamp current for hls.js ABR samples at that point.
            this.stats.parsing.end = performance.now();
            if (pendingClear.length > 2 * 1024 * 1024) throw new Error('Incomplete MP4 fragment exceeded the 2 MiB streaming limit');
          }
        }
      } catch (error) {
        await reader.cancel(error.message).catch(() => {});
        if (this.abortController.signal.aborted) throw error;
        if (++retries > 3) throw error;
        this.stats.retry = retries;
        pending = new Uint8Array(0);
        continue;
      }

      if (pending.length !== 0 || offset < expectedTotal) {
        if (++retries > 3) throw new Error(`Encrypted segment ended at byte ${offset} of ${expectedTotal}`);
        this.stats.retry = retries;
        pending = new Uint8Array(0);
        retryStream = true;
      }
      if (!retryStream) break;
    }

    if (recordCount !== sidecar.records.length) throw new Error('Downloaded record count does not match sidecar metadata');
    if (pendingClear.length !== 0) throw new Error(`Media segment ended with ${pendingClear.length} bytes outside a complete moof/mdat pair`);
    if (sidecar.mediaFragmentCount !== undefined && mediaFragmentCount !== sidecar.mediaFragmentCount) {
      throw new Error(`Parsed ${mediaFragmentCount} media fragments; sidecar declares ${sidecar.mediaFragmentCount}`);
    }
    const digest = await this.workerRequest({ type: 'finish' });
    if (digest.clearSha256 !== sidecar.clearSha256) throw new Error('Decrypted media SHA-256 does not match its sidecar');
    this.onSegmentAuthenticated({
      level: context.frag?.level,
      sequence: context.frag?.sn,
      keyId: sidecar.keyId,
      recordCount,
      cipherBytes: offset,
      clearBytes: sidecar.clearBytes,
      clearSha256: digest.clearSha256,
      mediaFragmentCount,
    });
    this.stats.loading.end = performance.now();
    // hls.js samples ABR bandwidth from parsing.end for media segments.
    // This loader bypasses its transmuxer, so mark verified CTR/MP4 processing explicitly.
    this.stats.parsing.end = this.stats.loading.end;
    this.completed = true;
    callbacks.onSuccess(
      { url: context.url, data: new ArrayBuffer(0), code: 200, text: 'CTR/HMAC verified and progressively appended' },
      this.stats,
      context,
      null,
    );
    this.cleanupWorker();
  }

  async loadMetadataAndKey(segmentUrl) {
    const metadataUrl = sidecarUrl(segmentUrl);
    const response = await fetch(metadataUrl, {
      ...await this.getRequestOptions(metadataUrl, RequestPurpose.SIDECAR, this.context),
      signal: this.abortController.signal,
      cache: 'no-store',
    });
    if (!response.ok) throw Object.assign(new Error(`Sidecar request failed with HTTP ${response.status}`), { status: response.status });
    const sidecar = await response.json();
    if (sidecar.version !== 1 || sidecar.profile !== PlaybackProfile.CTR_HMAC_V1) throw new Error('Unsupported CTR/HMAC sidecar profile/version');
    if (!sameResource(new URL(sidecar.segmentUri, metadataUrl).href, segmentUrl)) throw new Error('Sidecar segment URI does not identify the requested media object');
    if (!Array.isArray(sidecar.records) || sidecar.records.length === 0) throw new Error('Sidecar contains no authenticated records');
    if (typeof sidecar.keyId !== 'string' || sidecar.keyId === '' || /[\r\n]/.test(sidecar.keyId)) throw new Error('Sidecar contains an invalid keyId');
    if (!this.keyProvider || typeof this.keyProvider.getMasterKey !== 'function') throw new Error('An external keyProvider.getMasterKey callback is required');
    let masterKey;
    try {
      masterKey = await this.resolveMasterKey({
        keyId: sidecar.keyId,
        keyUri: new URL(sidecar.keyUri, metadataUrl).href,
        contentId: sidecar.contentId,
        profile: PlaybackProfile.CTR_HMAC_V1,
        signal: this.abortController.signal,
      });
    } catch (error) {
      if (error.message?.startsWith('PLAYER_KEY_PROVIDER_TIMEOUT:') || error.message?.startsWith('PLAYER_KEY_PROVIDER_ABORTED:')) throw error;
      throw new Error('PLAYER_KEY_PROVIDER_REJECTED: Application key provider rejected the requested keyId');
    }
    const bytes = masterKey instanceof Uint8Array ? masterKey : masterKey instanceof ArrayBuffer ? new Uint8Array(masterKey) : null;
    if (!bytes || bytes.byteLength !== 32) throw new Error('PLAYER_KEY_PROVIDER_REJECTED: Application key provider returned invalid key material');
    return { sidecar, masterKey: bytes.slice() };
  }

  resolveMasterKey(context) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context.signal.removeEventListener('abort', onAbort);
        callback(value);
      };
      const onAbort = () => finish(reject, new Error('PLAYER_KEY_PROVIDER_ABORTED: Key-provider request was aborted'));
      const timer = setTimeout(() => finish(reject, new Error('PLAYER_KEY_PROVIDER_TIMEOUT: Key-provider request timed out')), this.keyProviderTimeoutMilliseconds);
      context.signal.addEventListener('abort', onAbort, { once: true });
      if (context.signal.aborted) {
        onAbort();
        return;
      }
      Promise.resolve().then(() => this.keyProvider.getMasterKey(context)).then(
        value => finish(resolve, value),
        error => finish(reject, error instanceof Error ? error : new Error('Application key-provider request failed')),
      );
    });
  }

  async getRequestOptions(url, purpose, context) {
    const options = await this.requestOptions({ url, purpose, context, signal: this.abortController.signal });
    return options && typeof options === 'object' ? options : {};
  }

  initializeWorker(sidecar, masterKey) {
    this.worker = new Worker(new URL('./record-worker.js', import.meta.url), { type: 'module' });
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
    return this.workerRequest({
      type: 'init',
      contentId: sidecar.contentId,
      baseCounter: sidecar.baseCounter,
      records: sidecar.records,
      masterKey: masterKey.buffer,
    }, [masterKey.buffer]);
  }

  workerRequest(message, transfer = []) {
    const id = this.nextWorkerRequestId++;
    const promise = new Promise((resolve, reject) => this.pendingWorkerMessages.set(id, { resolve, reject }));
    this.worker.postMessage({ id, ...message }, transfer);
    return promise;
  }

  abort() {
    if (!this.completed) {
      this.abortController?.abort();
      this.stats.aborted = true;
    }
    this.cleanupWorker();
  }

  destroy() {
    this.abort();
  }

  cleanupWorker() {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pendingWorkerMessages.values()) pending.reject(new Error('Decrypt worker terminated'));
    this.pendingWorkerMessages.clear();
  }
}
