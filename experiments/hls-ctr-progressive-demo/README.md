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

The main page also includes an encrypted H.264 360p/480p/720p ABR master playlist. Each rendition's media segments have independent CTR sidecars and key identifiers. Headed macOS Chrome 154 validation is recorded in `capability-validation-report.json`: automatic ABR switched from 360p to 720p after the server throttle was raised, all four selected encrypted segment hashes matched, and playback reached the end of the 8.075-second timeline. The 480p rendition was available but not selected in that run. This validates an encrypted automatic up-switch path in this local fixture; it does not establish every pairwise switch, down-switch behavior, or weak-network stall-free playback.

## Controls

- **Play** starts playback with the selected server-side network limit. The default is 512 KiB/s; 128 KiB/s is below the measured average rate of the HEVC 720p CRF 30/28 samples and is expected to cause buffering stalls.
- **Stop** destroys the hls.js instance and aborts active requests.
- **Interrupt after next record** arms one intentional response cancellation; the custom loader resumes at the next record boundary with `Range` and `If-Range`.
- **Play with tampered record** flips a byte in the selected record's HMAC tag for one response. That record must fail authentication before its clear bytes are released.
- **Save evidence report** writes browser measurements and the event log to `output/session-report.json`.

The report includes the browser user agent, source and output hashes, record counts, loader timings, the decrypted-fragment hash, and whether the first decoded frame preceded completion of the encrypted fragment download. Compare `decryptedFragmentSha256` with `clearFragmentSha256`; `decryptedHashMatchesBaseline` must be `true` for an untampered playback.

## Complete progressive Worker-to-MSE path

The route <http://localhost:8790/public/progressive.html> is the isolated end-to-end progressive prototype. It reads the HLS playlist and clear init segment, streams the single encrypted media object, authenticates/decrypts each record in a Dedicated Worker, assembles only complete `moof` + `mdat` pairs, and serially appends each pair to MSE. Each append is awaited before more media is released, which provides explicit backpressure and bounds clear-media buffering to the current incomplete movie fragment. The 0.5-second encoded fragments are concatenated into one HLS media object so this test measures progressive processing within one object, not merely a playlist of short completed segments.

The input sample is required to be fast-start (`moov` before `mdat`). Startup rejects a source MP4 that does not meet that condition. FFmpeg also produces an intermediate with `-movflags +faststart`; the experiment checks the atom order before fragmenting it. The media is then packaged into a separate init segment and 16 `moof`/`mdat` pairs, with an 8.008-second HLS duration. The trailing `mfra` index is excluded from the MSE media payload.

The evidence in `output/progressive-mse-64-report.json` and `output/progressive-mse-128-report.json` was collected in isolated Chromium 153. At 64 KiB/s, the first decoded frame appeared at about 1.59 seconds and playback started at about 2.32 seconds, while the encrypted object finished at about 8.91 seconds. All 16 MSE appends reached 8.075 seconds and the video ended normally; one waiting event occurred because the network rate is below the sample's average encoded bitrate. At 128 KiB/s, the first decoded frame appeared at about 0.75 seconds and playback started at about 1.23 seconds, while the download finished at about 4.50 seconds. All 16 appends reached 8.075 seconds and the video ended; one brief waiting event occurred near 2.72 seconds despite about 3.85 seconds of buffered media, then playback recovered. In both cases the Worker clear-media SHA-256 matched the sidecar.

The separate progressive Worker-to-MSE route is retained as a comparison. hls.js can emit an early append and decoded frame, but with multiple `moof`/`mdat` pairs inside one HLS fragment its progressive parser updates `SourceBuffer.timestampOffset` to negative offsets during later pushes. This causes subsequent data to overlap and the MSE timeline to stop near one or two seconds. Do not treat that hls.js path as the working progressive implementation yet. The direct Worker-to-MSE path is H.264-only and does not yet implement Range resume, retries, seeking, ABR, HEVC playback, audio, or production key authorization; the hls.js route has the separate encrypted ABR evidence above.

## HEVC, Range, seek, and ABR verification

The 2026-10-06 headed macOS Chrome 154 validation is recorded in `capability-validation-report.json` and the bilingual technical SDD. The hls.js custom loader successfully played the encrypted 720p HEVC CRF 32 playlist: all four segment hashes matched, the MSE range reached about 8.075 seconds, and playback ended. The loader now accepts the valid `styp` and `sidx` boxes present in HEVC fMP4 segments.

The player resumed an interrupted H.264 CTR response at the next authenticated record boundary (byte 65592), validated the resumed ETag and 206 response, and matched the complete decrypted-media hash. A separate range reconstruction matched the full encrypted object byte for byte; a stale `If-Range` correctly returned 200. The direct Worker-to-MSE H.264 page also sought within its fully buffered range. Clear H.264 ABR selected 360p and completed at 64 KiB/s; a 480p to 720p rendition switch was also fetched at 128 KiB/s. Encrypted H.264 ABR automatically switched from 360p to 720p and completed with all segment hashes verified; see TV-11 in the technical SDD. These runs do not cover seek into media that has not been downloaded, RustFS/CDN delivery, Safari/iOS, or Android.

Run this isolated experiment from the repository root:

```sh
SAMPLE_FILE=/Users/macbookpro/Devs/samples/26.mp4 docker compose -f experiments/hls-ctr-progressive-demo/compose.yaml up --build
```

It binds to <http://localhost:8790> and stores its outputs under `experiments/hls-ctr-progressive-demo/output/`. It does not modify the baseline Demo at port 8789.

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

A successful playback demonstrates only that the pinned hls.js `1.7.3` package and the listed local browser can consume these specific experimental streams. The 720p HEVC CTR result and an encrypted H.264 360p-to-720p automatic ABR up-switch are confirmed for headed macOS Chrome 154; they do not demonstrate generic HEVC browser support, production cryptographic security, generic HLS compatibility, CDN behavior, every ABR transition, or mobile playback. The test key endpoint is deliberately unauthenticated and returns fixed known keys on localhost.
