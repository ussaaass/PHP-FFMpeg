import assert from 'node:assert/strict';
import { assetIdToBytes, parseKeyResponse, validatePlaybackInfo } from '../src/playback-info.js';
import { PlaybackProfile } from '../src/constants.js';

const info = validatePlaybackInfo({
  profile: PlaybackProfile.CTR_HMAC_V2,
  assetId: '18446744073709551615',
  keyId: 1023,
  versionId: 'release-42',
  keyUri: 'https://app.example.test/keys/video-42',
  masterPlaylistUri: 'https://cdn.example.test/media/master.m3u8?sig=short-lived',
});
assert.equal(info.assetId, '18446744073709551615');
assert.equal(Buffer.from(assetIdToBytes(info.assetId)).toString('hex'), 'ffffffffffffffff');
assert.equal(Buffer.from(assetIdToBytes('42')).toString('hex'), '000000000000002a');

const rawKey = Uint8Array.from({ length: 32 }, (_value, index) => index);
assert.deepEqual(parseKeyResponse('application/octet-stream', rawKey), rawKey);
const hex = Buffer.from(rawKey).toString('hex');
assert.deepEqual(parseKeyResponse('application/json; charset=utf-8', new TextEncoder().encode(JSON.stringify({ key: hex }))), rawKey);

assert.throws(() => parseKeyResponse('application/octet-stream', new Uint8Array(31)), /exactly 32 bytes/);
assert.throws(() => parseKeyResponse('text/plain', rawKey), /Content-Type/);
assert.throws(() => parseKeyResponse('application/json', new TextEncoder().encode('{broken')), /invalid JSON/);
assert.throws(() => parseKeyResponse('application/json', new TextEncoder().encode(JSON.stringify({ key: hex.toUpperCase() }))), /lowercase hexadecimal/);
assert.throws(() => validatePlaybackInfo({ ...info, profile: 'phpffmpeg-ctr-hmac-v1' }), /Unsupported playback profile/);
assert.throws(() => validatePlaybackInfo({ ...info, assetId: '018446744073709551615' }), /canonical unsigned/);
assert.throws(() => validatePlaybackInfo({ ...info, assetId: '18446744073709551616' }), /canonical unsigned/);
assert.throws(() => validatePlaybackInfo({ ...info, keyId: 1024 }), /keyId/);
assert.throws(() => validatePlaybackInfo({ ...info, masterPlaylistUri: 'http://cdn.example.test/master.m3u8' }), /HTTPS/);
assert.equal(validatePlaybackInfo({ ...info, masterPlaylistUri: 'http://localhost:8791/master.m3u8' }, { allowInsecureHttp: true }).masterPlaylistUri, 'http://localhost:8791/master.m3u8');

console.log('PlaybackInfo validation and raw/JSON-Hex Key parsing tests passed.');
