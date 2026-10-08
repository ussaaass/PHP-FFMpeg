import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright-core';

const baseUrl = process.env.PLAYER_TEST_URL || 'http://127.0.0.1:8791/';
const browserUrl = process.env.PLAYER_BROWSER_URL || baseUrl;
const originUrl = process.env.PLAYER_ORIGIN_URL || 'http://127.0.0.1:8791/';
const cdpEndpoint = process.env.PLAYER_CDP_ENDPOINT || '';
const testMode = process.env.PLAYER_TEST_MODE || 'switch';
const expectUnsupportedCodec = process.env.EXPECT_UNSUPPORTED_CODEC === '1';
const expectKeyProviderTimeout = process.env.EXPECT_KEY_PROVIDER_TIMEOUT === '1';
const expectKeyProviderRejection = process.env.EXPECT_KEY_PROVIDER_REJECTION === '1';
const initialKibps = Number(process.env.PLAYER_TEST_INITIAL_KIBPS || 256);
const holdSegments = Number(process.env.PLAYER_TEST_HOLD_SEGMENTS || 1);
const downlinkKibps = Number(process.env.PLAYER_TEST_DOWN_KIBPS || 128);
const uplinkKibps = Number(process.env.PLAYER_TEST_UP_KIBPS || 512);
const rustfsPrefix = process.env.CTR_TEST_RUSTFS_PREFIX || '';
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || '/ms-playwright/chromium-1243/chrome-linux-arm64/chrome';
const server = spawn(process.execPath, ['test/server.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: '8791' },
  stdio: 'ignore',
});
let browser;
let page;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const originResponse = await fetch(originUrl);
      const playerResponse = await fetch(baseUrl);
      if (originResponse.ok && playerResponse.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'player test server did not start');
  let cdpConnectEndpoint = cdpEndpoint;
  if (cdpEndpoint.startsWith('http://') || cdpEndpoint.startsWith('https://')) {
    const debuggerResponse = await fetch(new URL('/json/version', cdpEndpoint));
    assert.equal(debuggerResponse.ok, true, 'remote Chrome DevTools endpoint is unavailable');
    const debuggerInfo = await debuggerResponse.json();
    const websocket = new URL(debuggerInfo.webSocketDebuggerUrl);
    websocket.hostname = new URL(cdpEndpoint).hostname;
    websocket.port = new URL(cdpEndpoint).port;
    cdpConnectEndpoint = websocket.href;
  }
  browser = cdpEndpoint
    ? await chromium.connectOverCDP(cdpConnectEndpoint)
    : await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  page = cdpEndpoint
    ? await browser.contexts()[0].newPage()
    : await browser.newPage();
  let cdp;
  let rampUpDiagnostics = null;
  const networkTimeline = [];
  const shapedModes = ['auto', 'auto-seek', 'constant', 'ramp-up', 'ramp-down', 'fluctuate', 'weak', 'weak-rustfs'];
  if (shapedModes.includes(testMode) || testMode.startsWith('proxy-')) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    const setDownload = async (bytesPerSecond, label) => {
      networkTimeline.push({ label, bytesPerSecond, at: Date.now() });
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 30,
        downloadThroughput: bytesPerSecond,
        uploadThroughput: 256 * 1024,
        connectionType: 'cellular3g',
      });
    };
    await setDownload(initialKibps * 1024, `initial-${initialKibps}-kibps`);
  }
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
const badResponses = [];
const rustfsSegmentResponses = [];
  const requestLog = [];
  const responseLog = [];
  const outputHashes = [];
  const outputHashTasks = [];
  const safeUrl = value => {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.href;
  };
  const safeRequestHeaders = headers => Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, /authorization|cookie|token|secret|credential|api[-_]?key/i.test(name) ? '[redacted]' : value]));
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => failedRequests.push({ url: safeUrl(request.url()), error: request.failure()?.errorText }));
  page.on('request', request => requestLog.push({ url: safeUrl(request.url()), method: request.method(), headers: safeRequestHeaders(request.headers()), resourceType: request.resourceType() }));
  page.on('response', response => {
    if (response.status() >= 400) badResponses.push({ url: safeUrl(response.url()), status: response.status() });
    if (rustfsPrefix && response.url().startsWith(rustfsPrefix) && response.url().endsWith('.enc.m4s')) {
      rustfsSegmentResponses.push({ url: safeUrl(response.url()), status: response.status() });
    }
    const headers = response.headers();
    const exposed = Object.fromEntries(['accept-ranges', 'cache-control', 'content-range', 'content-length', 'etag', 'access-control-allow-origin', 'access-control-expose-headers', 'content-encoding', 'vary', 'age', 'x-cache'].filter(name => headers[name] !== undefined).map(name => [name, headers[name]]));
    responseLog.push({ url: safeUrl(response.url()), status: response.status(), headers: exposed });
    if (/\.enc\.m4s(?:$|\?)/.test(response.url())) {
      outputHashTasks.push(response.body().then(body => outputHashes.push({ url: safeUrl(response.url()), status: response.status(), sha256: createHash('sha256').update(body).digest('hex'), bytes: body.byteLength })).catch(() => {}));
    }
  });
  const response = await page.goto(`${browserUrl}?mode=${encodeURIComponent(testMode)}`, { waitUntil: 'domcontentloaded' });
  assert.equal(response?.ok(), true, `test page returned HTTP ${response?.status()}`);
  if (shapedModes.includes(testMode)) {
    try {
      await page.waitForFunction(({ requiredSegments, requireLowestLevel }) => {
        const segments = (window.__testEvents || []).filter(event => event.type === 'segment-buffered');
        return requireLowestLevel ? segments.filter(event => event.level === 0).length >= requiredSegments : segments.length >= requiredSegments;
      }, { requiredSegments: holdSegments, requireLowestLevel: testMode === 'auto' && !cdpEndpoint }, { timeout: 30_000 });
    } catch (error) {
      console.error(JSON.stringify({
        initialSegmentWait: error.message,
        playerEvents: await page.evaluate(() => window.__testEvents || []),
        media: await page.locator('#video').evaluate(video => ({ currentTime: video.currentTime, duration: video.duration, paused: video.paused, readyState: video.readyState, networkState: video.networkState, error: video.error?.message })),
        pageErrors,
        consoleErrors,
        failedRequests,
        badResponses,
      }, null, 2));
      throw error;
    }
    if (['auto', 'auto-seek', 'weak', 'weak-rustfs'].includes(testMode)) {
      networkTimeline.push({ label: 'uplink-8-mibps', bytesPerSecond: 8 * 1024 * 1024, at: Date.now() });
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 8 * 1024 * 1024, uploadThroughput: 1024 * 1024, connectionType: 'wifi' });
    }
  }
  if (testMode === 'auto') {
    try {
      await page.waitForFunction(() => window.__testEvents?.some(event => event.type === 'level-switched' && event.automatic && event.level === 2), null, { timeout: 20_000 });
    } catch (error) {
      console.error(JSON.stringify({
        autoEvents: await page.evaluate(() => (window.__testEvents || []).filter(event => event.type === 'level-switched' || event.type === 'segment-buffered')),
        levels: await page.evaluate(() => window.__testPlayer?.getLevels()),
        currentLevel: await page.evaluate(() => window.__testPlayer?.hls?.currentLevel),
        media: await page.locator('#video').evaluate(video => ({ currentTime: video.currentTime, buffered: Array.from({ length: video.buffered.length }, (_, i) => [video.buffered.start(i), video.buffered.end(i)]) })),
      }, null, 2));
      throw error;
    }
    networkTimeline.push({ label: `downlink-${downlinkKibps}-kibps`, bytesPerSecond: downlinkKibps * 1024, at: Date.now() });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: downlinkKibps * 1024, uploadThroughput: 128 * 1024, connectionType: 'cellular3g' });
    await page.waitForFunction(() => {
      const levels = (window.__testEvents || []).filter(event => event.type === 'level-switched' && event.automatic).map(event => event.level);
      const upIndex = levels.indexOf(2);
      return upIndex >= 0 && levels.slice(upIndex + 1).includes(0);
    }, null, { timeout: 25_000 });
    networkTimeline.push({ label: 'recovery-8-mibps', bytesPerSecond: 8 * 1024 * 1024, at: Date.now() });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 8 * 1024 * 1024, uploadThroughput: 1024 * 1024, connectionType: 'wifi' });
  }
  if (testMode === 'auto-seek') {
    await page.waitForFunction(() => window.__testEvents?.some(event => event.type === 'level-switched' && event.automatic && event.level === 2), null, { timeout: 25_000 });
    await page.waitForFunction(() => window.__testEvents?.some(event => event.type === 'seek-after-automatic-switch'), null, { timeout: 5_000 });
    networkTimeline.push({ label: `downlink-${downlinkKibps}-kibps`, bytesPerSecond: downlinkKibps * 1024, at: Date.now() });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: downlinkKibps * 1024, uploadThroughput: 128 * 1024, connectionType: 'cellular3g' });
    await page.waitForFunction(() => {
      const levels = (window.__testEvents || []).filter(event => event.type === 'level-switched' && event.automatic).map(event => event.level);
      const upIndex = levels.indexOf(2);
      return upIndex >= 0 && levels.slice(upIndex + 1).includes(0);
    }, null, { timeout: 25_000 });
    networkTimeline.push({ label: 'recovery-8-mibps', bytesPerSecond: 8 * 1024 * 1024, at: Date.now() });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 8 * 1024 * 1024, uploadThroughput: 1024 * 1024, connectionType: 'wifi' });
  }
  if (testMode === 'ramp-up') {
    const before = await page.evaluate(() => Math.min(...(window.__testEvents || []).filter(event => event.type === 'segment-buffered').map(event => event.level)));
    networkTimeline.push({ label: `uplink-${uplinkKibps}-kibps`, bytesPerSecond: uplinkKibps * 1024, at: Date.now() });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 30, downloadThroughput: uplinkKibps * 1024, uploadThroughput: 256 * 1024, connectionType: 'cellular3g' });
    try {
      await page.waitForFunction(level => (window.__testEvents || []).some(event => event.type === 'segment-buffered' && event.level > level), before, { timeout: 10_000 });
    } catch {
      rampUpDiagnostics = {
        rampUpEvents: await page.evaluate(() => (window.__testEvents || []).filter(event => ['level-switched', 'segment-buffered'].includes(event.type))),
        levels: await page.evaluate(() => window.__testPlayer?.getLevels()),
        currentLevel: await page.evaluate(() => window.__testPlayer?.hls?.currentLevel),
        maxAutoLevel: await page.evaluate(() => window.__testPlayer?.hls?.maxAutoLevel),
        autoLevelEnabled: await page.evaluate(() => window.__testPlayer?.hls?.autoLevelEnabled),
        bandwidthEstimate: await page.evaluate(() => window.__testPlayer?.hls?.bandwidthEstimate),
        abrConfig: await page.evaluate(() => ({ upFactor: window.__testPlayer?.hls?.config.abrBandWidthUpFactor, bandwidthFactor: window.__testPlayer?.hls?.config.abrBandWidthFactor, fastVoD: window.__testPlayer?.hls?.config.abrEwmaFastVoD, slowVoD: window.__testPlayer?.hls?.config.abrEwmaSlowVoD, capLevelToPlayerSize: window.__testPlayer?.hls?.config.capLevelToPlayerSize })),
      };
    }
  }
  if (testMode === 'ramp-down') {
    await page.waitForFunction(() => (window.__testEvents || []).some(event => event.type === 'level-switched' && event.automatic && event.level > 0), null, { timeout: 20_000 });
    networkTimeline.push({ label: `downlink-${downlinkKibps}-kibps`, bytesPerSecond: downlinkKibps * 1024, at: Date.now() });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 100, downloadThroughput: downlinkKibps * 1024, uploadThroughput: 128 * 1024, connectionType: 'cellular3g' });
    await page.waitForFunction(() => (window.__testEvents || []).some(event => event.type === 'level-switched' && event.automatic && event.level === 0), null, { timeout: 45_000 });
  }
  if (testMode === 'fluctuate') {
    const schedule = [64, 512, 128, 512, 64, 512];
    for (const [index, kibps] of schedule.entries()) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      networkTimeline.push({ label: `fluctuation-${index + 1}-${kibps}-kibps`, bytesPerSecond: kibps * 1024, at: Date.now() });
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: kibps <= 128 ? 100 : 30,
        downloadThroughput: kibps * 1024,
        uploadThroughput: 256 * 1024,
        connectionType: kibps <= 128 ? 'cellular3g' : 'wifi',
      });
    }
    networkTimeline.push({ label: 'fluctuation-recovery-8-mibps', bytesPerSecond: 8 * 1024 * 1024, at: Date.now() });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 8 * 1024 * 1024, uploadThroughput: 1024 * 1024, connectionType: 'wifi' });
  }
  try {
    await page.waitForFunction(() => ['passed', 'failed', 'timed-out'].includes(document.documentElement.dataset.testStatus), null, { timeout: ['constant', 'ramp-up', 'ramp-down', 'fluctuate', 'auto-seek'].includes(testMode) ? 180_000 : (testMode === 'rustfs-etag-change' ? 120_000 : 60_000) });
  } catch (error) {
    const mediaState = await page.locator('#video').evaluate(video => ({ currentTime: video.currentTime, duration: video.duration, paused: video.paused, readyState: video.readyState, networkState: video.networkState, error: video.error?.message, buffered: Array.from({ length: video.buffered.length }, (_, i) => [video.buffered.start(i), video.buffered.end(i)]) }));
    const playerEvents = await page.evaluate(() => window.__testEvents || []);
    const diagnostics = await page.evaluate(() => ({
      warnings: window.__testWarnings,
      hlsLevels: window.__testHls?.levels?.map(level => ({ width: level.width, height: level.height, videoCodec: level.videoCodec, audioCodec: level.audioCodec, codecSet: level.codecSet, attrs: level.attrs, url: level.url })),
      hevcTypeSupported: MediaSource.isTypeSupported('video/mp4; codecs="hev1.1.6.L93.B0"'),
      resources: performance.getEntriesByType('resource').map(entry => entry.name),
    }));
    console.error(JSON.stringify({ status: await page.locator('html').getAttribute('data-test-status'), pageErrors, consoleErrors, failedRequests, badResponses, mediaState, playerEvents, diagnostics }, null, 2));
    throw error;
  }
  const result = await page.locator('#result').innerText();
  await Promise.allSettled(outputHashTasks);
  const status = await page.locator('html').getAttribute('data-test-status');
  const parsedResult = JSON.parse(result);
  const injectedShortReadMessages = consoleErrors.filter(message => message.includes('ERR_CONTENT_LENGTH_MISMATCH')).length;
  if (testMode === 'proxy-range' && injectedShortReadMessages !== 3) {
    parsedResult.failures.push({ code: 'injected-short-read-count-mismatch', expected: 3, actual: injectedShortReadMessages });
  }
  let proxyResumeVerification = null;
  if (testMode === 'proxy-range') {
    const segmentRequests = requestLog.filter(request => request.url.endsWith('/v360p/segment_00000.enc.m4s') && /^bytes=(\d+)-/.test(request.headers.range || '') && Number(/^bytes=(\d+)-/.exec(request.headers.range || '')[1]) > 0);
    const boundaries = parsedResult.rustfsRange?.recordBoundaries || [];
    const etag = parsedResult.rustfsRange?.etag;
    proxyResumeVerification = {
      rangeRequestCount: segmentRequests.length,
      requests: segmentRequests.map(request => ({ range: request.headers.range, ifRange: request.headers['if-range'] })),
      allRecordAligned: segmentRequests.every(request => boundaries.includes(Number(/^bytes=(\d+)-$/.exec(request.headers.range || '')?.[1]))),
      allUseOriginalEtag: Boolean(etag) && segmentRequests.every(request => request.headers['if-range'] === etag),
    };
    if (segmentRequests.length !== 3 || !proxyResumeVerification.allRecordAligned || !proxyResumeVerification.allUseOriginalEtag) {
      parsedResult.failures.push({ code: 'proxy-resume-boundary-or-etag-check-failed', proxyResumeVerification });
    }
  }
  const expectedKeyCode = expectKeyProviderTimeout ? 'PLAYER_KEY_PROVIDER_TIMEOUT' : 'PLAYER_KEY_PROVIDER_REJECTED';
  const expectedKeyFailure = expectKeyProviderTimeout || expectKeyProviderRejection;
  const expectedKeyFailureObserved = expectedKeyFailure && parsedResult.failures?.some(error => error.code === expectedKeyCode) === true;
  const report = {
    gitCommit: process.env.PLAYER_TEST_COMMIT || null,
    workingTreeWasDirty: process.env.PLAYER_TEST_WORKTREE_DIRTY === 'true',
    dockerImageId: process.env.PLAYER_TEST_IMAGE_ID || null,
    proxyImageId: process.env.PLAYER_TEST_PROXY_IMAGE_ID || null,
    networkPath: process.env.PLAYER_TEST_NETWORK_PATH || 'local-test-server',
    sampleSha256: process.env.PLAYER_TEST_SAMPLE_SHA256 || null,
    environment: {
      browserVersion: browser.version(),
      nodeVersion: process.version,
      runnerPlatform: process.platform,
      browserPlatform: process.env.PLAYER_BROWSER_ENVIRONMENT || (cdpEndpoint ? 'remote-cdp' : 'docker-linux'),
    },
    browserVersion: browser.version(), testMode, networkTimeline,
    status: expectedKeyFailure && status === 'failed' && expectedKeyFailureObserved
      ? 'passed'
      : (parsedResult.failures?.length ? 'failed' : status),
    expectedBrowserConsoleMessages: testMode === 'proxy-range' ? ['Failed to load resource: net::ERR_CONTENT_LENGTH_MISMATCH'] : [],
    injectedShortReadMessages: testMode === 'proxy-range' ? injectedShortReadMessages : 0,
    expectedOutcome: expectedKeyFailure
      ? { type: 'key-provider-rejection', code: expectedKeyCode, observed: expectedKeyFailureObserved }
      : (testMode === 'rustfs-etag-change' ? {
        type: 'changed-object-etag-rejected',
        observed: parsedResult.expectedRejection === true && parsedResult.failures?.length === 0,
        originalEtag: parsedResult.fault?.originalEtag,
        replacementEtag: parsedResult.fault?.replacementEtag,
        resumeRequest: parsedResult.fault?.resumeRequest,
      } : null),
    proxyResumeVerification,
    rampUpDiagnostics,
    result: parsedResult,
    requestLog, responseLog, outputHashes, failedRequests, badResponses, pageErrors, consoleErrors,
  };
  const serializedReport = JSON.stringify(report, null, 2);
  console.log(serializedReport);
  if (process.env.PLAYER_TEST_REPORT) {
    await mkdir(dirname(process.env.PLAYER_TEST_REPORT), { recursive: true });
    await writeFile(process.env.PLAYER_TEST_REPORT, `${serializedReport}\n`);
  }
  if (expectUnsupportedCodec) {
    assert.equal(status, 'failed', 'an unsupported codec must be rejected explicitly');
    assert.ok(report.result.failures?.some(error => error.code === 'PLAYER_CODEC_UNSUPPORTED'), 'player did not report the explicit unsupported-codec error');
  } else if (expectKeyProviderTimeout) {
    assert.equal(status, 'failed', 'a hung KeyProvider must fail explicitly after its configured timeout');
    assert.ok(report.result.failures?.some(error => error.code === 'PLAYER_KEY_PROVIDER_TIMEOUT'), 'player did not report the explicit key-provider timeout');
  } else if (expectKeyProviderRejection) {
    assert.equal(status, 'failed', 'an unknown keyId must be rejected explicitly');
    assert.ok(report.result.failures?.some(error => error.code === 'PLAYER_KEY_PROVIDER_REJECTED'), 'player did not report the explicit key-provider rejection');
    assert.ok(!serializedReport.includes('secret diagnostic'), 'key-provider error details must be redacted');
  } else {
    assert.equal(report.status, 'passed', 'formal browser playback acceptance did not pass');
  }
  if (rustfsPrefix) {
    assert.ok(rustfsSegmentResponses.length > 0, 'player did not fetch encrypted media segments from the configured object/proxy origin');
    assert.ok(rustfsSegmentResponses.every(item => item.status === 200 || item.status === 206), 'encrypted segment fetch from the configured object/proxy origin returned an error');
  }
  assert.deepEqual(pageErrors, [], 'browser page reported uncaught errors');
} finally {
  await page?.close().catch(() => {});
  if (cdpEndpoint && browser) {
    const shutdown = await browser.newBrowserCDPSession().catch(() => null);
    await shutdown?.send('Browser.close').catch(() => {});
    await shutdown?.detach().catch(() => {});
  }
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
}
