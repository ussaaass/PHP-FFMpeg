const video = document.querySelector('#video');
const logElement = document.querySelector('#log');
const throttle = document.querySelector('#throttle');
const button = document.querySelector('#play');
let startedAt = 0;

function log(event, details = {}) {
  const entry = { elapsedMs: Number((performance.now() - startedAt).toFixed(1)), ...details };
  logElement.textContent += `${event} ${JSON.stringify(entry)}\n`;
  logElement.scrollTop = logElement.scrollHeight;
  console.log(event, entry);
}

function concat(a, b) {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

function extractCompletePairs(buffer) {
  const pairs = [];
  let offset = 0;
  let start = -1;
  while (offset + 8 <= buffer.length) {
    let size = new DataView(buffer.buffer, buffer.byteOffset + offset, 4).getUint32(0, false);
    const type = new TextDecoder().decode(buffer.subarray(offset + 4, offset + 8));
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > buffer.length) break;
      const large = new DataView(buffer.buffer, buffer.byteOffset + offset + 8, 8).getBigUint64(0, false);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${type} box is too large`);
      size = Number(large);
      headerSize = 16;
    }
    if (size < headerSize) throw new Error(`Invalid ${type} box size ${size}`);
    if (offset + size > buffer.length) break;
    if (type === 'moof') {
      if (start !== -1) throw new Error('Another moof arrived before the previous mdat');
      start = offset;
    } else if (type === 'mdat') {
      if (start === -1) throw new Error('mdat arrived without a moof');
      pairs.push(buffer.slice(start, offset + size));
      start = -1;
    } else {
      throw new Error(`Unexpected media box ${type}`);
    }
    offset += size;
  }
  return { pairs, remainder: buffer.slice(start === -1 ? offset : start) };
}

function append(sourceBuffer, bytes) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      sourceBuffer.removeEventListener('updateend', onEnd);
      sourceBuffer.removeEventListener('error', onError);
    };
    const onEnd = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('MSE SourceBuffer append failed')); };
    sourceBuffer.addEventListener('updateend', onEnd, { once: true });
    sourceBuffer.addEventListener('error', onError, { once: true });
    sourceBuffer.appendBuffer(bytes);
  });
}

button.addEventListener('click', async () => {
  button.disabled = true;
  startedAt = performance.now();
  const worker = new Worker('/public/decrypt-worker.mjs', { type: 'module' });
  let workerMessageId = 1;
  const pendingWorker = new Map();
  worker.addEventListener('message', event => {
    const pending = pendingWorker.get(event.data.id);
    if (!pending) return;
    pendingWorker.delete(event.data.id);
    if (event.data.error) pending.reject(new Error(event.data.error));
    else pending.resolve(event.data.result);
  });
  const workerRequest = (message, transfer = []) => new Promise((resolve, reject) => {
    const id = workerMessageId++;
    pendingWorker.set(id, { resolve, reject });
    worker.postMessage({ id, ...message }, transfer);
  });

  try {
    const config = await fetch('/api/config', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ throttleKbps: Number(throttle.value) }),
    });
    if (!config.ok) throw new Error(`Network configuration failed (${config.status})`);
    const manifestResponse = await fetch('/output/demo.m3u8', { cache: 'no-store' });
    if (!manifestResponse.ok) throw new Error(`Playlist request failed (${manifestResponse.status})`);
    const manifest = await manifestResponse.text();
    const initName = manifest.match(/#EXT-X-MAP:URI="([^"]+)"/)?.[1];
    const segmentName = manifest.split(/\r?\n/).find(line => line.trim() && !line.startsWith('#'))?.trim();
    const duration = Number(manifest.match(/#EXTINF:([0-9.]+)/)?.[1]);
    if (!initName || !segmentName || !Number.isFinite(duration)) throw new Error('Playlist is missing MAP, EXTINF, or media URI');

    const sidecarResponse = await fetch('/output/sidecar.json', { cache: 'no-store' });
    if (!sidecarResponse.ok) throw new Error(`Sidecar request failed (${sidecarResponse.status})`);
    const sidecar = await sidecarResponse.json();
    if (sidecar.segmentUri !== segmentName) throw new Error('Sidecar media URI does not match the HLS playlist');
    const keyResponse = await fetch(new URL(sidecar.keyUri, sidecarResponse.url), { cache: 'no-store' });
    if (!keyResponse.ok) throw new Error(`Test key request failed (${keyResponse.status})`);
    const keys = await keyResponse.json();
    await workerRequest({ type: 'init', contentId: sidecar.contentId, baseCounter: sidecar.baseCounter, records: sidecar.records, ...keys });

    const mediaSource = new MediaSource();
    video.src = URL.createObjectURL(mediaSource);
    await new Promise((resolve, reject) => {
      mediaSource.addEventListener('sourceopen', resolve, { once: true });
      mediaSource.addEventListener('error', () => reject(new Error('MediaSource failed')), { once: true });
    });
    mediaSource.duration = duration;
    const sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.64001f"');
    const initResponse = await fetch(new URL(initName, manifestResponse.url), { cache: 'no-store' });
    if (!initResponse.ok) throw new Error(`Init segment request failed (${initResponse.status})`);
    await append(sourceBuffer, await initResponse.arrayBuffer());
    log('mse-init-appended', { bytes: Number(initResponse.headers.get('content-length')) });

    video.addEventListener('waiting', () => log('video-waiting', { time: video.currentTime, bufferedEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : null }));
    video.addEventListener('playing', () => log('video-playing', { time: video.currentTime, bufferedEnd: video.buffered.length ? video.buffered.end(video.buffered.length - 1) : null }));
    video.addEventListener('ended', () => log('video-ended', { time: video.currentTime, duration: video.duration }));
    video.requestVideoFrameCallback?.((now, metadata) => log('first-decoded-frame', { time: metadata.mediaTime, presentedFrames: metadata.presentedFrames }));

    const mediaUrl = new URL(segmentName, manifestResponse.url);
    const mediaResponse = await fetch(mediaUrl, { cache: 'no-store' });
    if (!mediaResponse.ok || !mediaResponse.body) throw new Error(`Media request failed (${mediaResponse.status})`);
    const expectedLength = Number(mediaResponse.headers.get('content-length'));
    const reader = mediaResponse.body.getReader();
    let networkBytes = 0;
    let recordNumber = 0;
    let encryptedPending = new Uint8Array(0);
    let clearPending = new Uint8Array(0);
    let mediaPairs = 0;
    let playbackStarted = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      networkBytes += value.byteLength;
      encryptedPending = concat(encryptedPending, value);
      while (encryptedPending.length >= 24) {
        const view = new DataView(encryptedPending.buffer, encryptedPending.byteOffset, encryptedPending.byteLength);
        const sequence = view.getUint32(0, false);
        const cipherBytes = view.getUint32(20, false);
        if (cipherBytes > sidecar.recordSize || sequence !== recordNumber) throw new Error(`Invalid encrypted record ${sequence}; expected ${recordNumber}`);
        const recordBytes = 24 + cipherBytes + 32;
        if (encryptedPending.length < recordBytes) break;
        const record = encryptedPending.slice(0, recordBytes);
        const decrypted = await workerRequest({ type: 'decrypt', record: record.buffer }, [record.buffer]);
        encryptedPending = encryptedPending.slice(recordBytes);
        recordNumber += 1;
        clearPending = concat(clearPending, new Uint8Array(decrypted.clear));
        const extracted = extractCompletePairs(clearPending);
        clearPending = extracted.remainder;
        for (const pair of extracted.pairs) {
          mediaPairs += 1;
          await append(sourceBuffer, pair);
          const bufferedEnd = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
          log('mse-media-fragment-appended', { mediaPairs, bytes: pair.length, bufferedEnd, encryptedBytesReceived: networkBytes, encryptedContentLength: expectedLength });
          if (!playbackStarted && bufferedEnd - video.currentTime >= 2) {
            playbackStarted = true;
            log('initial-buffer-ready', { bufferedEnd, bufferAhead: bufferedEnd - video.currentTime });
            await video.play();
          }
        }
      }
    }
    if (encryptedPending.length || clearPending.length || recordNumber !== sidecar.records.length) throw new Error('Encrypted stream ended with an incomplete record or media fragment');
    if (mediaPairs !== sidecar.mediaMoofCount) throw new Error(`Expected ${sidecar.mediaMoofCount} movie fragments; received ${mediaPairs}`);
    const digest = await workerRequest({ type: 'finish' });
    const matches = digest.clearSha256 === sidecar.clearFragmentSha256;
    log('encrypted-download-complete', { networkBytes, recordNumber, mediaPairs, clearSha256: digest.clearSha256, expectedSha256: sidecar.clearFragmentSha256, matches });
    if (!matches) throw new Error('Decrypted media hash does not match the clear stream baseline');
    mediaSource.endOfStream();
  } catch (error) {
    log('progressive-playback-error', { message: error.message, stack: error.stack });
    console.error(error);
  } finally {
    worker.terminate();
    button.disabled = false;
  }
});
