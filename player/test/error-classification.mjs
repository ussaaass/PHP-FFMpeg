import assert from 'node:assert/strict';
import { PlayerErrorCode } from '../src/constants.js';
import { classifyHlsError, redactDiagnostic } from '../src/error-classification.js';

assert.deepEqual(classifyHlsError({ details: 'manifestLoadError' }), { source: 'playlist', code: PlayerErrorCode.PLAYLIST_LOAD_FAILED });
assert.deepEqual(classifyHlsError({ details: 'bufferAppendError' }), { source: 'mse', code: PlayerErrorCode.MSE_APPEND_FAILED });
assert.deepEqual(classifyHlsError({ details: 'aborted' }), { source: 'hls' });
assert.deepEqual(classifyHlsError({ details: 'fragLoadError', response: { text: 'PLAYER_SEGMENT_VERSION_MISMATCH: ETag changed' } }), { source: 'segment', code: PlayerErrorCode.SEGMENT_VERSION_MISMATCH });
assert.equal(redactDiagnostic('GET https://cdn.example.test/object.m4s?sig=secret&token=also-secret failed'), 'GET https://cdn.example.test/object.m4s?sig=[REDACTED]&token=[REDACTED] failed');
assert.equal(redactDiagnostic('no credentials here'), 'no credentials here');
console.log('Playlist, MSE, cancellation, segment error categories and signed-query redaction passed.');
