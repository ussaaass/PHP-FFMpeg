import { writeFile } from 'node:fs/promises';
import { chromium } from '/pw/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.addInitScript(() => {
    window.__mseAppends = [];
    const original = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (input) {
      const row = { bytes: input.byteLength, timestampOffset: this.timestampOffset, appendWindowStart: this.appendWindowStart, appendWindowEnd: this.appendWindowEnd };
      window.__mseAppends.push(row);
      this.addEventListener('error', () => { row.error = 'SourceBuffer error'; }, { once: true });
      this.addEventListener('updateend', () => {
        row.buffered = Array.from({ length: this.buffered.length }, (_, i) => [this.buffered.start(i), this.buffered.end(i)]);
      }, { once: true });
      return original.call(this, input);
    };
  });
  await page.goto('http://127.0.0.1:8790/', { waitUntil: 'networkidle' });
  await page.locator('#throttle').selectOption('64');
  const started = Date.now();
  await page.locator('#play').click();
  let text = '';
  while (Date.now() - started < 45000) {
    await page.waitForTimeout(250);
    text = await page.locator('#log').textContent();
    if (text.includes('video-ended') || text.includes('fragment-load-error')) break;
  }
  const video = await page.locator('#video').evaluate(element => ({
    currentTime: element.currentTime,
    duration: element.duration,
    ended: element.ended,
    paused: element.paused,
    buffered: Array.from({ length: element.buffered.length }, (_, i) => [element.buffered.start(i), element.buffered.end(i)]),
  }));
  const timing = name => {
    const match = text.match(new RegExp(`${name} \\{"millisecondsFromStart":([0-9.]+)\\}`));
    return match ? Number(match[1]) : null;
  };
  const firstFrameMs = timing('firstDecodedVideoFrame');
  const downloadCompleteMs = timing('encryptedFragmentDownloadComplete');
  const mseAppends = await page.evaluate(() => window.__mseAppends);
  const result = {
    browser: await page.evaluate(() => navigator.userAgent),
    durationMs: Date.now() - started,
    video,
    browserErrors,
    mseAppends,
    log: text,
    firstFrameMs,
    downloadCompleteMs,
    firstFrameBeforeFullDownload: firstFrameMs !== null && downloadCompleteMs !== null && firstFrameMs < downloadCompleteMs,
  };
  await writeFile('/evidence/progressive-browser-report.json', `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ browser: result.browser, durationMs: result.durationMs, video, browserErrors, tail: text.slice(-7000) }, null, 2));
  if (browserErrors.length || !video.ended) process.exitCode = 1;
} finally {
  await browser.close();
}
