import { writeFile } from 'node:fs/promises';
import { env } from 'node:process';
import { chromium } from '/pw/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8790/public/progressive.html', { waitUntil: 'networkidle' });
  await page.locator('#throttle').selectOption(env.THROTTLE || '64');
  const started = Date.now();
  await page.locator('#play').click();
  let log = '';
  while (Date.now() - started < 45000) {
    await page.waitForTimeout(250);
    log = await page.locator('#log').textContent();
    if (log.includes('video-ended') || log.includes('progressive-playback-error')) break;
  }
  const video = await page.locator('#video').evaluate(element => ({
    currentTime: element.currentTime,
    duration: element.duration,
    ended: element.ended,
    paused: element.paused,
    buffered: Array.from({ length: element.buffered.length }, (_, i) => [element.buffered.start(i), element.buffered.end(i)]),
  }));
  const timestamp = event => {
    const match = log.match(new RegExp(`${event} \\{"elapsedMs":([0-9.]+)`));
    return match ? Number(match[1]) : null;
  };
  const report = {
    browser: await page.evaluate(() => navigator.userAgent),
    durationMs: Date.now() - started,
    firstDecodedFrameMs: timestamp('first-decoded-frame'),
    playbackStartedMs: timestamp('video-playing'),
    initialBufferReadyMs: timestamp('initial-buffer-ready'),
    encryptedDownloadCompleteMs: timestamp('encrypted-download-complete'),
    video,
    errors,
    log,
  };
  await writeFile(env.REPORT_PATH || '/evidence/progressive-mse-report.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, log: log.slice(-6000) }, null, 2));
  if (errors.length || log.includes('progressive-playback-error') || !video.ended) process.exitCode = 1;
} finally {
  await browser.close();
}
