# CTR/HMAC HLS Player

The maintained player implements the repository's custom `phpffmpeg-ctr-hmac-v2` object profile. V1 is intentionally unsupported because it requires per-segment JSON sidecars. V2 is not RFC 8216 AES-128, SAMPLE-AES, or DRM; playback requires this player.

## Build

Use Node 24 in Docker from the repository root:

```sh
docker run --rm -v "$PWD/player:/app" -w /app node:24-bookworm-slim sh -lc 'npm ci && npm run build'
```

The package entry is `dist/index.js`. The V2 Dedicated Worker is emitted beside it as `dist/v2-record-worker.js`.

## Browser integration

```js
import {
  HlsCtrPlayer,
  HttpCredentials,
  PlaybackProfile,
  RequestPurpose,
} from '@php-ffmpeg/hls-ctr-player';

const player = new HlsCtrPlayer(document.querySelector('video'), {
  requestOptions({ url, purpose }) {
    if (!Object.values(RequestPurpose).includes(purpose)) throw new Error('Unknown request purpose');
    return {
      credentials: HttpCredentials.INCLUDE,
      headers: applicationHeaders(url, purpose),
    };
  },
  onError(error) { applicationTelemetry.reportPlaybackError(error); },
  onEvent(event) { applicationTelemetry.reportPlaybackEvent(event); },
});

await player.load({
  profile: PlaybackProfile.CTR_HMAC_V2,
  assetId: '42', // canonical decimal string; supports the full unsigned 64-bit range
  keyId: 7,
  keyUri: 'https://app.example.test/api/video-key/42',
  masterPlaylistUri: 'https://cdn.example.test/media/master.m3u8?signature=short-lived',
  versionId: 'release-20261020',
});
await player.play();
```

`load()` validates `PlaybackInfo`, fetches the key once, and only then asks hls.js for the master playlist. A key endpoint returns either exactly 32 raw bytes with `Content-Type: application/octet-stream`, or `application/json` containing `{"key":"<64 lowercase hex characters>"}`. The numeric `keyId` comes from `PlaybackInfo`; it need not be echoed by the key endpoint.

The player stores key bytes only in the player session, copies them to a Worker for object-scoped derivation, and clears the session reference on reload or destruction. Do not put key bytes in URLs, playlists, logs, or object paths. Signed segment query parameters are passed through as received and are not logged by the player.

`keyUri` and `masterPlaylistUri` must use HTTPS. Set `allowInsecureHttp: true` only for local development. The host application owns key authorization, playlist generation/signing, CDN authorization policy, CORS, and secret storage.

## PHP packaging

Pass the caller-owned asset ID, key ID, and 32-byte master key once as V2 `KeyMaterial`. Package the completed local VOD media playlists with one call so all renditions use the same asset key material:

```php
use FFMpeg\Format\Hls\Encryption\CtrHmacV2\KeyMaterial;
use FFMpeg\Format\Hls\Encryption\CtrHmacV2\MediaPlaylistPackager;

$keyMaterial = new KeyMaterial('42', 7, $applicationKeyService->get32ByteMasterKey(42));
$package = (new MediaPlaylistPackager())->packageRenditions([
    ['playlist' => '/work/clear/360p/index.m3u8', 'shortEdgePixels' => 360],
    ['playlist' => '/work/clear/720p/index.m3u8', 'shortEdgePixels' => 720],
], '/work/published/video-release-1', 'release-1', $keyMaterial);
```

The package contains rewritten media playlists, clear `EXT-X-MAP` initialization segments, and encrypted `.m4s` objects under the agreed asset/key/rendition/version path. It emits no JSON sidecars. The caller builds the master playlist from the returned `playlists` map and applies dynamic URL signatures. Existing output paths are rejected; publish a new immutable version instead.

Run PHP inside the repository's Docker PHP service and mount source/output paths into that container. Never bake a master key into an image, command line, playlist, or report.

## Playback behavior and current limits

The V2 loader streams ciphertext records to the Dedicated Worker. The Worker verifies each complete HMAC before decrypting; only complete `moof`/`mdat` units are emitted through hls.js's progressive loader callback. Clear resources such as the initialization segment pass through unchanged. No per-segment metadata endpoint is used.

V2 worker and loader tests run with Node 24 in Docker. The loader resumes an interrupted encrypted object from the byte offset after the last fully authenticated record, using the original signed URI plus `Range` and `If-Range`; it validates a strong ETag, `Content-Range`, total object length, response length, and identity encoding, and allows at most three resume attempts. Docker Chromium acceptance has passed for real H.264 MSE playback, three-rendition switching, seeking, an injected short read with signed-URI Range resumption, and automatic ABR up/down switching under a shaped link. The test HEVC sample was correctly rejected before append because Linux Chromium reports the codec unsupported; this is not evidence of HEVC playback support. RustFS/CDN and physical Safari/iOS or Android device acceptance remain separate. The format does not provide DRM: an authorized browser can access decrypted media.
