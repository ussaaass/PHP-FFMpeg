import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptSegment, getDemoKeys } from './crypto-records.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const outputDir = process.env.OUTPUT_DIR || join(root, 'output');
const samplePath = process.env.SAMPLE_PATH || '/input/source.mp4';
const port = Number(process.env.PORT || 8789);
const hlsVersion = '1.7.3';
const state = {
  throttleKbps: 0,
  tamperRecord: null,
  codecAbrFixtures: { status: 'pending', phase: 'queued', error: null },
};
let artifact = null;
const validDemoContentIds = new Set();

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`FFmpeg failed (${result.status}):\n${result.stderr}`);
  }
}

function runFfmpegAsync(args) {
  return new Promise((resolveFfmpeg, rejectFfmpeg) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-8192);
    });
    child.on('error', rejectFfmpeg);
    child.on('close', code => {
      if (code === 0) resolveFfmpeg();
      else rejectFfmpeg(new Error(`FFmpeg exited with status ${code}:\n${stderr}`));
    });
  });
}

async function inspectFastStart(path) {
  const file = await open(path, 'r');
  try {
    const { size: fileSize } = await file.stat();
    const boxes = [];
    let offset = 0;
    let moovOffset = -1;
    let mdatOffset = -1;
    while (offset + 8 <= fileSize) {
      const header = Buffer.alloc(16);
      const { bytesRead } = await file.read(header, 0, 16, offset);
      if (bytesRead < 8) break;
      let boxSize = header.readUInt32BE(0);
      const type = header.toString('ascii', 4, 8);
      let headerSize = 8;
      if (boxSize === 1) {
        if (bytesRead < 16) throw new Error(`Truncated extended MP4 box header in ${path}`);
        const largeSize = header.readBigUInt64BE(8);
        if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`MP4 box ${type} is too large`);
        boxSize = Number(largeSize);
        headerSize = 16;
      } else if (boxSize === 0) {
        boxSize = fileSize - offset;
      }
      if (boxSize < headerSize || offset + boxSize > fileSize) throw new Error(`Invalid MP4 box ${type} in ${path}`);
      boxes.push(type);
      if (type === 'moov') moovOffset = offset;
      if (type === 'mdat') {
        mdatOffset = offset;
        break;
      }
      offset += boxSize;
    }
    return { boxes, moovOffset, mdatOffset, moovBeforeMdat: moovOffset >= 0 && mdatOffset > moovOffset };
  } finally {
    await file.close();
  }
}

function splitFragmentedMp4(data) {
  let offset = 0;
  let firstMoof = -1;
  let trailer = data.length;
  const boxes = [];
  while (offset + 8 <= data.length) {
    let size = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > data.length) throw new Error('Truncated extended ISO BMFF box header');
      const largeSize = data.readBigUInt64BE(offset + 8);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`ISO BMFF box ${type} is too large`);
      size = Number(largeSize);
      headerSize = 16;
    } else if (size === 0) {
      size = data.length - offset;
    }
    if (size < headerSize || offset + size > data.length) throw new Error(`Invalid ISO BMFF box ${type} at ${offset}`);
    boxes.push({ type, offset, size });
    if (type === 'moof' && firstMoof < 0) firstMoof = offset;
    if (type === 'mfra') trailer = offset;
    offset += size;
  }
  if (offset !== data.length || firstMoof < 0 || boxes[0]?.type !== 'ftyp') {
    throw new Error('Fragmented MP4 is missing a valid ftyp/moof layout');
  }
  const moov = boxes.find(box => box.type === 'moov');
  const mdat = boxes.find(box => box.type === 'mdat');
  if (!moov || !mdat || moov.offset > mdat.offset || moov.offset + moov.size > firstMoof) {
    throw new Error('Fast-start fragmented MP4 must place moov before media data and the first moof');
  }
  return {
    init: data.subarray(0, firstMoof),
    media: data.subarray(firstMoof, trailer),
    boxTypes: boxes.map(box => box.type),
    firstMoofOffset: firstMoof,
    trailerRemoved: trailer < data.length,
  };
}

async function createArtifacts() {
  try {
    await access(samplePath);
  } catch {
    throw new Error(`Sample file is missing or unreadable: ${samplePath}`);
  }
  const sourceFastStart = await inspectFastStart(samplePath);
  if (!sourceFastStart.moovBeforeMdat) {
    throw new Error(`Source MP4 is not fast-start (moov must precede mdat): ${samplePath}`);
  }
  await mkdir(outputDir, { recursive: true });
  for (const name of [
    'clear.m3u8',
    'clear-init.mp4',
    'clear-0.m4s',
    'faststart.mp4',
    'fragmented.mp4',
    'faststart-record.json',
    'init.mp4',
    'encrypted-0.m4s',
    'encrypted-0.json',
    'encrypted-1.m4s',
    'encrypted-1.json',
    'sidecar.json',
    'demo.m3u8',
    'build-record.json',
    'session-report.json',
  ]) {
    await rm(join(outputDir, name), { force: true });
  }
  for (const name of await readdir(outputDir)) {
    if (/^clear-segment-\d+\.m4s$/.test(name) || /^encrypted-\d+\.(?:m4s|json)$/.test(name)) {
      await rm(join(outputDir, name), { force: true });
    }
  }

  runFfmpeg([
    '-hide_banner', '-y', '-ss', '0', '-i', samplePath, '-t', '8',
    '-map', '0:v:0', '-an', '-vf', 'scale=-2:480', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-b:v', '500k', '-maxrate', '600k', '-bufsize', '1200k', '-preset', 'veryfast',
    '-g', '15', '-keyint_min', '15', '-sc_threshold', '0',
    '-force_key_frames', 'expr:gte(t,n_forced*0.5)', '-movflags', '+faststart',
    join(outputDir, 'faststart.mp4'),
  ]);
  const intermediateFastStart = await inspectFastStart(join(outputDir, 'faststart.mp4'));
  if (!intermediateFastStart.moovBeforeMdat) throw new Error('FFmpeg faststart intermediate has moov after mdat');
  runFfmpeg([
    '-hide_banner', '-y', '-i', join(outputDir, 'faststart.mp4'), '-map', '0:v:0', '-c', 'copy',
    '-movflags', '+empty_moov+default_base_moof', '-frag_duration', '500000', '-f', 'mp4',
    join(outputDir, 'fragmented.mp4'),
  ]);
  const fragmented = splitFragmentedMp4(await readFile(join(outputDir, 'fragmented.mp4')));
  const clearInit = fragmented.init;
  const clearFragment = fragmented.media;
  await writeFile(join(outputDir, 'init.mp4'), clearInit);
  await writeFile(join(outputDir, 'clear-0.m4s'), clearFragment);
  await writeFile(join(outputDir, 'faststart-record.json'), `${JSON.stringify({
    sourceFastStart,
    generatedIntermediate: 'faststart.mp4',
    generatedIntermediateFastStart: intermediateFastStart,
    initBytes: clearInit.length,
    mediaBytes: clearFragment.length,
    firstMoofOffset: fragmented.firstMoofOffset,
    fragmentBoxCount: fragmented.boxTypes.filter(type => type === 'moof').length,
    boxTypes: fragmented.boxTypes,
    mfraTrailerRemoved: fragmented.trailerRemoved,
    fragmentDurationTargetSeconds: 0.5,
  }, null, 2)}\n`);

  const contentId = randomUUID().toLowerCase();
  validDemoContentIds.add(contentId);
  const encrypted = encryptSegment(clearFragment, contentId);
  const segmentName = 'encrypted-0.m4s';
  await writeFile(join(outputDir, segmentName), encrypted.encrypted);
  const sidecar = {
    schemaVersion: 1,
    contentId,
    segmentUri: segmentName,
    keyUri: `../demo-key/${contentId}`,
    recordSize: 65536,
    mediaMoofCount: fragmented.boxTypes.filter(type => type === 'moof').length,
    baseCounter: encrypted.baseCounter,
    records: encrypted.records,
    clearFragmentSha256: sha256(clearFragment),
    clearFragmentBytes: clearFragment.length,
  };
  await writeFile(join(outputDir, 'sidecar.json'), `${JSON.stringify(sidecar, null, 2)}\n`);
  await writeFile(join(outputDir, 'clear.m3u8'), '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:9\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:8.008,\nclear-0.m4s\n#EXT-X-ENDLIST\n');
  await writeFile(join(outputDir, 'demo.m3u8'), '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:9\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:8.008,\nencrypted-0.m4s\n#EXT-X-ENDLIST\n');
  const mediaFragments = [{ contentId, clearFragment, encrypted, segmentName }];
  const firstFragment = mediaFragments[0];

  const ffmpegVersion = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).stdout.split('\n')[0];
  const ffprobeVersion = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).stdout.split('\n')[0];
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,profile,codec_tag_string,width,height,pix_fmt,r_frame_rate,avg_frame_rate',
    '-of', 'json', join(outputDir, 'clear.m3u8'),
  ], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(`FFprobe could not inspect the generated media:\n${probe.stderr}`);
  const videoStream = JSON.parse(probe.stdout).streams?.[0];
  if (!videoStream || videoStream.codec_name !== 'h264' || videoStream.pix_fmt !== 'yuv420p') {
    throw new Error(`Generated fragment is not H.264 8-bit yuv420p: ${probe.stdout}`);
  }
  const buildRecord = {
    generatedAt: new Date().toISOString(),
    sampleFile: 'source.mp4',
    sampleSha256: await sha256File(samplePath),
    clearFragmentSha256: sha256(clearFragment),
    encryptedFragmentSha256: sha256(encrypted.encrypted),
    clearInitSha256: sha256(clearInit),
    clearFragmentBytes: clearFragment.length,
    encryptedFragmentBytes: encrypted.encrypted.length,
    recordCount: encrypted.records.length,
    segmentCount: mediaFragments.length,
    totalClearMediaBytes: mediaFragments.reduce((total, segment) => total + segment.clearFragment.length, 0),
    nodeVersion: process.version,
    ffmpegVersion,
    ffprobeVersion,
    videoStream,
    hlsJsVersion: hlsVersion,
    dockerBaseImage: 'node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6',
  };
  await writeFile(join(outputDir, 'build-record.json'), `${JSON.stringify(buildRecord, null, 2)}\n`);
  artifact = { contentId, records: encrypted.records, buildRecord };
  console.log(JSON.stringify({ event: 'demo-ready', ...buildRecord }));
}

async function createCodecAbrFixtures() {
  state.codecAbrFixtures = { status: 'generating', phase: 'h264-abr', error: null };
  for (const name of await readdir(outputDir)) {
    if (/^abrt-.*\.(m3u8|mp4|m4s|json)$/.test(name) || /^hevc-(?:crf-(?:28|30|32)(?:-init)?(?:-\d+)?|ctr-crf-(?:28|30|32)(?:-\d+)?)\.(m3u8|mp4|m4s|json)$/.test(name)) {
      await rm(join(outputDir, name), { force: true });
    }
  }

  await runFfmpegAsync([
    '-hide_banner', '-y', '-ss', '0', '-i', samplePath, '-t', '8',
    '-filter_complex', '[0:v]split=3[a][b][c];[a]scale=-2:360[v0];[b]scale=-2:480[v1];[c]scale=-2:720[v2]',
    '-map', '[v0]', '-map', '[v1]', '-map', '[v2]', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    '-b:v:0', '350k', '-maxrate:v:0', '400k', '-bufsize:v:0', '700k',
    '-b:v:1', '700k', '-maxrate:v:1', '800k', '-bufsize:v:1', '1400k',
    '-b:v:2', '1400k', '-maxrate:v:2', '1600k', '-bufsize:v:2', '2800k',
    '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
    '-hls_flags', 'independent_segments', '-hls_fmp4_init_filename', 'abrt-init-%v.mp4',
    '-hls_segment_filename', join(outputDir, 'abrt-%v-%03d.m4s'), '-master_pl_name', 'abrt-master.m3u8',
    '-var_stream_map', 'v:0,name:360p v:1,name:480p v:2,name:720p', join(outputDir, 'abrt-%v.m3u8'),
  ]);

  const clearAbrMaster = await readFile(join(outputDir, 'abrt-master.m3u8'), 'utf8');
  await writeFile(join(outputDir, 'abrt-ctr-master.m3u8'), clearAbrMaster.replace(/abrt-(360p|480p|720p)\.m3u8/g, 'abrt-ctr-$1.m3u8'));
  for (const rendition of ['360p', '480p', '720p']) {
    const clearPlaylistName = `abrt-${rendition}.m3u8`;
    const encryptedPlaylistName = `abrt-ctr-${rendition}.m3u8`;
    const clearPlaylist = (await readFile(join(outputDir, clearPlaylistName), 'utf8')).split(/\r?\n/);
    const encryptedPlaylist = [];
    for (const line of clearPlaylist) {
      const sourceName = line.trim();
      const match = new RegExp(`^abrt-${rendition}-(\\d{3})\\.m4s$`).exec(sourceName);
      if (!match) {
        encryptedPlaylist.push(line);
        continue;
      }
      const clearBytes = await readFile(join(outputDir, sourceName));
      const contentId = randomUUID().toLowerCase();
      validDemoContentIds.add(contentId);
      const encrypted = encryptSegment(clearBytes, contentId);
      const segmentName = `abrt-ctr-${rendition}-${match[1]}.m4s`;
      const sidecarName = segmentName.replace(/\.m4s$/, '.json');
      await writeFile(join(outputDir, segmentName), encrypted.encrypted);
      await writeFile(join(outputDir, sidecarName), `${JSON.stringify({
        schemaVersion: 1,
        contentId,
        segmentUri: segmentName,
        keyUri: `../demo-key/${contentId}`,
        rendition,
        recordSize: 65536,
        baseCounter: encrypted.baseCounter,
        records: encrypted.records,
        clearFragmentSha256: sha256(clearBytes),
        clearFragmentBytes: clearBytes.length,
      }, null, 2)}\n`);
      encryptedPlaylist.push(segmentName);
    }
    if (!encryptedPlaylist.some(line => line.trim().startsWith(`abrt-ctr-${rendition}-`))) {
      throw new Error(`No H.264 ABR media segments found for ${rendition}`);
    }
    await writeFile(join(outputDir, encryptedPlaylistName), `${encryptedPlaylist.join('\n')}\n`);
  }

  for (const crf of [32, 30, 28]) {
    state.codecAbrFixtures = { status: 'generating', phase: `hevc-crf-${crf}`, error: null };
    await runFfmpegAsync([
      '-hide_banner', '-y', '-ss', '0', '-i', samplePath, '-t', '8',
      '-map', '0:v:0', '-an', '-vf', 'scale=-2:720', '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', String(crf),
      '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error:pools=3:frame-threads=3:keyint=60:min-keyint=60:scenecut=0',
      '-force_key_frames', 'expr:gte(t,n_forced*2)', '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod',
      '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', `hevc-crf-${crf}-init.mp4`,
      '-hls_segment_filename', join(outputDir, `hevc-crf-${crf}-%03d.m4s`), join(outputDir, `hevc-crf-${crf}.m3u8`),
    ]);

    const clearPlaylistName = `hevc-crf-${crf}.m3u8`;
    const playlistName = `hevc-ctr-crf-${crf}.m3u8`;
    const clearPlaylist = (await readFile(join(outputDir, clearPlaylistName), 'utf8')).split(/\r?\n/);
    const encryptedPlaylist = [];
    let segmentIndex = 0;
    for (const line of clearPlaylist) {
      const sourceName = line.trim();
      if (!sourceName.startsWith(`hevc-crf-${crf}-`) || !/^\d+\.m4s$/.test(sourceName.slice(`hevc-crf-${crf}-`.length))) {
        encryptedPlaylist.push(line);
        continue;
      }

      const clearBytes = await readFile(join(outputDir, sourceName));
      const contentId = randomUUID().toLowerCase();
      validDemoContentIds.add(contentId);
      const encrypted = encryptSegment(clearBytes, contentId);
      const segmentName = `hevc-ctr-crf-${crf}-${String(segmentIndex).padStart(3, '0')}.m4s`;
      const sidecarName = segmentName.replace(/\.m4s$/, '.json');
      await writeFile(join(outputDir, segmentName), encrypted.encrypted);
      await writeFile(join(outputDir, sidecarName), `${JSON.stringify({
        schemaVersion: 1,
        contentId,
        segmentUri: segmentName,
        keyUri: `../demo-key/${contentId}`,
        recordSize: 65536,
        baseCounter: encrypted.baseCounter,
        records: encrypted.records,
        clearFragmentSha256: sha256(clearBytes),
        clearFragmentBytes: clearBytes.length,
      }, null, 2)}\n`);
      encryptedPlaylist.push(segmentName);
      segmentIndex += 1;
    }
    if (segmentIndex === 0) throw new Error(`No HEVC media segments found in ${clearPlaylistName}`);
    await writeFile(join(outputDir, playlistName), `${encryptedPlaylist.join('\n')}\n`);
  }

  state.codecAbrFixtures = { status: 'ready', phase: 'complete', error: null };
  console.log(JSON.stringify({ event: 'codec-abr-fixtures-ready', h264Master: 'abrt-master.m3u8', h264CtrMaster: 'abrt-ctr-master.m3u8', encryptedH264AbrRenditions: ['360p', '480p', '720p'], encryptedMediaSegmentsPerRendition: 4, hevcCtrPlaylists: ['hevc-ctr-crf-32.m3u8', 'hevc-ctr-crf-30.m3u8', 'hevc-ctr-crf-28.m3u8'], hevcScale: '1280x720 from 3840x2160 source', hevcCrf: [32, 30, 28], encryptedMediaSegmentsPerPlaylist: 4 }));
}

function json(response, statusCode, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(body);
}

function mimeType(path) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.mp4': 'video/mp4',
    '.m4s': 'video/iso.segment',
  })[extname(path)] || 'application/octet-stream';
}

function waitForDrainOrClose(response) {
  return new Promise((resolveWait) => {
    const done = () => {
      response.off('drain', done);
      response.off('close', done);
      resolveWait();
    };
    response.once('drain', done);
    response.once('close', done);
  });
}

async function sendFile(request, response, path, isOutput = false) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    response.writeHead(404).end('Not found');
    return;
  }

  let tamperedRecord = null;
  if (isOutput && path.endsWith('/encrypted-0.m4s') && state.tamperRecord !== null) {
    tamperedRecord = state.tamperRecord;
    const entry = artifact.records[tamperedRecord];
    if (entry) {
      bytes = Buffer.from(bytes);
      let offset = 0;
      for (let index = 0; index < tamperedRecord; index += 1) {
        offset += 24 + artifact.records[index].ciphertextLength + 32;
      }
      bytes[offset + 24 + entry.ciphertextLength] ^= 0x01;
    }
  }

  const digest = sha256(bytes);
  const etag = `"sha256-${digest}"`;
  const size = bytes.length;
  let start = 0;
  let end = size - 1;
  let status = 200;
  const rangeHeader = request.headers.range;

  if (rangeHeader && request.headers['if-range'] && request.headers['if-range'] !== etag) {
    // RFC Range fallback: the entity changed, so return the current full representation.
  } else if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (!match) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}`, ETag: etag }).end();
      return;
    }
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (start >= size || end < start) {
      response.writeHead(416, { 'Content-Range': `bytes */${size}`, ETag: etag }).end();
      return;
    }
    end = Math.min(end, size - 1);
    status = 206;
  }

  const length = end - start + 1;
  const headers = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Type': mimeType(path),
    'Content-Length': length,
    ETag: etag,
  };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  response.writeHead(status, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  const chunkSize = 16 * 1024;
  for (let offset = start; offset <= end && !response.destroyed; offset += chunkSize) {
    const next = Math.min(offset + chunkSize, end + 1);
    const chunk = bytes.subarray(offset, next);
    if (!response.write(chunk)) {
      await waitForDrainOrClose(response);
    }
    if (state.throttleKbps > 0 && next < end + 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, (chunk.length * 1000) / (state.throttleKbps * 1024)));
    }
  }
  if (!response.destroyed) response.end();
  if (tamperedRecord !== null) state.tamperRecord = null;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'POST' && url.pathname === '/api/config') {
      let input = '';
      for await (const part of request) input += part;
      const config = JSON.parse(input || '{}');
      if (config.throttleKbps !== undefined) {
        const value = Number(config.throttleKbps);
        if (!Number.isFinite(value) || value < 0 || value > 10_000) {
          json(response, 400, { error: 'throttleKbps must be between 0 and 10000' });
          return;
        }
        state.throttleKbps = value;
      }
      if (config.tamperRecord !== undefined) {
        const value = config.tamperRecord;
        if (value !== null && (!Number.isInteger(value) || value < 0 || value >= artifact.records.length)) {
          json(response, 400, { error: 'tamperRecord is outside the generated record range' });
          return;
        }
        state.tamperRecord = value;
      }
      json(response, 200, state);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/report') {
      let input = '';
      for await (const part of request) {
        input += part;
        if (input.length > 1_000_000) {
          json(response, 413, { error: 'Report exceeds 1 MB' });
          return;
        }
      }
      const report = JSON.parse(input || '{}');
      await writeFile(join(outputDir, 'session-report.json'), `${JSON.stringify(report, null, 2)}\n`);
      json(response, 200, { saved: true, path: 'output/session-report.json' });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/status') {
      json(response, 200, { ...artifact.buildRecord, contentId: artifact.contentId, throttleKbps: state.throttleKbps });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/codec-abr/status') {
      json(response, 200, state.codecAbrFixtures);
      return;
    }

    const keyMatch = /^\/demo-key\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (request.method === 'GET' && keyMatch && validDemoContentIds.has(keyMatch[1])) {
      json(response, 200, getDemoKeys());
      return;
    }
    if (keyMatch) {
      response.writeHead(404).end('Unknown demo key');
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD, POST' }).end();
      return;
    }

    if (url.pathname === '/') {
      await sendFile(request, response, join(publicDir, 'index.html'));
      return;
    }
    if (url.pathname === '/codec-abr') {
      await sendFile(request, response, join(publicDir, 'codec-abr.html'));
      return;
    }
    if (url.pathname.startsWith('/public/')) {
      const relative = normalize(decodeURIComponent(url.pathname.slice('/public/'.length))).replace(/^([.][.][/\\])+/, '');
      const path = resolve(publicDir, relative);
      if (!path.startsWith(`${publicDir}${sep}`)) {
        response.writeHead(403).end();
        return;
      }
      await sendFile(request, response, path);
      return;
    }
    if (url.pathname.startsWith('/output/')) {
      const name = decodeURIComponent(url.pathname.slice('/output/'.length));
      if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
        response.writeHead(404).end();
        return;
      }
      await sendFile(request, response, join(outputDir, name), true);
      return;
    }

    response.writeHead(404).end('Not found');
  } catch (error) {
    console.error(error);
    if (!response.headersSent) json(response, 500, { error: error.message });
    else response.destroy(error);
  }
});

await createArtifacts();
server.listen(port, '0.0.0.0', () => {
  console.log(`HLS CTR Demo listening on http://0.0.0.0:${port}`);
});
createCodecAbrFixtures().catch(error => {
  state.codecAbrFixtures = { status: 'error', phase: state.codecAbrFixtures.phase, error: error.message };
  console.error(JSON.stringify({ event: 'codec-abr-fixtures-error', ...state.codecAbrFixtures }));
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
