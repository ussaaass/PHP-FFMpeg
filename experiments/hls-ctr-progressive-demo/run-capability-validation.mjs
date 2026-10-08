import { writeFile } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { createServer as createTcpServer, connect as connectTcp } from 'node:net';
const cdpPort = Number(process.env.CDP_PORT || 9222);
const version = await new Promise((resolve, reject) => {
  const request = httpGet({ hostname: 'host.docker.internal', port: cdpPort, path: '/json/version', headers: { Host: 'localhost' }, setHost: false }, response => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => body += chunk);
    response.on('end', () => response.statusCode === 200 ? resolve(JSON.parse(body)) : reject(new Error(`CDP version endpoint returned ${response.statusCode}`)));
  });
  request.on('error', reject);
});
const wsPath = new URL(version.webSocketDebuggerUrl).pathname;
const proxy = createTcpServer(client => {
  const upstream = connectTcp(cdpPort, 'host.docker.internal');
  let handshake = true;
  client.on('data', chunk => {
    if (handshake) {
      const boundary = chunk.indexOf('\r\n\r\n');
      if (boundary >= 0) {
        const head = chunk.subarray(0, boundary + 4).toString().replace(/Host: [^\r\n]+/i, 'Host: localhost');
        upstream.write(Buffer.concat([Buffer.from(head), chunk.subarray(boundary + 4)]));
        handshake = false;
        return;
      }
    }
    upstream.write(chunk);
  });
  upstream.on('data', chunk => client.write(chunk));
  client.on('error', () => upstream.destroy());
  upstream.on('error', () => client.destroy());
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
});
await new Promise(resolve => proxy.listen(9223, '127.0.0.1', resolve));
const socket = new WebSocket(`ws://127.0.0.1:9223${wsPath}`);
let commandId = 0;
const pending = new Map();
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  const item = pending.get(message.id);
  if (!item) return;
  pending.delete(message.id);
  if (message.error) item.reject(new Error(message.error.message));
  else item.resolve(message.result);
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++commandId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
let sessionId;
let targetId;
const navigate = async url => {
  if (!targetId) {
    const targets = await send('Target.getTargets');
    const existing = targets.targetInfos.find(target => target.type === 'page' && target.url.startsWith('http://127.0.0.1:8790/'));
    if (existing) targetId = existing.targetId;
    else targetId = (await send('Target.createTarget', { url: 'about:blank' })).targetId;
    const attached = await send('Target.attachToTarget', { targetId, flatten: true });
    sessionId = attached.sessionId;
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
  }
  await send('Page.navigate', { url }, sessionId);
  const expectedPath = new URL(url).pathname;
  await waitFor(`location.pathname===${JSON.stringify(expectedPath)}`);
};
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || result.exceptionDetails.exception?.description);
  return result.result?.value;
};
const clickTrusted = async selector => {
  const rect = await evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, sessionId);
};
const waitFor = async (expression, timeout = 30000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await evaluate(expression)) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
};
const report = { checks: {} };
function compactReport(value) {
  const relevant = /decrypted-fragment-sha256|encrypted-stream-metadata|encrypted-download-complete|encryptedFragmentDownloadComplete|firstVerifiedClearRecord|firstDecodedVideoFrame|first-frame-metadata|video-(ended|waiting|playing)|mse-media-fragment-appended|abr-level-switched|abr-fragment-buffered|level-switched|fragment-buffered|manual-level-selected|intentional-interruption|network-interruption|hls-error|fragment-load-error|bufferSeekOverHole/;
  const compact = input => {
    if (Array.isArray(input)) return input.map(compact);
    if (!input || typeof input !== 'object') return typeof input === 'string' && input.includes('\n') ? input.split('\n').filter(line => relevant.test(line)).join('\n') : input;
    const output = {};
    for (const [key, item] of Object.entries(input)) {
      if (key === 'html') continue;
      if (key === 'log' && typeof item === 'string') output[key] = item.split('\n').filter(line => relevant.test(line)).join('\n');
      else output[key] = compact(item);
    }
    return output;
  };
  return compact(value);
}

try {
  await navigate('http://127.0.0.1:8790/codec-abr');
  report.browser = await evaluate('navigator.userAgent');
  await waitFor("document.querySelector('#fixture-status')?.textContent.includes('ready')", 120000);
  report.checks.hevcCapability = await evaluate(`(() => ({
    h264: MediaSource.isTypeSupported('video/mp4; codecs="avc1.64001f"'),
    hev1L93: MediaSource.isTypeSupported('video/mp4; codecs="hev1.1.6.L93.B0"'),
    hvc1L93: MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"'),
    status: document.querySelector('#codec-status').textContent,
  }))()`);

  await evaluate("document.querySelector('#stream').value='/output/hevc-crf-32.m3u8'; document.querySelector('#stream').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#throttle').value='0'; document.querySelector('#throttle').dispatchEvent(new Event('change',{bubbles:true})); true");
  await clickTrusted('#play');
  await waitFor("['fragment-buffered','hls-error','video-ended'].some(event=>document.querySelector('#log').textContent.includes(event))", 20000);
  if (!(await evaluate("document.querySelector('#video').ended"))) {
    await waitFor("document.querySelector('#video').ended || document.querySelector('#log').textContent.includes('\\\"fatal\\\":true')", 30000);
  }
  report.checks.hevcClearPlayback = await evaluate(`(() => ({
    video: { width: document.querySelector('#video').videoWidth, height: document.querySelector('#video').videoHeight, duration: document.querySelector('#video').duration, ended: document.querySelector('#video').ended },
    log: document.querySelector('#log').textContent,
  }))()`);

  await navigate('http://127.0.0.1:8790/codec-abr');
  await waitFor("document.querySelector('#fixture-status')?.textContent.includes('ready')");
  await evaluate("document.querySelector('#stream').value='/output/abrt-master.m3u8'; document.querySelector('#stream').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#throttle').value='64'; document.querySelector('#throttle').dispatchEvent(new Event('change',{bubbles:true})); true");
  await clickTrusted('#play');
  await waitFor("document.querySelector('#log').textContent.includes('manifest-parsed')");
  try { await waitFor("document.querySelector('#video').ended || document.querySelector('#log').textContent.includes('fatal')", 30000); } catch {}
  report.checks.abrAuto = await evaluate(`(() => ({
    video:{width:document.querySelector('#video').videoWidth,height:document.querySelector('#video').videoHeight,duration:document.querySelector('#video').duration,ended:document.querySelector('#video').ended,currentTime:document.querySelector('#video').currentTime},
    levels:Array.from(document.querySelectorAll('#level option')).map(option=>({label:option.textContent,value:option.value})),
    log:document.querySelector('#log').textContent,
  }))()`);

  await navigate('http://127.0.0.1:8790/codec-abr');
  await waitFor("document.querySelector('#fixture-status')?.textContent.includes('ready')");
  await evaluate("document.querySelector('#stream').value='/output/abrt-master.m3u8'; document.querySelector('#stream').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#throttle').value='128'; document.querySelector('#throttle').dispatchEvent(new Event('change',{bubbles:true})); true");
  await clickTrusted('#play');
  await waitFor("document.querySelector('#log').textContent.includes('manifest-parsed')");
  await new Promise(resolve => setTimeout(resolve, 2500));
  const availableLevels = await evaluate("Array.from(document.querySelectorAll('#level option')).map(option=>({label:option.textContent,value:option.value}))");
  await evaluate("document.querySelector('#level').value='2'; document.querySelector('#level').dispatchEvent(new Event('change',{bubbles:true})); true");
  await new Promise(resolve => setTimeout(resolve, 2500));
  report.checks.abr = await evaluate(`(() => ({
    availableLevels: Array.from(document.querySelectorAll('#level option')).map(option => ({ label: option.textContent, value: option.value })),
    currentVideo: { width: document.querySelector('#video').videoWidth, height: document.querySelector('#video').videoHeight, currentTime: document.querySelector('#video').currentTime },
    log: document.querySelector('#log').textContent,
  }))()`);
  report.checks.abr.availableLevels = availableLevels;

  await navigate('http://127.0.0.1:8790/');
  await waitFor("document.querySelector('#stream')?.querySelector('option[value=\"/output/abrt-ctr-master.m3u8\"]')");
  await new Promise(resolve => setTimeout(resolve, 500));
  await evaluate("document.querySelector('#stream').value='/output/abrt-ctr-master.m3u8'; document.querySelector('#stream').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#throttle').value='64'; document.querySelector('#throttle').dispatchEvent(new Event('change',{bubbles:true})); true");
  await clickTrusted('#play');
  await waitFor("document.querySelector('#log').textContent.includes('encrypted-stream-metadata') && document.querySelector('#log').textContent.includes('decrypted-fragment-sha256')", 20000);
  await evaluate("document.querySelector('#throttle').value='512'; document.querySelector('#throttle').dispatchEvent(new Event('change',{bubbles:true})); true");
  try { await waitFor("document.querySelector('#video').ended || document.querySelector('#log').textContent.includes('fatal')", 30000); } catch {}
  report.checks.encryptedAbr = await evaluate(`(() => ({
    video:{width:document.querySelector('#video').videoWidth,height:document.querySelector('#video').videoHeight,duration:document.querySelector('#video').duration,ended:document.querySelector('#video').ended,currentTime:document.querySelector('#video').currentTime,buffered:Array.from({length:document.querySelector('#video').buffered.length},(_,i)=>[document.querySelector('#video').buffered.start(i),document.querySelector('#video').buffered.end(i)])},
    log:document.querySelector('#log').textContent,
  }))()`);

  await navigate('http://127.0.0.1:8790/public/progressive.html');
  await waitFor("document.querySelector('#play')");
  await new Promise(resolve => setTimeout(resolve, 1500));
  await evaluate("document.querySelector('#throttle').value='0'; document.querySelector('#throttle').dispatchEvent(new Event('change',{bubbles:true})); true");
  await clickTrusted('#play');
  await new Promise(resolve => setTimeout(resolve, 12000));
  report.checks.progressivePlayerState = await evaluate("({url:location.href,title:document.title,html:document.body.innerText.slice(0,400),log:document.querySelector('#log')?.textContent})");
  const progressiveLog = await evaluate("document.querySelector('#log').textContent");
  if (progressiveLog.includes('encrypted-download-complete')) {
    await evaluate("document.querySelector('#video').currentTime=3.2; true");
    await waitFor("Math.abs(document.querySelector('#video').currentTime-3.2)<0.2", 10000);
    await new Promise(resolve => setTimeout(resolve, 800));
    report.checks.progressiveSeekResume = await evaluate("document.querySelector('#video').play().then(()=>({started:true}),error=>({started:false,error:error.message}))");
    if (report.checks.progressiveSeekResume.started) await waitFor("document.querySelector('#video').currentTime>3.5", 5000);
  }
  report.checks.progressiveSeek = await evaluate(`(() => ({
    currentTime: document.querySelector('#video').currentTime,
    duration: document.querySelector('#video').duration,
    ended: document.querySelector('#video').ended,
    completedDownload: document.querySelector('#log').textContent.includes('encrypted-download-complete'),
    buffered: Array.from({length:document.querySelector('#video').buffered.length},(_,i)=>[document.querySelector('#video').buffered.start(i),document.querySelector('#video').buffered.end(i)]),
    log: document.querySelector('#log').textContent,
  }))()`);

  await navigate('http://127.0.0.1:8790/');
  await waitFor("document.querySelector('#stream')");
  await new Promise(resolve => setTimeout(resolve, 400));
  await evaluate("document.querySelector('#stream').value='/output/hevc-ctr-crf-32.m3u8'; document.querySelector('#stream').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#throttle').value='0'; document.querySelector('#throttle').dispatchEvent(new Event('change',{bubbles:true})); true");
  await clickTrusted('#play');
  try {
    await waitFor("document.querySelector('#video').ended || document.querySelector('#log').textContent.includes('fragment-load-error')", 25000);
  } catch {}
  report.checks.hevcCtrPlayback = await evaluate(`(() => ({
    video: {width:document.querySelector('#video').videoWidth,height:document.querySelector('#video').videoHeight,duration:document.querySelector('#video').duration,ended:document.querySelector('#video').ended,currentTime:document.querySelector('#video').currentTime,buffered:Array.from({length:document.querySelector('#video').buffered.length},(_,i)=>[document.querySelector('#video').buffered.start(i),document.querySelector('#video').buffered.end(i)])},
    log:document.querySelector('#log').textContent,
  }))()`);

  await navigate('http://127.0.0.1:8790/');
  await waitFor("document.querySelector('#interrupt')");
  await new Promise(resolve => setTimeout(resolve, 400));
  await evaluate("document.querySelector('#throttle').value='0'; document.querySelector('#throttle').dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#interrupt').click(); true");
  await clickTrusted('#play');
  await waitFor("document.querySelector('#log').textContent.includes('encryptedFragmentDownloadComplete') || document.querySelector('#log').textContent.includes('fragment-load-error')", 25000);
  report.checks.recordBoundaryResume = await evaluate(`(() => ({
    log:document.querySelector('#log').textContent,
    video:{width:document.querySelector('#video').videoWidth,height:document.querySelector('#video').videoHeight,duration:document.querySelector('#video').duration,buffered:Array.from({length:document.querySelector('#video').buffered.length},(_,i)=>[document.querySelector('#video').buffered.start(i),document.querySelector('#video').buffered.end(i)])},
  }))()`);

  report.checks.range = await evaluate(`(async () => {
    const mediaUrl = '/output/encrypted-0.m4s';
    const head = await fetch(mediaUrl, { method: 'HEAD', cache: 'no-store' });
    const etag = head.headers.get('etag');
    const totalBytes = Number(head.headers.get('content-length'));
    const sidecar = await (await fetch('/output/sidecar.json', { cache: 'no-store' })).json();
    const boundary = 24 + sidecar.records[0].ciphertextLength + 32;
    const first = await fetch(mediaUrl, { headers: { Range: 'bytes=0-' + (boundary - 1), 'If-Range': etag }, cache: 'no-store' });
    const firstBytes = new Uint8Array(await first.arrayBuffer());
    const resumed = await fetch(mediaUrl, { headers: { Range: 'bytes=' + boundary + '-', 'If-Range': etag }, cache: 'no-store' });
    const resumedBytes = new Uint8Array(await resumed.arrayBuffer());
    const full = new Uint8Array(await (await fetch(mediaUrl, { cache: 'no-store' })).arrayBuffer());
    const reconstructed = new Uint8Array(firstBytes.length + resumedBytes.length);
    reconstructed.set(firstBytes); reconstructed.set(resumedBytes, firstBytes.length);
    const matchingHeaders = { firstStatus: first.status, firstContentRange: first.headers.get('content-range'), firstBytes: firstBytes.length, resumeStatus: resumed.status, resumeContentRange: resumed.headers.get('content-range'), resumedBytes: resumedBytes.length, boundary, reconstructedBytes: reconstructed.length, matchesFullResponse: reconstructed.length === full.length && reconstructed.every((byte, index) => byte === full[index]) };
    const stale = await fetch(mediaUrl, { headers: { Range: 'bytes=1000-1999', 'If-Range': '"stale-entity"' }, cache: 'no-store' });
    const staleHeaders = { status: stale.status, contentRange: stale.headers.get('content-range'), bytes: (await stale.arrayBuffer()).byteLength };
    return { totalBytes, etag, matching: matchingHeaders, staleIfRange: staleHeaders };
  })()`);

  const compact = compactReport(report);
  await writeFile('/workspace/experiments/hls-ctr-progressive-demo/capability-validation-report.json', `${JSON.stringify(compact, null, 2)}\n`);
  console.log(JSON.stringify(compact, null, 2));
} catch (error) {
  report.error = error.message;
  const compact = compactReport(report);
  await writeFile('/workspace/experiments/hls-ctr-progressive-demo/capability-validation-report.json', `${JSON.stringify(compact, null, 2)}\n`);
  console.error(JSON.stringify(compact, null, 2));
  throw error;
} finally {
  if (targetId) await send('Target.closeTarget', { targetId }).catch(() => {});
  socket.close();
  proxy.close();
}
