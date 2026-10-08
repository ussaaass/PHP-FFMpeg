# CTR/HMAC HLS Player

This in-repository package plays the `phpffmpeg-ctr-hmac-v1` profile produced by the PHP post-processor. It is a custom application-level format, not standard HLS AES-128, SAMPLE-AES, CBCS, or DRM.

## Build

Use Node 24 in Docker from the repository root:

```sh
docker run --rm -v "$PWD/player:/app" -w /app node:24.21.0-bookworm-slim sh -lc 'npm ci && npm run build'
```

The package entry is `dist/index.js`; its Dedicated Worker is emitted beside it as `dist/record-worker.js`. The bundler includes the pinned hls.js dependency. A consuming application can install this directory as a local package or copy the `dist/` output into its own asset pipeline.

## Browser integration

```js
import {
  HlsCtrPlayer,
  HttpCredentials,
  PlaybackDescriptorUrl,
  RequestPurpose,
} from '@php-ffmpeg/hls-ctr-player';

const player = new HlsCtrPlayer(document.querySelector('video'), {
  keyProvider: {
    async getMasterKey({ keyId, keyUri, contentId, profile, signal }) {
      // Ask the host application's authenticated key service.
      // Return a Uint8Array containing exactly 32 bytes; do not log it.
      return applicationKeyService.getMasterKey({ keyId, keyUri, contentId, profile, signal });
    },
  },
  // This hook must synchronously return RequestInit for manifests, sidecars,
  // and media requests. Key retrieval is handled by keyProvider above.
  requestOptions({ url, purpose }) {
    if (!Object.values(RequestPurpose).includes(purpose)) throw new Error('Unknown player request purpose');
    return { credentials: HttpCredentials.INCLUDE, headers: applicationHeaders(url, purpose) };
  },
  onError(error) { applicationTelemetry.reportPlaybackError(error); },
  onEvent(event) { applicationTelemetry.reportPlaybackEvent(event); },
});

await player.load(PlaybackDescriptorUrl.from('/media/movie-123/playback.json'));
await player.play();
```

Call `player.destroy()` when the view is disposed. `getLevels()`, `setLevel(-1 | levelIndex)`, and `seek(seconds)` expose basic rendition and seek controls. The host application owns user authorization, one stable key per video asset, key retention, key caching policy, HTTPS, and CORS. The first CTR/HMAC profile does not rotate keys within a video.

The player defaults hls.js VOD bandwidth-estimator half-lives to 1 second (fast) and 3 seconds (slow), and the ABR up-switch safety factor to `0.85`, leaving 15% headroom below the estimated rate. Applications can override these and other hls.js options through `hlsConfig` after measuring their own network and buffering targets.

Before playback, the player checks the manifest's declared codec against the browser's MSE support. If hls.js rejects all variant codecs, the package reports `PLAYER_CODEC_UNSUPPORTED` through `onError` and stops loading; it never switches to cleartext media or native HLS.

## PHP packaging stage

FFmpeg first creates a finalized, clear fMP4 VOD HLS master playlist. The application then runs `PlaylistEncryptor` on that output directory and publishes the returned encrypted directory. The source and destination directories must be separate, and the destination parent must already exist.

```php
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyMaterial;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyProviderInterface;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyRequest;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyUriResolverInterface;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\PlaylistEncryptor;

$provider = new class($applicationKeyService) implements KeyProviderInterface {
    public function __construct(private ApplicationKeyService $keys) {}

    public function getKeyMaterial(KeyRequest $request): KeyMaterial
    {
        return new KeyMaterial(
            $this->keys->keyIdFor($request),
            $this->keys->get32ByteMasterKey($request)
        );
    }
};

$keyUriResolver = new class implements KeyUriResolverInterface {
    public function getKeyUri(KeyRequest $request, KeyMaterial $key): string
    {
        return 'https://app.example.test/api/media-keys/' . rawurlencode($key->getKeyId());
    }
};

$result = (new PlaylistEncryptor($provider, $keyUriResolver))
    ->encryptMasterPlaylist('/media/clear/master.m3u8', '/media/published/movie-123', 'movie-123');
```

`PlaylistEncryptor` is the completed post-processing API; it is not yet a fluent `open()->HlsWorkflow()->save()` integration. It accepts local, non-encrypted VOD master playlists with video renditions using `.m4s` segments and `EXT-X-MAP`. It rejects TS, byte ranges, source-encrypted media, audio/subtitle renditions, URI-bearing auxiliary tracks, and unsupported/non-local paths. Initialization segments remain clear. Deployments requiring every media type encrypted must not use this video-only first release.

Run the PHP code inside the repository's Docker PHP service; mount media paths into that container and pass those container paths to PHP. Never bake a master key into a Docker image, playlist, descriptor, sidecar, command line, or this package.

## Network and security behavior

The player authenticates each complete CTR/HMAC record before decrypting it, then sends complete MP4 `moof`/`mdat` fragments to hls.js progressively. It resumes a truncated media response only at a verified record boundary and requires a stable ETag plus valid `206 Content-Range`. CDN deployments must expose `ETag`, `Content-Range`, and `Content-Length` to browser JavaScript and allow the application's credentialed CORS policy.

Progressive decryption does not mean partial MP4 boxes are appended. The current VOD fixture has one `moof`/`mdat` pair per 2-second HLS segment, so MSE receives that segment only after the pair is complete. Lower first-frame latency requires shorter aligned segments/fragments (or a separately designed LL-HLS path) and measurement on the target network.

This scheme does not provide DRM. An authorized browser can access decrypted media, and ordinary HLS clients cannot play the custom encrypted segments. The current automated browser/platform compatibility matrix is incomplete; evaluate target codecs and browsers in the consuming application.
