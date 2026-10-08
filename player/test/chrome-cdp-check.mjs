const devtools = process.env.CHROME_CDP || 'http://host.docker.internal:9223';
const pageUrl = process.env.PLAYER_TEST_URL || 'http://127.0.0.1:8791/';
const response = await fetch(`${devtools}/json/new?about:blank`, { method: 'PUT' });
if (!response.ok) throw new Error(`Chrome DevTools target creation failed: HTTP ${response.status}`);
const target = await response.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const mediaRequests = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Network.requestWillBeSent' && /\.enc\.m4s(?:\?|$)/.test(message.params.request.url)) {
    mediaRequests.push({ url: message.params.request.url, headers: message.params.request.headers });
  }
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
});
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.navigate', { url: pageUrl });
  const deadline = Date.now() + 60_000;
  let state;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const result = await send('Runtime.evaluate', {
      expression: `JSON.stringify({status:document.documentElement.dataset.testStatus,result:document.querySelector('#result')?.textContent||'',video:(()=>{const v=document.querySelector('#video');return v?{duration:v.duration,currentTime:v.currentTime,paused:v.paused,readyState:v.readyState}:null})()})`,
      returnByValue: true,
    });
    try { state = JSON.parse(result.result.value); } catch { continue; }
    if (state.status === 'passed' || state.status === 'failed' || state.status === 'timed-out') break;
  }
  console.log(JSON.stringify({ ...state, mediaRequests }, null, 2));
  if (state?.status !== 'passed') process.exitCode = 1;
} finally {
  socket.close();
  await fetch(`${devtools}/json/close/${target.id}`).catch(() => {});
}
