import Hls from '/public/vendor/hls.mjs';

const video = document.querySelector('#video');
const logElement = document.querySelector('#log');
const streamSelect = document.querySelector('#stream');
const levelSelect = document.querySelector('#level');
const throttleSelect = document.querySelector('#throttle');
const codecStatus = document.querySelector('#codec-status');
const fixtureStatus = document.querySelector('#fixture-status');
const playButton = document.querySelector('#play');
let hls = null;

function log(message, details) {
  const suffix = details === undefined ? '' : ` ${JSON.stringify(details)}`;
  logElement.textContent += `${new Date().toISOString()} ${message}${suffix}\n`;
  logElement.scrollTop = logElement.scrollHeight;
}

function codecSupport() {
  if (typeof MediaSource === 'undefined') {
    return { mse: false, h264: false, hvc1: false, hev1: false, canPlayHvc1: '' };
  }
  const supports = codec => MediaSource.isTypeSupported(`video/mp4; codecs="${codec}"`);
  return {
    mse: true,
    h264: supports('avc1.64001f'),
    hvc1: supports('hvc1.1.6.L93.B0'),
    hev1: supports('hev1.1.6.L93.B0'),
    canPlayHvc1: video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"'),
  };
}

const support = codecSupport();
codecStatus.textContent = `Browser: ${navigator.userAgent}\nMSE: ${support.mse}; H.264 avc1: ${support.h264}; HEVC hvc1: ${support.hvc1}; HEVC hev1: ${support.hev1}; canPlayType(hvc1): ${support.canPlayHvc1 || 'unsupported'}`;
log('codec-capabilities', support);

async function pollFixtureStatus() {
  try {
    const response = await fetch('/api/codec-abr/status', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Fixture status request failed (${response.status})`);
    const result = await response.json();
    fixtureStatus.textContent = result.status === 'ready'
      ? 'Test streams are ready: three H.264 renditions and 720p HEVC CRF 32/30/28.'
      : result.status === 'error'
        ? `Test stream generation failed during ${result.phase}: ${result.error}`
        : `Generating test streams: ${result.phase}. HEVC 720p CRF encodes are in progress.`;
    playButton.disabled = result.status !== 'ready';
    streamSelect.disabled = result.status !== 'ready';
    if (result.status === 'pending' || result.status === 'generating') setTimeout(pollFixtureStatus, 2000);
  } catch (error) {
    fixtureStatus.textContent = error.message;
    setTimeout(pollFixtureStatus, 4000);
  }
}

pollFixtureStatus();

async function setThrottle(value) {
  const response = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ throttleKbps: Number(value) }),
  });
  if (!response.ok) throw new Error(`Could not set network limit (${response.status})`);
  log('network-limit', { KiBPerSecond: Number(value) });
}

function stopPlayback() {
  hls?.destroy();
  hls = null;
  video.pause();
  video.removeAttribute('src');
  video.load();
  levelSelect.replaceChildren(new Option('Automatic ABR', '-1'));
}

document.querySelector('#play').addEventListener('click', async () => {
  stopPlayback();
  logElement.textContent = '';
  await setThrottle(throttleSelect.value);
  if (!Hls.isSupported()) {
    log('hlsjs-mse-not-supported');
    return;
  }

  hls = new Hls({
    startLevel: -1,
    capLevelToPlayerSize: false,
    enableWorker: true,
  });
  const current = hls;
  current.on(Hls.Events.ERROR, (_, data) => log('hls-error', {
    type: data.type,
    details: data.details,
    fatal: data.fatal,
    reason: data.reason,
  }));
  current.on(Hls.Events.MEDIA_ATTACHED, () => {
    current.loadSource(streamSelect.value);
    log('media-attached', { playlist: streamSelect.value });
  });
  current.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
    levelSelect.replaceChildren(new Option('Automatic ABR', '-1'));
    data.levels.forEach((level, index) => {
      levelSelect.add(new Option(`${level.height || '?'}p · ${(level.bitrate / 1000).toFixed(0)} kbit/s`, String(index)));
    });
    log('manifest-parsed', {
      levels: data.levels.map(level => ({ height: level.height, bitrate: level.bitrate, codec: level.videoCodec })),
    });
    current.startLoad(-1);
    video.play().catch(error => log('autoplay-blocked', { message: error.message }));
  });
  current.on(Hls.Events.LEVEL_SWITCHED, (_, data) => log('level-switched', {
    level: data.level,
    height: current.levels[data.level]?.height,
    automatic: current.autoLevelEnabled,
  }));
  current.on(Hls.Events.FRAG_BUFFERED, (_, data) => log('fragment-buffered', {
    level: data.frag.level,
    duration: data.frag.duration,
    url: data.frag.url,
  }));
  video.addEventListener('resize', () => log('video-size', { width: video.videoWidth, height: video.videoHeight }), { once: true });
  current.attachMedia(video);
});

document.querySelector('#stop').addEventListener('click', async () => {
  stopPlayback();
  throttleSelect.value = '0';
  await setThrottle('0');
  log('stopped');
});

levelSelect.addEventListener('change', () => {
  if (!hls) return;
  const level = Number(levelSelect.value);
  hls.currentLevel = level;
  log(level === -1 ? 'automatic-abr-enabled' : 'manual-level-selected', { level });
});

throttleSelect.addEventListener('change', () => setThrottle(throttleSelect.value).catch(error => log('network-limit-error', { message: error.message })));

window.addEventListener('pagehide', () => {
  navigator.sendBeacon('/api/config', new Blob([JSON.stringify({ throttleKbps: 0 })], { type: 'application/json' }));
});
