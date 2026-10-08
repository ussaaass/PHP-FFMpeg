# Isolated HLS AES-CTR streaming demo

This experiment is kept outside the PHP library source and its normal test suite. It uses the hls.js public fragment-loader hook to authenticate and decrypt an experimental record format in a Dedicated Worker, then sends clear records into hls.js's progressive MSE path.

The format is intentionally private and uses fixed, public test keys. It is not an HLS encryption method and must never be used for real content or credentials.

## Requirements

- Docker Desktop or Docker Engine with Compose v2.
- The isolated image uses Node.js `24.21.0`, npm `11.19.0`, and the locked hls.js `1.7.3` package.
- The sample MP4 file `/Users/macbookpro/Devs/samples/26.mp4` (or another local MP4 supplied through `SAMPLE_FILE`).
- Desktop Chrome with Media Source Extensions and H.264 support.
- Network access on the first build to fetch the locked hls.js npm package and FFmpeg 9.0.2 archive.

No PHP, Node.js, npm, FFmpeg, or FFprobe installation is needed on the host.

## Run

Run this from the repository root, replacing the sample path if needed:

```sh
SAMPLE_FILE=/Users/macbookpro/Devs/samples/26.mp4 docker compose -f experiments/hls-ctr-demo/compose.yaml up --build
```

The service binds only to `127.0.0.1:8789`. Open <http://localhost:8789>. It scales and encodes the first eight seconds of the sample as 480p H.264 at a 500 kbit/s target, retaining the two approximately four-second fMP4 media segments in the HLS playlist. Each media segment is independently encrypted into authenticated CTR records and described by a sidecar; the initialization segment stays clear. This preserves normal HLS segment timestamps and lets hls.js load the second media segment separately.

The generated inputs, playlists, encrypted media, and build record are stored in `experiments/hls-ctr-demo/output/`. That directory is ignored by Git and is overwritten when the container starts again.

The main page also offers four CTR streams: the original H.264 480p sample and HEVC 720p samples at CRF 32, 30, and 28. Each HEVC playlist retains its four approximately two-second HLS media segments. Every media segment is encrypted independently into authenticated AES-CTR records, with its own sidecar and content key ID; the clear initialization segment is shared by that rendition. The custom hls.js loader fetches each `.m4s` incrementally, verifies and decrypts every record in a Dedicated Worker, and progressively supplies clear bytes to hls.js/MSE. Each sidecar includes the expected clear-fragment SHA-256. This preserves normal HLS segment boundaries while allowing the player to request the next segment separately. This is a local experiment with fixed demo keys, not production encryption.

Open <http://localhost:8789/codec-abr> for the isolated clear codec and ABR test page. It reports the current browser's H.264/HEVC MSE support, plays a clear three-rendition H.264 fMP4 master playlist, and allows automatic or manual level selection while changing the server-side network limit. It also offers HEVC HLS samples scaled from the supplied 4K source to 720p at CRF 32, 30, and 28. Unsupported browsers will report the playback error. Fixture generation starts after the web server is ready, and the page shows its progress. These clear fixtures test codec and rendition switching separately from the CTR-encrypted single-rendition flow.

## Controls

- **Play** starts playback with the selected server-side network limit. The default is 512 KiB/s; 128 KiB/s is below the measured average rate of the HEVC 720p CRF 30/28 samples and is expected to cause buffering stalls.
- **Stop** destroys the hls.js instance and aborts active requests.
- **Interrupt after next record** arms one intentional response cancellation; the custom loader resumes at the next record boundary with `Range` and `If-Range`.
- **Play with tampered record** flips a byte in the selected record's HMAC tag for one response. That record must fail authentication before its clear bytes are released.
- **Save evidence report** writes browser measurements and the event log to `output/session-report.json`.

The report includes the browser user agent, source and output hashes, record counts, loader timings, the decrypted-fragment hash, and whether the first decoded frame preceded completion of the encrypted fragment download. Compare `decryptedFragmentSha256` with `clearFragmentSha256`; `decryptedHashMatchesBaseline` must be `true` for an untampered playback.

To record the locally built image ID alongside the report, run this in another terminal and add the returned value to the report notes:

```sh
docker image inspect php-ffmpeg-hls-ctr-demo:0.1.0 --format '{{.Id}}'
```

## Stop and clean up

Press `Ctrl-C` in the Compose terminal. To remove the Demo container and image:

```sh
docker compose -f experiments/hls-ctr-demo/compose.yaml down --rmi local
```

To remove generated Demo outputs, delete only the files inside `experiments/hls-ctr-demo/output/` after stopping the service. The sample file is mounted read-only and is not copied into the repository.

## Interpretation

A successful playback demonstrates only that the pinned hls.js `1.7.3` package and the listed local browser can consume this one experimental H.264/fMP4 case. It does not demonstrate production cryptographic security, generic HLS compatibility, CDN behavior, HEVC playback, multi-rendition ABR, or mobile playback. The test key endpoint is deliberately unauthenticated and returns fixed known keys on localhost.
