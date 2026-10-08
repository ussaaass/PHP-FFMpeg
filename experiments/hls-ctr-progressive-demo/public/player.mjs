import Hls from '/public/vendor/hls.mjs';

const HLSJS_VERSION = '1.7.3';
const video = document.querySelector('#video');
const logElement = document.querySelector('#log');
const throttleSelect = document.querySelector('#throttle');
const tamperSelect = document.querySelector('#tamper-record');
const streamSelect = document.querySelector('#stream');
const tamperButton = document.querySelector('#tamper');
const runtime = { interruptNext: false, hls: null, startedAt: 0 };
let metrics = {};
let environment = null;
let lastPlaybackStateLog = 0;

function log(message, details) {
  const suffix = details === undefined ? '' : ` ${JSON.stringify(details)}`;
  logElement.textContent += `${new Date().toISOString()} ${message}${suffix}\n`;
  logElement.scrollTop = logElement.scrollHeight;
  console.log(message, details || '');
}

function playbackBufferState() {
  const ranges = [];
  for (let index = 0; index < video.buffered.length; index += 1) {
    ranges.push({ start: Number(video.buffered.start(index).toFixed(3)), end: Number(video.buffered.end(index).toFixed(3)) });
  }
  const currentTime = Number(video.currentTime.toFixed(3));
  const activeRange = ranges.find(range => currentTime >= range.start - 0.05 && currentTime <= range.end + 0.05);
  return {
    currentTime,
    buffered: ranges,
    bufferAhead: activeRange ? Number(Math.max(0, activeRange.end - currentTime).toFixed(3)) : 0,
    readyState: video.readyState,
    networkState: video.networkState,
    paused: video.paused,
  };
}

for (const eventName of ['waiting', 'playing', 'stalled', 'pause', 'ended']) {
  video.addEventListener(eventName, () => log(`video-${eventName}`, playbackBufferState()));
}
video.addEventListener('timeupdate', () => {
  const now = performance.now();
  if (now - lastPlaybackStateLog < 1000) return;
  lastPlaybackStateLog = now;
  log('video-buffer-state', playbackBufferState());
});

function mark(name, value = performance.now()) {
  metrics[name] = value;
  if (name === 'firstDecodedVideoFrame' && metrics.encryptedFragmentDownloadComplete !== undefined) {
    metrics.firstFrameBeforeFullDownload = value < metrics.encryptedFragmentDownloadComplete;
  }
  if (name === 'encryptedFragmentDownloadComplete' && metrics.firstDecodedVideoFrame !== undefined) {
    metrics.firstFrameBeforeFullDownload = metrics.firstDecodedVideoFrame < value;
  }
  log(name, { millisecondsFromStart: Number((value - runtime.startedAt).toFixed(1)) });
}

async function configureServer(values) {
  const response = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(values),
  });
  if (!response.ok) throw new Error(`Demo server configuration failed (${response.status})`);
  return response.json();
}

function emptyStats() {
  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: performance.now(), first: 0, end: 0 },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  };
}

function concatenate(left, right) {
  if (left.length === 0) return right.slice();
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left);
  merged.set(right, left.length);
  return merged;
}

function extractCompleteMediaFragments(buffer) {
  let offset = 0;
  let fragmentStart = -1;
  let segmentPrefixStart = -1;
  let completeEnd = 0;
  const fragments = [];
  while (offset + 8 <= buffer.length) {
    let size = new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getUint32(0, false);
    const type = new TextDecoder().decode(buffer.subarray(offset + 4, offset + 8));
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > buffer.length) break;
      const largeSize = new DataView(buffer.buffer, buffer.byteOffset + offset + 8, 8).getBigUint64(0, false);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`MP4 box ${type} is too large`);
      size = Number(largeSize);
      headerSize = 16;
    }
    if (size < headerSize) throw new Error(`Invalid ${type} MP4 box size ${size}`);
    if (offset + size > buffer.length) break;
    if (type === 'moof') {
      if (fragmentStart !== -1) throw new Error('Received a new moof before the previous mdat');
      fragmentStart = segmentPrefixStart === -1 ? offset : segmentPrefixStart;
      segmentPrefixStart = -1;
    } else if (type === 'mdat') {
      if (fragmentStart === -1) throw new Error('Received an mdat without its moof');
      fragments.push(buffer.slice(fragmentStart, offset + size));
      completeEnd = offset + size;
      fragmentStart = -1;
    } else if (type === 'styp' && fragmentStart === -1) {
      if (segmentPrefixStart === -1) segmentPrefixStart = offset;
    } else if (type === 'sidx' && fragmentStart === -1) {
      // Keep valid segment index boxes in the prefix passed to MSE with this media fragment.
    } else {
      throw new Error(`Unexpected ${type} box in encrypted media segment`);
    }
    offset += size;
  }
  const keepFrom = fragmentStart !== -1 ? fragmentStart : segmentPrefixStart !== -1 ? segmentPrefixStart : offset;
  return { fragments, remainder: buffer.slice(keepFrom), consumedBytes: completeEnd };
}

function decodeError(response, context, stats, error) {
  const code = error.status || 0;
  const text = error.message || String(error);
  response.onError?.({ code, text }, context, null, stats);
}

class DecryptingFragmentLoader {
  constructor() {
    this.abortController = null;
    this.stats = emptyStats();
    this.context = null;
    this.worker = null;
    this.nextId = 1;
    this.pendingWorkerMessages = new Map();
    this.interrupted = false;
  }

  async workerRequest(message, transfer = []) {
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => this.pendingWorkerMessages.set(id, { resolve, reject }));
    this.worker.postMessage({ id, ...message }, transfer);
    return result;
  }

  async initializeWorker(sidecar, keys) {
    this.worker = new Worker('/public/decrypt-worker.mjs', { type: 'module' });
    this.worker.addEventListener('message', (event) => {
      const pending = this.pendingWorkerMessages.get(event.data.id);
      if (!pending) return;
      this.pendingWorkerMessages.delete(event.data.id);
      if (event.data.error) {
        const error = new Error(event.data.error);
        error.stack = event.data.stack;
        pending.reject(error);
      } else pending.resolve(event.data.result);
    });
    this.worker.addEventListener('error', (event) => {
      for (const pending of this.pendingWorkerMessages.values()) pending.reject(new Error(event.message));
      this.pendingWorkerMessages.clear();
    });
    await this.workerRequest({
      type: 'init',
      contentId: sidecar.contentId,
      baseCounter: sidecar.baseCounter,
      records: sidecar.records,
      ...keys,
    });
  }

  async fetchSidecarAndKeys(signal, fragmentUrl) {
    const fragmentPath = new URL(fragmentUrl).pathname;
    const fragmentName = fragmentPath.split('/').pop();
    const sidecarPath = fragmentName === 'encrypted-0.m4s'
      ? '/output/sidecar.json'
      : `/output/${fragmentName.replace(/\.m4s$/, '.json')}`;
    const sidecarResponse = await fetch(sidecarPath, { signal, cache: 'no-store' });
    if (!sidecarResponse.ok) throw new Error(`Sidecar request failed (${sidecarResponse.status})`);
    const sidecar = await sidecarResponse.json();
    const expectedFragment = new URL(sidecar.segmentUri, sidecarResponse.url);
    if (expectedFragment.pathname !== new URL(fragmentUrl).pathname) {
      throw new Error('Fragment URI is not listed in the sidecar');
    }
    const keyUrl = new URL(sidecar.keyUri, sidecarResponse.url);
    const keyResponse = await fetch(keyUrl, { signal, cache: 'no-store', credentials: 'same-origin' });
    if (!keyResponse.ok || keyResponse.headers.get('cache-control') !== 'no-store') {
      throw new Error(`Test key request failed or was cacheable (${keyResponse.status})`);
    }
    return { sidecar, keys: await keyResponse.json() };
  }

  async loadClearFragment(context, callbacks, stats) {
    const response = await fetch(context.url, { signal: this.abortController.signal, cache: 'no-store' });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    const data = await response.arrayBuffer();
    stats.loaded = data.byteLength;
    stats.total = data.byteLength;
    stats.loading.end = performance.now();
    callbacks.onSuccess({ url: response.url, data, code: response.status, text: response.statusText }, stats, context, null);
  }

  async loadEncryptedFragment(context, callbacks, stats) {
    const { sidecar, keys } = await this.fetchSidecarAndKeys(this.abortController.signal, context.url);
    log('encrypted-stream-metadata', {
      fragment: sidecar.segmentUri,
      recordCount: sidecar.records.length,
      clearBytes: sidecar.clearFragmentBytes || null,
      expectedClearSha256: sidecar.clearFragmentSha256 || environment.clearFragmentSha256,
    });
    await this.initializeWorker(sidecar, keys);

    let offset = 0;
    let expectedTotal = null;
    let etag = null;
    let pending = new Uint8Array(0);
    let pendingClear = new Uint8Array(0);
    let recordCount = 0;
    let mediaFragmentCount = 0;
    let retry = 0;
    const maxRetries = 3;

    while (expectedTotal === null || offset < expectedTotal) {
      const headers = new Headers();
      if (offset > 0) {
        headers.set('Range', `bytes=${offset}-`);
        headers.set('If-Range', etag);
      }
      let response;
      try {
        response = await fetch(context.url, {
          method: 'GET',
          headers,
          signal: this.abortController.signal,
          cache: 'no-store',
        });
      } catch (error) {
        if (this.abortController.signal.aborted) throw error;
        if (retry++ >= maxRetries) throw error;
        pending = new Uint8Array(0);
        stats.retry = retry;
        continue;
      }

      const responseEtag = response.headers.get('etag');
      if (!responseEtag) throw new Error('Encrypted fragment response has no ETag');
      if (offset === 0) {
        if (response.status !== 200) throw Object.assign(new Error(`Initial fragment request returned ${response.status}, expected 200`), { status: response.status });
        expectedTotal = Number(response.headers.get('content-length'));
        etag = responseEtag;
        stats.total = expectedTotal;
      } else {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
        if (response.status !== 206 || !range || Number(range[1]) !== offset || Number(range[3]) !== expectedTotal || responseEtag !== etag) {
          throw new Error('Range resume response did not match the original object and record boundary');
        }
      }
      if (!Number.isSafeInteger(expectedTotal) || expectedTotal <= 0) throw new Error('Invalid encrypted-fragment Content-Length');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Encrypted-fragment response has no ReadableStream');
      let resumeAtRecordBoundary = false;
      let resumeAfterStreamError = false;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          pending = concatenate(pending, value);
          while (pending.length >= 24) {
            const view = new DataView(pending.buffer, pending.byteOffset, pending.byteLength);
            const sequence = view.getUint32(0, false);
            const ciphertextLength = view.getUint32(20, false);
            if (ciphertextLength > 65_536) throw new Error(`Record ${sequence} exceeds the configured size`);
            const recordLength = 24 + ciphertextLength + 32;
            if (pending.length < recordLength) break;
            if (sequence !== recordCount) throw new Error(`Out-of-order record ${sequence}; expected ${recordCount}`);

            const record = pending.slice(0, recordLength);
            const result = await this.workerRequest({ type: 'decrypt', record: record.buffer }, [record.buffer]);
            pending = pending.slice(recordLength);
            offset += recordLength;
            recordCount += 1;
            stats.loaded = offset;
            if (stats.loading.first === 0) {
              stats.loading.first = performance.now();
              mark('firstVerifiedClearRecord', stats.loading.first);
            }
            pendingClear = concatenate(pendingClear, new Uint8Array(result.clear));
            const extracted = extractCompleteMediaFragments(pendingClear);
            pendingClear = extracted.remainder;
            for (const mediaFragment of extracted.fragments) {
              mediaFragmentCount += 1;
              if (mediaFragmentCount === 1) mark('firstCompleteMediaFragment', performance.now());
              callbacks.onProgress?.(stats, context, mediaFragment, null);
            }
            if (pendingClear.byteLength > 2 * 1024 * 1024) {
              throw new Error('Incomplete MP4 media fragment exceeded the 2 MiB streaming limit');
            }

            if (runtime.interruptNext && offset < expectedTotal) {
              runtime.interruptNext = false;
              pending = new Uint8Array(0);
              await reader.cancel('intentional Demo interruption');
              resumeAtRecordBoundary = true;
              log('intentional-interruption', { resumeByte: offset, etag });
              break;
            }
          }
          if (resumeAtRecordBoundary) break;
        }
      } catch (error) {
        await reader.cancel(error.message).catch(() => {});
        if (this.abortController.signal.aborted) throw error;
        if (retry++ >= maxRetries) throw error;
        stats.retry = retry;
        pending = new Uint8Array(0);
        resumeAfterStreamError = true;
        log('network-interruption', { resumeByte: offset, message: error.message });
      }

      if (resumeAtRecordBoundary || resumeAfterStreamError) continue;
      if (pending.length !== 0) {
        if (retry++ >= maxRetries) throw new Error(`Fragment ended with ${pending.length} incomplete record bytes`);
        pending = new Uint8Array(0);
        stats.retry = retry;
        continue;
      }
      if (offset < expectedTotal) {
        if (retry++ >= maxRetries) throw new Error(`Fragment ended at byte ${offset} of ${expectedTotal}`);
        stats.retry = retry;
      }
    }

    if (recordCount !== sidecar.records.length) throw new Error('Downloaded record count does not match sidecar');
    if (pendingClear.byteLength !== 0) throw new Error(`Media segment ended with ${pendingClear.byteLength} bytes outside a complete moof/mdat pair`);
    if (sidecar.mediaMoofCount !== undefined && mediaFragmentCount !== sidecar.mediaMoofCount) {
      throw new Error(`Received ${mediaFragmentCount} complete moof/mdat pairs; expected ${sidecar.mediaMoofCount}`);
    }
    const digest = await this.workerRequest({ type: 'finish' });
    stats.loading.end = performance.now();
    metrics.decryptedFragmentSha256 = digest.clearSha256;
    const expectedHash = sidecar.clearFragmentSha256 || environment.clearFragmentSha256;
    metrics.decryptedHashMatchesBaseline = digest.clearSha256 === expectedHash;
    mark('encryptedFragmentDownloadComplete', stats.loading.end);
    log('decrypted-fragment-sha256', {
      actual: digest.clearSha256,
      expected: expectedHash,
      matches: metrics.decryptedHashMatchesBaseline,
    });
    if (!metrics.decryptedHashMatchesBaseline) throw new Error('Decrypted fragment hash does not match the clear baseline');
    callbacks.onSuccess(
      { url: context.url, data: new ArrayBuffer(0), code: 200, text: 'Progressively decrypted; completion signal only' },
      stats,
      context,
      null,
    );
  }

  load(context, _loaderConfig, callbacks) {
    this.abortController = new AbortController();
    this.callbacks = callbacks;
    this.context = context;
    const path = new URL(context.url).pathname;
    const isEncrypted = /\/encrypted-\d+\.m4s$/.test(path)
      || /\/hevc-ctr-crf-(?:32|30|28)(?:-\d{3})?\.m4s$/.test(path)
      || /\/abrt-ctr-(?:360p|480p|720p)-\d{3}\.m4s$/.test(path);
    (isEncrypted
      ? this.loadEncryptedFragment(context, callbacks, this.stats)
      : this.loadClearFragment(context, callbacks, this.stats)
    ).catch((error) => {
      if (this.abortController?.signal.aborted) {
        callbacks.onAbort?.(this.stats, context, null);
      } else {
        log('fragment-load-error', { message: error.message, stack: error.stack });
        decodeError(callbacks, context, this.stats, error);
      }
      this.cleanupWorker();
    });
  }

  abort() {
    this.abortController?.abort();
    this.cleanupWorker();
  }

  destroy() {
    this.abort();
  }

  cleanupWorker() {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pendingWorkerMessages.values()) pending.reject(new Error('Worker terminated'));
    this.pendingWorkerMessages.clear();
  }
}

function stopPlayer() {
  if (runtime.hls) {
    runtime.hls.destroy();
    runtime.hls = null;
  }
  video.pause();
  video.removeAttribute('src');
  video.load();
}

async function startPlayer({ tamperRecord = null } = {}) {
  stopPlayer();
  logElement.textContent = '';
  metrics = {};
  runtime.startedAt = performance.now();
  const status = await fetch('/api/status', { cache: 'no-store' }).then((response) => response.json());
  environment = status;
  const isPrimaryStream = streamSelect.value === '/output/demo.m3u8';
  await configureServer({ throttleKbps: Number(throttleSelect.value), tamperRecord: isPrimaryStream ? tamperRecord : null });
  log('demo-environment', {
    browser: navigator.userAgent,
    hlsJsVersion: HLSJS_VERSION,
    ffmpegVersion: status.ffmpegVersion,
    selectedStream: streamSelect.value,
    sampleSha256: status.sampleSha256,
    primaryH264ClearFragmentSha256: status.clearFragmentSha256,
    primaryH264ClearFragmentBytes: status.clearFragmentBytes,
    primaryH264EncryptedFragmentBytes: status.encryptedFragmentBytes,
    primaryH264RecordCount: status.recordCount,
    throttleKbps: Number(throttleSelect.value),
  });
  log('playback-start-requested');

  if (!Hls.isSupported()) {
    log('unsupported-browser', { mse: 'MediaSource is not supported' });
    return;
  }
  runtime.hls = new Hls({
    fLoader: DecryptingFragmentLoader,
    progressive: true,
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 30,
  });
  runtime.hls.on(Hls.Events.ERROR, (_event, data) => {
    log('hls-error', {
      type: data.type,
      details: data.details,
      fatal: data.fatal,
      reason: data.reason,
      error: data.error?.message,
      ...(data.details === 'bufferStalledError' ? playbackBufferState() : {}),
    });
  });
  runtime.hls.on(Hls.Events.FRAG_PARSING_DATA, (_event, data) => {
    log('fragment-parsed-chunk', {
      type: data.type,
      startPTS: data.startPTS,
      endPTS: data.endPTS,
      moofBytes: data.data1?.byteLength || 0,
      mdatBytes: data.data2?.byteLength || 0,
    });
  });
  runtime.hls.on(Hls.Events.BUFFER_APPENDING, (_event, data) => {
    log('mse-append-queued', {
      type: data.type,
      bytes: data.data?.byteLength || data.data?.length || 0,
      parent: data.parent,
    });
  });
  runtime.hls.on(Hls.Events.BUFFER_APPENDED, (_event, data) => {
    log('mse-append-complete', { parent: data.parent, pending: data.pending, ...playbackBufferState() });
  });
  runtime.hls.on(Hls.Events.MANIFEST_PARSED, () => {
    log('manifest-parsed');
    video.play().catch((error) => log('autoplay-blocked', { message: error.message }));
  });
  runtime.hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
    const level = runtime.hls.levels[data.level];
    log('abr-level-switched', {
      level: data.level,
      width: level?.width,
      height: level?.height,
      automatic: runtime.hls.autoLevelEnabled,
    });
  });
  runtime.hls.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
    log('abr-fragment-buffered', {
      level: data.frag.level,
      uri: new URL(data.frag.url).pathname,
      sn: data.frag.sn,
      duration: data.frag.duration,
    });
  });
  runtime.hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
    if (data.frag.sn === 0) log('hls-fragment-complete', { bytes: data.frag.stats.loaded });
  });
  runtime.hls.loadSource(streamSelect.value);
  runtime.hls.attachMedia(video);
  video.addEventListener('error', () => log('video-error', { code: video.error?.code, message: video.error?.message }), { once: true });
  if ('requestVideoFrameCallback' in video) {
    video.requestVideoFrameCallback((_now, frame) => {
      mark('firstDecodedVideoFrame', performance.now());
      log('first-frame-metadata', { mediaTime: frame.mediaTime, presentedFrames: frame.presentedFrames });
    });
  } else {
    video.addEventListener('loadeddata', () => mark('firstDecodedVideoFrame'), { once: true });
  }
}

document.querySelector('#play').addEventListener('click', () => startPlayer().catch((error) => log('start-failed', { message: error.message })));
document.querySelector('#stop').addEventListener('click', stopPlayer);
throttleSelect.addEventListener('change', () => {
  configureServer({ throttleKbps: Number(throttleSelect.value) })
    .then(() => log('network-throttle-updated', { throttleKbps: Number(throttleSelect.value) }))
    .catch((error) => log('network-throttle-update-failed', { message: error.message }));
});
document.querySelector('#interrupt').addEventListener('click', () => {
  runtime.interruptNext = true;
  log('interrupt-armed', { note: 'The next encrypted transfer will resume from the next authenticated record boundary.' });
});
document.querySelector('#tamper').addEventListener('click', () => {
  startPlayer({ tamperRecord: Number(tamperSelect.value) }).catch((error) => log('start-failed', { message: error.message }));
});
streamSelect.addEventListener('change', () => {
  const enabled = streamSelect.value === '/output/demo.m3u8';
  tamperSelect.disabled = !enabled;
  tamperButton.disabled = !enabled;
});
document.querySelector('#save-report').addEventListener('click', async () => {
  const report = {
    generatedAt: new Date().toISOString(),
    browserUserAgent: navigator.userAgent,
    hlsJsVersion: HLSJS_VERSION,
    environment,
    metrics,
    eventLog: logElement.textContent,
  };
  const response = await fetch('/api/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  const result = await response.json();
  log(response.ok ? 'report-saved' : 'report-save-failed', result);
});

fetch('/output/sidecar.json', { cache: 'no-store' })
  .then((response) => response.json())
  .then((sidecar) => {
    for (const record of sidecar.records) {
      const option = document.createElement('option');
      option.value = String(record.sequence);
      option.textContent = String(record.sequence);
      tamperSelect.append(option);
    }
  })
  .catch((error) => log('sidecar-read-failed', { message: error.message }));
