import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(process.env.V2_ACCEPTANCE_ROOT || '../experiments/hls-ctr-v2-acceptance/output');
const playerRoot = resolve(new URL('..', import.meta.url).pathname);
const keyHex = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const signingSecret = 'local-v2-acceptance-signing-secret';
const requests = [];
const truncated = new Set();
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.m3u8': 'application/vnd.apple.mpegurl', '.mp4': 'video/mp4', '.m4s': 'video/iso.segment' };
let browser;

function send(response, status, headers, body) {
  response.writeHead(status, headers);
  response.end(body);
}

function safeUrl(url) {
  const parsed = new URL(url);
  const queryNames = [...parsed.searchParams.keys()];
  parsed.search = '';
  return { url: parsed.href, queryNames };
}

function signed(url, token) {
  return `${url}?sig=${token}&sig=${token}-duplicate`;
}

function objectSignature(path, expiresAt) {
  return createHmac('sha256', signingSecret).update(`${path}\n${expiresAt}`).digest('hex');
}

function signedObject(path, expiresAt = Math.floor(Date.now() / 1000) + 3600) {
  const signature = objectSignature(path, expiresAt);
  return `${path}?exp=${expiresAt}&sig=${signature}&sig=${signature}-duplicate`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  requests.push({ method: request.method, ...safeUrl(url.href), range: request.headers.range || null, ifRange: request.headers['if-range'] || null });
  if (request.method !== 'GET') return send(response, 405, {}, 'method not allowed');
  if (url.pathname === '/') {
    const html = `<!doctype html><meta charset="utf-8"><video id="video" muted playsinline></video><script type="module">
      import { HlsCtrPlayer, PlaybackProfile, RequestPurpose, HttpCredentials } from '/dist/index.js';
      const events = window.__events = [];
      const params = new URL(location.href).searchParams;
      const hevc = params.get('asset') === '43';
      const assetId = hevc ? '43' : '42';
      const keyId = hevc ? 8 : 7;
      const versionId = hevc ? 'v2-browser-hevc-1' : 'v2-browser-h264-1';
      const origin = location.origin;
      const abrProbe = params.get('mode') === 'abr';
      const keyFormat = params.get('keyFormat') === 'raw' ? 'raw' : 'json';
      window.__playbackProfile = PlaybackProfile.CTR_HMAC_V2;
      const video = document.querySelector('#video');
      const player = window.__player = new HlsCtrPlayer(video, {
        allowInsecureHttp: true,
        hlsConfig: { abrEwmaDefaultEstimate: abrProbe ? 3500000 : 650000, abrEwmaFastVoD: 1, abrEwmaSlowVoD: 3, abrBandWidthUpFactor: 0.85, capLevelToPlayerSize: false, maxBufferLength: abrProbe ? 2 : 4, maxMaxBufferLength: abrProbe ? 2 : 8 },
        requestOptions({ purpose }) { if (!Object.values(RequestPurpose).includes(purpose)) throw new Error('Unexpected request purpose'); return { credentials: HttpCredentials.SAME_ORIGIN }; },
        onEvent(event) { events.push(event); },
        onError(error) { events.push({ eventKind: 'player-error', ...error }); },
      });
      window.__ready = player.load({ profile: PlaybackProfile.CTR_HMAC_V2, assetId, keyId, versionId, keyUri: origin + '/key/' + assetId + '?source=app&format=' + keyFormat, masterPlaylistUri: origin + '/master-' + (hevc ? 'hevc' : 'h264') + '.m3u8?sig=master-token' })
        .then(() => player.play()).then(() => true).catch(error => { events.push({ type: 'start-error', code: error.code, error: error.message }); return false; });
      video.addEventListener('playing', () => events.push({ type: 'video-playing', currentTime: video.currentTime }));
      video.addEventListener('ended', () => events.push({ type: 'video-ended', duration: video.duration }));
      video.addEventListener('waiting', () => events.push({ type: 'video-waiting', currentTime: video.currentTime }));
      video.addEventListener('seeking', () => events.push({ type: 'video-seeking', currentTime: video.currentTime }));
    </script>`;
    return send(response, 200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, html);
  }
  if (url.pathname.startsWith('/dist/')) {
    const path = resolve(playerRoot, 'dist', url.pathname.slice('/dist/'.length));
    if (!path.startsWith(resolve(playerRoot, 'dist') + sep)) return send(response, 403, {}, 'forbidden');
    try { return send(response, 200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }, await readFile(path)); } catch { return send(response, 404, {}, 'not found'); }
  }
  if (url.pathname === '/key/42' || url.pathname === '/key/43') {
    if (url.searchParams.get('format') === 'raw') return send(response, 200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' }, Buffer.from(keyHex, 'hex'));
    return send(response, 200, { 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify({ key: keyHex }));
  }
  if (url.pathname === '/master-h264.m3u8') {
    if (url.searchParams.get('sig') !== 'master-token') return send(response, 403, {}, 'invalid master signature');
    const body = [
      '#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS',
      '#EXT-X-STREAM-INF:BANDWIDTH=500000,AVERAGE-BANDWIDTH=385000,RESOLUTION=640x360,CODECS="avc1.64001e"', signed('/renditions/360/playlist.m3u8', 'playlist-360'),
      '#EXT-X-STREAM-INF:BANDWIDTH=1000000,AVERAGE-BANDWIDTH=764000,RESOLUTION=854x480,CODECS="avc1.64001f"', signed('/renditions/480/playlist.m3u8', 'playlist-480'),
      '#EXT-X-STREAM-INF:BANDWIDTH=2000000,AVERAGE-BANDWIDTH=1524000,RESOLUTION=1280x720,CODECS="avc1.64001f"', signed('/renditions/720/playlist.m3u8', 'playlist-720'), '',
    ].join('\n');
    return send(response, 200, { 'content-type': mime['.m3u8'], 'cache-control': 'no-store' }, body);
  }
  if (url.pathname === '/master-hevc.m3u8') {
    if (url.searchParams.get('sig') !== 'master-token') return send(response, 403, {}, 'invalid master signature');
    const body = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-STREAM-INF:BANDWIDTH=1200000,AVERAGE-BANDWIDTH=900000,RESOLUTION=1280x720,CODECS="hvc1.1.6.L93.B0"', signed('/renditions/hevc/playlist.m3u8', 'playlist-hevc'), ''].join('\n');
    return send(response, 200, { 'content-type': mime['.m3u8'], 'cache-control': 'no-store' }, body);
  }
  const rendition = /^\/renditions\/(360|480|720|hevc)\/playlist\.m3u8$/.exec(url.pathname);
  if (rendition) {
    if (url.searchParams.get('sig') !== `playlist-${rendition[1]}`) return send(response, 403, {}, 'invalid playlist signature');
    const edge = rendition[1];
    const source = edge === 'hevc' ? resolve(root, 'hevc/abrt-init-placeholder.m3u8') : resolve(root, `h264/renditions/${edge}/abrt-${edge}p.m3u8`);
    let playlist;
    if (edge === 'hevc') playlist = await readFile(resolve(root, 'hevc/hevc-crf-32.m3u8'), 'utf8');
    else playlist = await readFile(source, 'utf8');
    const asset = edge === 'hevc' ? '000000000000002b' : '000000000000002a';
    const id = edge === 'hevc' ? '8' : edge;
    playlist = playlist.replace(/URI="([^"]+)"/, (_all, uri) => `URI="/init/${edge}/${uri}?sig=init-${edge}"`);
    playlist = playlist.replace(/^\/media\/([^\r\n]+)$/gm, path => signedObject(path));
    return send(response, 200, { 'content-type': mime['.m3u8'], 'cache-control': 'no-store' }, playlist);
  }
  const init = /^\/init\/(360|480|720|hevc)\/([^/]+)$/.exec(url.pathname);
  if (init) {
    const edge = init[1];
    if (url.searchParams.get('sig') !== `init-${edge}`) return send(response, 403, {}, 'invalid init signature');
    const packageRoot = edge === 'hevc' ? resolve(root, 'hevc') : resolve(root, 'h264/renditions', edge);
    const path = resolve(packageRoot, init[2]);
    if (!path.startsWith(packageRoot + sep)) return send(response, 403, {}, 'forbidden');
    try { return send(response, 200, { 'content-type': 'video/mp4', 'cache-control': 'no-store' }, await readFile(path)); } catch { return send(response, 404, {}, 'not found'); }
  }
  if (url.pathname.startsWith('/media/')) {
    const sigs = url.searchParams.getAll('sig');
    const expiresAt = Number(url.searchParams.get('exp'));
    const expectedSignature = objectSignature(url.pathname, expiresAt);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000) || sigs.length !== 2 || sigs[0] !== expectedSignature || sigs[1] !== `${expectedSignature}-duplicate`) return send(response, 403, {}, 'invalid or expired segment signature');
    const encoded = decodeURIComponent(url.pathname.slice('/media/'.length));
    const asset = encoded.startsWith('000000000000002b/') ? 'hevc' : encoded.startsWith('000000000000002a/') ? 'h264' : null;
    if (!asset) return send(response, 404, {}, 'unknown asset');
    const packageRoot = resolve(root, asset);
    const path = resolve(packageRoot, 'media', encoded);
    if (!path.startsWith(packageRoot + sep)) return send(response, 403, {}, 'forbidden');
    let file;
    try { file = await readFile(path); } catch { return send(response, 404, {}, 'not found'); }
    const etag = `"${file.length}-${createHash('sha256').update(file).digest('hex').slice(0, 16)}"`;
    const rangeMatch = /^bytes=(\d+)-$/.exec(request.headers.range || '');
    if (rangeMatch) {
      const offset = Number(rangeMatch[1]);
      if (request.headers['if-range'] !== etag) return send(response, 416, { etag, 'content-range': `bytes */${file.length}` }, 'If-Range mismatch');
      if (offset >= file.length) return send(response, 416, { etag, 'content-range': `bytes */${file.length}` }, 'Range unsatisfiable');
      return send(response, 206, { 'content-type': mime['.m4s'], 'content-length': String(file.length - offset), 'content-range': `bytes ${offset}-${file.length - 1}/${file.length}`, etag, 'accept-ranges': 'bytes' }, file.subarray(offset));
    }
    const rangeOffset = 40 + 24 + (file.readUInt32BE(60) & 0x7fffffff) + 32;
    if (!truncated.has(path) && path.includes('/360/') && path.endsWith('-00000.m4s') && rangeOffset < file.length) {
      truncated.add(path);
      response.writeHead(200, { 'content-type': mime['.m4s'], 'content-length': String(file.length), etag, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
      response.end(file.subarray(0, Math.min(file.length, rangeOffset + 13)));
      return;
    }
    return send(response, 200, { 'content-type': mime['.m4s'], 'content-length': String(file.length), etag, 'accept-ranges': 'bytes', 'cache-control': 'no-store' }, file);
  }
  return send(response, 404, {}, 'not found');
});

await access(resolve(playerRoot, 'dist/index.js'));
await access(resolve(root, 'h264'));
await access(resolve(root, 'hevc'));
await new Promise(resolveListen => server.listen(8793, process.env.V2_ACCEPTANCE_BIND || '127.0.0.1', resolveListen));
if (process.env.V2_ACCEPTANCE_SERVE_ONLY === '1') {
  process.stdout.write('CTR-HLS V2 fixture server listening on port 8793\n');
  await new Promise(() => {});
}

try {
  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || '/ms-playwright/chromium-1243/chrome-linux-arm64/chrome';
  browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const initialPage = await page.goto('http://127.0.0.1:8793/?asset=42', { waitUntil: 'domcontentloaded' });
  try { await page.waitForFunction(() => window.__player && window.__events, null, { timeout: 15_000 }); }
  catch (error) { throw new Error(`H.264 page initialization failed (HTTP ${initialPage?.status()}): ${pageErrors.join(' | ')}`, { cause: error }); }
  try { await page.waitForFunction(() => window.__events.some(event => event.type === 'segment-buffered') || window.__events.some(event => event.eventKind === 'player-error' || event.type === 'start-error'), null, { timeout: 30_000 }); }
  catch (error) {
    const diagnostics = await page.evaluate(() => ({ events: window.__events, media: { currentTime: document.querySelector('#video').currentTime, duration: document.querySelector('#video').duration, readyState: document.querySelector('#video').readyState, networkState: document.querySelector('#video').networkState, error: document.querySelector('#video').error?.message }, levels: window.__player?.getLevels() }));
    throw new Error(`No V2 media segment reached the browser buffer: ${JSON.stringify({ diagnostics, requests })}`, { cause: error });
  }
  assert.ok(await page.evaluate(() => window.__events.some(event => event.type === 'segment-buffered')), `H.264 media loader failed: ${JSON.stringify({ events: await page.evaluate(() => window.__events), requests })}`);
  assert.ok(await page.evaluate(() => window.__player.hls.autoLevelEnabled && window.__player.hls.bandwidthEstimate > 0), 'hls.js must have a live automatic bandwidth estimate');
  await page.evaluate(() => window.__player.setLevel(2));
  await page.waitForFunction(() => window.__events.some(event => event.type === 'segment-buffered' && event.level === 2), null, { timeout: 30_000 });
  const levelTwoEventIndex = await page.evaluate(() => window.__events.findIndex(event => event.type === 'segment-buffered' && event.level === 2));
  await page.evaluate(() => window.__player.setLevel(0));
  await page.waitForFunction(index => window.__events.slice(index + 1).some(event => event.type === 'segment-buffered' && event.level === 0), levelTwoEventIndex, { timeout: 30_000 });
  await page.evaluate(() => { const video = document.querySelector('#video'); if (video.currentTime < 7) video.currentTime = 4.1; });
  await page.waitForFunction(() => window.__events.some(event => event.type === 'video-ended'), null, { timeout: 60_000 });
  const h264 = await page.evaluate(() => ({ events: window.__events, duration: document.querySelector('#video').duration, ended: document.querySelector('#video').ended, levels: window.__player.getLevels() }));
  assert.equal(h264.ended, true, 'H.264 VOD playback must reach ended');
  assert.ok(h264.duration >= 7.5 && h264.duration < 9, `Expected an approximately eight-second video, got ${h264.duration}`);
  assert.ok(h264.levels.length >= 2, 'The master playlist must expose multiple renditions');
  assert.ok(h264.events.some(event => event.type === 'level-switched' && event.level === 2), 'The high rendition selected through setLevel(2) must be observed');
  assert.ok(h264.events.some(event => event.type === 'video-seeking'), 'Seeking must be exercised during playback');
  const h264RequestEnd = requests.length;

  const assetSwitchStart = requests.length;
  await page.evaluate(async () => {
    window.__previousMasterKey = window.__player.session.masterKey;
    await window.__player.load({
      profile: window.__playbackProfile,
      assetId: '43', keyId: 8, versionId: 'v2-browser-hevc-1',
      keyUri: location.origin + '/key/43?source=app&format=json',
      masterPlaylistUri: location.origin + '/master-hevc.m3u8?sig=master-token',
    });
  });
  await page.waitForFunction(() => window.__events.some(event => event.type === 'segment-authenticated' && event.assetId === '43') || window.__events.some(event => event.eventKind === 'player-error' && event.source === 'capability'), null, { timeout: 30_000 });
  const assetSwitchRequests = requests.slice(assetSwitchStart);
  const switchKeyIndex = assetSwitchRequests.findIndex(entry => entry.url.includes('/key/43'));
  const switchMasterIndex = assetSwitchRequests.findIndex(entry => entry.url.includes('/master-hevc'));
  const oldKeyZeroized = await page.evaluate(() => window.__previousMasterKey.every(byte => byte === 0));
  assert.equal(assetSwitchRequests.filter(entry => entry.url.includes('/key/43')).length, 1, 'Switching assets must request exactly one new Key');
  assert.ok(switchMasterIndex > switchKeyIndex && switchKeyIndex >= 0, 'The new asset Key must load before its master playlist');
  assert.equal(oldKeyZeroized, true, 'Switching assets must clear the previous master Key buffer');

  const assetSwitchEnd = requests.length;
  const abrPage = await context.newPage();
  abrPage.on('pageerror', error => pageErrors.push(error.message));
  await abrPage.goto('http://127.0.0.1:8793/?asset=42&mode=abr&keyFormat=raw', { waitUntil: 'domcontentloaded' });
  const abrCdp = await context.newCDPSession(abrPage);
  await abrCdp.send('Network.enable');
  await abrCdp.send('Network.emulateNetworkConditions', { offline: false, latency: 15, downloadThroughput: 12 * 1024 * 1024, uploadThroughput: 1024 * 1024, connectionType: 'wifi' });
  await abrPage.waitForFunction(() => window.__events?.some(event => event.type === 'level-switched' && event.automatic && event.level > 0), null, { timeout: 20_000 });
  await abrPage.waitForFunction(() => window.__events?.some(event => event.type === 'segment-buffered' && event.level > 0), null, { timeout: 20_000 });
  await abrCdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 64 * 1024, uploadThroughput: 64 * 1024, connectionType: 'cellular3g' });
  try {
    await abrPage.waitForFunction(() => {
      const levels = window.__events.filter(event => event.type === 'level-switched' && event.automatic).map(event => event.level);
      const up = levels.findIndex(level => level > 0);
      return up >= 0 && levels.slice(up + 1).includes(0);
    }, null, { timeout: 30_000 });
  } catch (error) {
    const abrDiagnostics = await abrPage.evaluate(() => ({ events: window.__events, currentLevel: window.__player.hls.currentLevel, bandwidthEstimate: window.__player.hls.bandwidthEstimate, maxAutoLevel: window.__player.hls.maxAutoLevel }));
    throw new Error(`Automatic ABR did not downswitch under the shaped link: ${JSON.stringify(abrDiagnostics)}`, { cause: error });
  }
  const abrEvents = await abrPage.evaluate(() => window.__events.filter(event => event.type === 'level-switched' && event.automatic));
  const abrRequestEnd = requests.length;
  const abrRequests = requests.slice(assetSwitchEnd, abrRequestEnd);
  assert.equal(abrRequests.filter(entry => entry.url.includes('/key/42')).length, 1, 'The raw-octet playback session must request one Key');
  await abrPage.evaluate(() => window.__player.destroy());

  const hevcPage = await context.newPage();
  hevcPage.on('pageerror', error => pageErrors.push(error.message));
  hevcPage.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await hevcPage.goto('http://127.0.0.1:8793/?asset=43', { waitUntil: 'domcontentloaded' });
  await hevcPage.waitForFunction(() => window.__player && window.__events, null, { timeout: 15_000 });
  const hevcSupported = await hevcPage.evaluate(() => MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"'));
  if (hevcSupported) {
    await hevcPage.waitForFunction(() => window.__events.some(event => event.type === 'video-ended'), null, { timeout: 60_000 });
  } else {
    await hevcPage.waitForFunction(() => window.__events.some(event => event.eventKind === 'player-error'), null, { timeout: 30_000 });
  }
  const hevc = await hevcPage.evaluate(() => ({ events: window.__events, ended: document.querySelector('#video').ended, supported: MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"') }));
  const h264Requests = requests.slice(0, h264RequestEnd).filter(entry => entry.url.includes('/key/42') || entry.url.includes('/master-h264') || entry.url.includes('/media/000000000000002a/'));
  const keyRequestIndex = h264Requests.findIndex(entry => entry.url.includes('/key/42'));
  const masterRequestIndex = h264Requests.findIndex(entry => entry.url.includes('/master-h264'));
  assert.equal(h264Requests.filter(entry => entry.url.includes('/key/42')).length, 1, 'One playback must request one video Key');
  assert.ok(keyRequestIndex >= 0 && masterRequestIndex > keyRequestIndex, 'Key must load before master playlist');
  assert.equal(requests.some(entry => entry.url.includes('.json')), false, 'Playback must not request JSON sidecars');
  const rangeRequest = h264Requests.find(entry => entry.range);
  const objectPaths = [...new Set(h264Requests.filter(entry => entry.url.startsWith('http://127.0.0.1/media/')).map(entry => new URL(entry.url).pathname))];
  assert.ok(objectPaths.length >= 2, 'The signed HLS fixture must expose at least two concrete media objects');
  const expiresAt = Math.floor(Date.now() / 1000) + 600;
  const firstObjectSignature = objectSignature(objectPaths[0], expiresAt);
  const expiredProbe = await fetch(`http://127.0.0.1:8793${signedObject(objectPaths[0], 1)}`);
  const crossObjectProbe = await fetch(`http://127.0.0.1:8793${objectPaths[1]}?exp=${expiresAt}&sig=${firstObjectSignature}&sig=${firstObjectSignature}-duplicate`);
  assert.equal(expiredProbe.status, 403, 'Expired object signatures must be rejected');
  assert.equal(crossObjectProbe.status, 403, 'A signature for another object must be rejected');
  assert.ok(rangeRequest, 'The truncated encrypted segment must resume with Range');
  assert.ok(rangeRequest.queryNames.includes('sig'), 'Range request must keep the signed object URI query');
  assert.equal(rangeRequest.ifRange !== null, true, 'Range request must include If-Range');
  assert.equal(pageErrors.length, 0, `Browser page errors: ${pageErrors.join('; ')}`);

  const report = {
    browser: await page.evaluate(() => navigator.userAgent),
    h264: { duration: h264.duration, ended: h264.ended, levelCount: h264.levels.length, manualSelections: [2, 0], events: h264.events },
    automaticAbr: abrEvents,
    hevc: { supported: hevc.supported, ended: hevc.ended, codecErrors: hevc.events.filter(event => event.eventKind === 'player-error') },
    requestEvidence: {
      keyBeforeMaster: true,
      keyRequestCount: h264Requests.filter(entry => entry.url.includes('/key/42')).length,
      h264KeyResponseFormat: 'json-hex',
      automaticAbrKeyRequestCount: abrRequests.filter(entry => entry.url.includes('/key/42')).length,
      automaticAbrKeyResponseFormat: 'raw-octet-stream',
      switchedAssetKeyRequestCount: assetSwitchRequests.filter(entry => entry.url.includes('/key/43')).length,
      switchedAssetKeyBeforeMaster: switchKeyIndex >= 0 && switchMasterIndex > switchKeyIndex,
      previousKeyBufferZeroized: oldKeyZeroized,
      expiredSignatureStatus: expiredProbe.status,
      crossObjectSignatureStatus: crossObjectProbe.status,
      sidecarRequestCount: requests.filter(entry => entry.url.includes('.json')).length,
      rangeRequest: { url: rangeRequest.url, queryNames: rangeRequest.queryNames, range: rangeRequest.range, ifRangePresent: Boolean(rangeRequest.ifRange) },
      serverRangeCount: h264Requests.filter(entry => entry.range).length,
      signedQueriesRetained: rangeRequest.queryNames.includes('sig'),
    },
    errors: pageErrors,
    consoleErrors,
  };
  const reportPath = resolve(root, '../browser-acceptance-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ reportPath, ...report }, null, 2)}\n`);
  assert.equal(report.requestEvidence.sidecarRequestCount, 0);
  assert.equal(report.requestEvidence.signedQueriesRetained, true);
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
