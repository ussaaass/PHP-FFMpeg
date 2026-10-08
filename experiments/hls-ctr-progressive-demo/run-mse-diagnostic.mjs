import { chromium } from '/pw/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('console', message => console.log(`browser-console ${message.type()}: ${message.text()}`));
  page.on('pageerror', error => console.log(`browser-error: ${error.message}`));
  await page.goto('http://127.0.0.1:8790/', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const video = document.querySelector('#video');
    const source = new MediaSource();
    video.src = URL.createObjectURL(source);
    await new Promise(resolve => source.addEventListener('sourceopen', resolve, { once: true }));
    source.duration = 8.008;
    const buffer = source.addSourceBuffer('video/mp4; codecs="avc1.64001f"');
    const append = data => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('append timed out; updating=' + buffer.updating)), 5000);
      buffer.addEventListener('error', () => reject(new Error('SourceBuffer error')), { once: true });
      buffer.addEventListener('updateend', () => { clearTimeout(timeout); resolve(); }, { once: true });
      buffer.appendBuffer(data);
    });
    const init = await (await fetch('/output/init.mp4')).arrayBuffer();
    console.log('appending init', init.byteLength);
    await append(init);
    const media = new Uint8Array(await (await fetch('/output/clear-0.m4s')).arrayBuffer());
    const ranges = [];
    let offset = 0;
    while (offset + 8 <= media.length) {
      const size = new DataView(media.buffer, media.byteOffset + offset, 4).getUint32(0);
      const type = new TextDecoder().decode(media.subarray(offset + 4, offset + 8));
      if (!size || offset + size > media.length) throw new Error(`bad ${type} size ${size} at ${offset}`);
      offset += size;
      if (type === 'mdat') {
        console.log('appending media fragment', ranges.length + 1, offset);
        await append(media.slice(ranges.length ? ranges.at(-1).end : 0, offset));
        ranges.push({ end: offset, buffered: Array.from({ length: video.buffered.length }, (_, i) => [video.buffered.start(i), video.buffered.end(i)]) });
      }
    }
    source.endOfStream();
    return { mime: buffer.type, mediaBytes: media.length, fragmentCount: ranges.length, ranges, duration: video.duration };
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
