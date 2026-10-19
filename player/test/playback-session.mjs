import assert from 'node:assert/strict';
import { startPlaybackSession } from '../src/playback-session.js';
import { PlaybackProfile, PlayerErrorCode, RequestPurpose } from '../src/constants.js';

const info = {
  profile: PlaybackProfile.CTR_HMAC_V2,
  assetId: '42', keyId: 7, versionId: 'version-1',
  keyUri: 'https://app.example.test/key/42',
  masterPlaylistUri: 'https://cdn.example.test/master.m3u8?sig=keep',
};
const rawKey = Uint8Array.from({ length: 32 }, (_value, index) => index);
const order = [];
const requests = [];
const session = await startPlaybackSession(info, {
  requestOptions: ({ url, purpose }) => {
    assert.equal(url, info.keyUri);
    assert.equal(purpose, RequestPurpose.KEY);
    return { credentials: 'include', headers: { Authorization: 'Bearer app-session' } };
  },
  fetchImpl: async (url, init) => {
    order.push('key');
    requests.push({ url, init });
    return new Response(rawKey, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
  },
  onKeyReady: (playbackInfo, key) => {
    assert.equal(key.byteLength, 32);
    assert.equal(playbackInfo.masterPlaylistUri, info.masterPlaylistUri);
    order.push('master-playlist');
  },
});
assert.deepEqual(order, ['key', 'master-playlist']);
assert.equal(requests.length, 1);
assert.equal(requests[0].url, info.keyUri);
assert.equal(requests[0].init.credentials, 'include');
assert.deepEqual(session.masterKey, rawKey);

let startedMasterAfterFailure = false;
await assert.rejects(startPlaybackSession(info, {
  fetchImpl: async () => new Response('denied', { status: 403 }),
  onKeyReady: () => { startedMasterAfterFailure = true; },
}), error => error.code === PlayerErrorCode.KEY_FETCH_FAILED);
assert.equal(startedMasterAfterFailure, false);

for (const status of [204, 206, 401, 403]) {
  let masterStarted = false;
  await assert.rejects(startPlaybackSession(info, {
    fetchImpl: async () => new Response('not an accepted Key response', { status }),
    onKeyReady: () => { masterStarted = true; },
  }), error => error.code === PlayerErrorCode.KEY_FETCH_FAILED);
  assert.equal(masterStarted, false, `HTTP ${status} must fail before master-playlist loading`);
}

const cancelled = new AbortController();
cancelled.abort();
await assert.rejects(startPlaybackSession(info, {
  signal: cancelled.signal,
  fetchImpl: async (_url, { signal }) => { if (signal.aborted) throw new Error('aborted'); return new Response(rawKey); },
}), error => error.code === PlayerErrorCode.PLAYBACK_CANCELLED);

const controller = new AbortController();
await assert.rejects(startPlaybackSession(info, {
  signal: controller.signal,
  timeoutMilliseconds: 10,
  abortKeyRequest: () => controller.abort(),
  fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
}), error => error.code === PlayerErrorCode.KEY_TIMEOUT);

console.log('Playback session requests one Key before its master-playlist callback and fails closed on Key errors.');
