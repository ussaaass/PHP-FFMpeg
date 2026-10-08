import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, extname, resolve, sep } from 'node:path';

const packageRoot = resolve(new URL('../', import.meta.url).pathname);
const outputRoot = resolve(process.env.CTR_TEST_OUTPUT || resolve(packageRoot, '.test-output'));
const replacementRoot = resolve(outputRoot, '..', `.${basename(outputRoot)}-etag-replacement`);
const port = Number(process.env.PORT || 8791);
const rustfsPrefix = process.env.CTR_TEST_RUSTFS_PREFIX || '';
const truncationLimit = process.env.TRUNCATE_RESPONSE_COUNT === undefined
  ? (process.env.TRUNCATE_FIRST_RESPONSE === '1' ? 1 : 0)
  : Number(process.env.TRUNCATE_RESPONSE_COUNT);
const rustfsFaultUpstream = process.env.RUSTFS_FAULT_UPSTREAM_URL || '';
const mutateAfterTruncation = process.env.MUTATE_ETAG_AFTER_TRUNCATION === '1';
const testStatus = { forcedTruncation: false, truncatedResponses: 0, rangeRequests: 0, objectChanged: false };
const rustfsFaultStatus = { enabled: Boolean(rustfsFaultUpstream), initialInterrupted: false, awaitingReplacement: false, replacementConfirmed: false, originalEtag: null, replacementEtag: null, resumeRequest: null };
let releaseRustfsResponse;
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.m3u8': 'application/vnd.apple.mpegurl', '.mp4': 'video/mp4', '.m4s': 'video/iso.segment',
};

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/test-status') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(testStatus));
    return;
  }
  if (pathname === '/test-rustfs') {
    response.writeHead(rustfsPrefix ? 200 : 404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ prefix: rustfsPrefix }));
    return;
  }
  if (pathname === '/rustfs-fault-status') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(rustfsFaultStatus));
    return;
  }
  if (pathname === '/rustfs-fault-continue' && request.method === 'POST') {
    const replacementEtag = new URL(request.url, 'http://localhost').searchParams.get('etag');
    rustfsFaultStatus.replacementEtag = replacementEtag;
    rustfsFaultStatus.replacementConfirmed = Boolean(replacementEtag && replacementEtag !== rustfsFaultStatus.originalEtag);
    rustfsFaultStatus.awaitingReplacement = false;
    releaseRustfsResponse?.();
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ replacementConfirmed: rustfsFaultStatus.replacementConfirmed }));
    return;
  }
  if (pathname.startsWith('/rustfs-proxy/') && rustfsFaultUpstream) {
    try {
      const objectKey = pathname.slice('/rustfs-proxy/'.length);
      const target = new URL(objectKey + new URL(request.url, 'http://localhost').search, `${rustfsFaultUpstream.replace(/\/$/, '')}/`);
      const headers = new Headers();
      for (const name of ['range', 'if-range', 'if-none-match', 'if-modified-since']) {
        if (request.headers[name]) headers.set(name, request.headers[name]);
      }
      const upstream = await fetch(target, { method: request.method, headers, redirect: 'manual' });
      const responseHeaders = {};
      for (const name of ['accept-ranges', 'cache-control', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
        const value = upstream.headers.get(name);
        if (value !== null) responseHeaders[name] = value;
      }
      if (request.headers.range) {
        rustfsFaultStatus.resumeRequest = {
          range: request.headers.range,
          ifRange: request.headers['if-range'] || null,
          status: upstream.status,
          etag: upstream.headers.get('etag'),
          contentRange: upstream.headers.get('content-range'),
        };
      }
      response.writeHead(upstream.status, responseHeaders);
      if (request.method === 'HEAD' || !upstream.body) { response.end(); return; }

      const shouldInterrupt = request.method === 'GET' && pathname.endsWith('.enc.m4s')
        && !request.headers.range && !rustfsFaultStatus.initialInterrupted;
      const reader = upstream.body.getReader();
      if (shouldInterrupt) {
        rustfsFaultStatus.originalEtag = upstream.headers.get('etag');
        const limit = 70_000;
        let delivered = 0;
        while (delivered < limit) {
          const { value, done } = await reader.read();
          if (done) break;
          const length = Math.min(value.byteLength, limit - delivered);
          response.write(Buffer.from(value.buffer, value.byteOffset, length));
          delivered += length;
        }
        rustfsFaultStatus.initialInterrupted = true;
        rustfsFaultStatus.awaitingReplacement = true;
        await new Promise(resolve => { releaseRustfsResponse = resolve; });
        releaseRustfsResponse = null;
        await reader.cancel().catch(() => {});
        response.destroy();
        return;
      }
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!response.write(Buffer.from(value))) await new Promise(resolve => response.once('drain', resolve));
      }
      response.end();
    } catch (error) {
      if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('RustFS proxy request failed');
    }
    return;
  }
  if (pathname === '/favicon.ico') {
    response.writeHead(204).end();
    return;
  }
  let path;
  if (pathname === '/') path = resolve(packageRoot, 'test/browser.html');
  else if (pathname.startsWith('/dist/')) path = resolve(packageRoot, pathname.slice(1));
  else if (pathname.startsWith('/media/')) path = resolve(outputRoot, pathname.slice('/media/'.length));
  else {
    response.writeHead(404).end();
    return;
  }
  if (!(path === outputRoot || path.startsWith(outputRoot + sep) || path.startsWith(packageRoot + sep))) {
    response.writeHead(403).end();
    return;
  }
  try {
    await access(path);
    if (rustfsPrefix && pathname === '/media/master.m3u8') {
      const playlist = (await readFile(path, 'utf8')).replace(/^([^#\r\n][^\r\n]*)$/gm, (_line, uri) => `${rustfsPrefix}${uri}`);
      response.writeHead(200, { 'Content-Type': mime['.m3u8'], 'Content-Length': Buffer.byteLength(playlist), 'Cache-Control': 'no-store' });
      response.end(playlist);
      return;
    }
    let servedPath = path;
    if (testStatus.objectChanged && pathname.endsWith('.enc.m4s')) {
      const replacementPath = resolve(replacementRoot, pathname.slice('/media/'.length));
      if (replacementPath.startsWith(replacementRoot + sep)) {
        try { await access(replacementPath); servedPath = replacementPath; } catch {}
      }
    }
    const fileInfo = await stat(servedPath);
    const size = fileInfo.size;
    const etag = `"${size}-${fileInfo.mtimeMs}${servedPath !== path ? '-replacement' : ''}"`;
    const range = /^bytes=(\d+)-$/.exec(request.headers.range || '');
    if (range) {
      const start = Number(range[1]);
      process.stdout.write(`${JSON.stringify({ event: 'range-request', path: pathname, start, ifRange: request.headers['if-range'] || null })}\n`);
      if (start >= size || (request.headers['if-range'] && request.headers['if-range'] !== etag)) {
        response.writeHead(416, { 'Content-Range': `bytes */${size}`, ETag: etag }).end();
        return;
      }
      ++testStatus.rangeRequests;
      const rangeHeaders = {
        'Content-Type': mime[extname(path)] || 'application/octet-stream',
        'Content-Length': size - start,
        'Content-Range': `bytes ${start}-${size - 1}/${size}`,
        'Cache-Control': 'no-store',
        ETag: etag,
      };
      if (testStatus.truncatedResponses < truncationLimit) {
        ++testStatus.truncatedResponses;
        const truncateAt = Math.min(size - start - 1, 70_000);
        response.writeHead(206, { ...rangeHeaders, 'X-Accel-Buffering': 'no' });
        const stream = createReadStream(servedPath, { start, end: start + truncateAt - 1 });
        stream.pipe(response, { end: false });
        stream.on('end', () => response.destroy());
      } else {
        response.writeHead(206, rangeHeaders);
        createReadStream(servedPath, { start }).pipe(response);
      }
      return;
    }

    const shouldTruncate = truncationLimit > testStatus.truncatedResponses && path.endsWith('.enc.m4s');
    if (shouldTruncate) process.stdout.write(`${JSON.stringify({ event: 'truncate-response', path: pathname, size, truncateAt: Math.min(size - 1, 70_000) })}\n`);
    response.writeHead(200, {
      'Content-Type': mime[extname(path)] || 'application/octet-stream',
      'Content-Length': size,
      'Cache-Control': 'no-store',
      ...(shouldTruncate ? { 'X-Accel-Buffering': 'no' } : {}),
      ETag: etag,
    });
    if (shouldTruncate) {
      testStatus.forcedTruncation = true;
      ++testStatus.truncatedResponses;
      const truncateAt = Math.min(size - 1, 70_000);
      const stream = createReadStream(servedPath, { start: 0, end: truncateAt - 1 });
      stream.pipe(response, { end: false });
      stream.on('end', async () => {
        if (mutateAfterTruncation) {
          const replacement = await readFile(servedPath);
          replacement[replacement.length - 1] ^= 1;
          const replacementPath = resolve(replacementRoot, pathname.slice('/media/'.length));
          if (!replacementPath.startsWith(replacementRoot + sep)) throw new Error('Invalid ETag replacement path');
          await mkdir(dirname(replacementPath), { recursive: true });
          await writeFile(replacementPath, replacement);
          testStatus.objectChanged = true;
        }
        response.end();
      });
    } else {
      createReadStream(servedPath).pipe(response);
    }
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(port, '0.0.0.0', () => process.stdout.write(`CTR player test server listening at http://127.0.0.1:${port}\n`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
