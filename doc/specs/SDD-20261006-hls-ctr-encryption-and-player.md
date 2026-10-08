# SDD：HLS CTR 加密编排集成与可复用播放器
# SDD: HLS CTR Encryption Pipeline Integration and Reusable Player

> 状态：T0–T8 已通过；T9 上线前安全、全量回归及发布准备审查已完成，最终 release commit/tag 待合并时创建。PHP 8.0.30 Docker + 最低兼容依赖的 HLS 单测和进度回归均通过。本期媒体输入、独立音频/字幕、生产 CDN 与最终发布 commit/tag 的边界已明确；macOS Chrome 154 正式播放器 ABR 和 RustFS 对象替换均通过，移动真机按决定延后至上线后。本地代理验收不代表生产 CDN。
> Status: T0–T8 have passed; the pre-launch T9 security, full-regression, and release-preparation review is complete, with the final release commit/tag to be created at merge time. HLS unit and progress-regression tests passed in PHP 8.0.30 Docker with the lowest compatible dependencies. This release's boundaries for media inputs, separate audio/subtitle tracks, the production CDN, and the final release commit/tag are explicit; official-player ABR in macOS Chrome 154 and RustFS object replacement both passed, while physical mobile acceptance is deferred until after launch. Local proxy acceptance does not represent the production CDN.
> 创建日期：2026-10-06
> Created: 2026-10-06
> 负责人：项目维护者
> Owner: Project maintainers
> 关联文档：[HLS 输出与输入支持](SDD-20261003-hls-support.md)、[HLS 编排 API 使用方式](SDD-20261004-hls-api-usage-design.md)、[HLS 技术验证](SDD-20261004-hls-technical-validation.md)
> Related documents: [HLS output and input support](SDD-20261003-hls-support.md), [HLS orchestration API usage](SDD-20261004-hls-api-usage-design.md), [HLS technical validation](SDD-20261004-hls-technical-validation.md)
> 格式规范：[CTR/HMAC 媒体记录格式 V1](CTR-HMAC-RECORD-FORMAT-V1.md)
> Format specification: [CTR/HMAC Media Record Format V1](CTR-HMAC-RECORD-FORMAT-V1.md)

当前实现包括类型化 PHP HLS workflow、faststart 检查/规范化、多 rendition fMP4 HLS、CTR/HMAC 打包器、外部 KeyProvider 契约、可选择的不可变版本目录发布与 current 指针，以及独立 Dedicated Worker 播放器包；本地 FFmpeg 9 Docker 样本已生成 H.264 多码率与 HEVC 720p 加密产物，PHP/Worker 交叉校验及逐段 SHA-256 校验通过。
The current implementation includes a typed PHP HLS workflow, faststart inspection/normalization, multi-rendition fMP4 HLS, a CTR/HMAC packager, an external KeyProvider contract, optional immutable-version publication with a current pointer, and an independent Dedicated Worker player package; local FFmpeg 9 Docker samples produced encrypted multi-bitrate H.264 and 720p HEVC artifacts, and PHP/Worker interoperability plus per-segment SHA-256 checks passed.

当前播放器对本库正式 PHP 产物的手动切档、seek、截断后的 Range 续传和自动 ABR 已有 Docker Chromium 与 macOS Chrome 154 验收；18 秒样本在 256 KiB/s 起步、8 MiB/s 提速、128 KiB/s 降速并恢复后完成自动升降档并 ended。macOS 实测自动切过 480p、720p、360p，9 个已缓冲分片均通过 sidecar、CTR/HMAC 与明文 SHA-256 校验。独立 64 KiB/s 起步两分片后恢复、512 KiB/s 起步后恢复的本地播放，以及 128 KiB/s 下从 RustFS 直接跨源播放并恢复，都达到 ended。64 KiB/s 本地场景观察到短暂 buffer stall，已记入报告。本地 Docker Nginx 代理已通过跨源播放、seek、缓存命中、无内容编码、记录边界 Range/If-Range、ETag/CORS 暴露及三次截断续传；其弱网轨迹也带指标播放至 ended。RustFS 真实对象在 70,000 字节处中断后被同长度对象替换，旧 ETag 的 Range 请求返回新 ETag，播放器明确拒绝续传，未拼接对象版本。实际生产 CDN 配置仍待部署验收。Linux Chromium 对 HEVC 的能力拒绝也已确认。移动真机验收按决定推迟到上线后。
The packaged player has Docker Chromium and macOS Chrome 154 acceptance against official PHP artifacts for manual switching, seeking, truncated-response Range resumption, and automatic ABR; an 18-second sample completed automatic up/down switching under 256 KiB/s startup, 8 MiB/s uplift, 128 KiB/s downlink, and recovery. macOS Chrome automatically switched through 480p, 720p, and 360p; all 9 buffered segments passed sidecar, CTR/HMAC, and clear SHA-256 checks. Separate local playback traces starting at 64 KiB/s for two segments and at 512 KiB/s before recovery, plus direct cross-origin RustFS playback at 128 KiB/s followed by recovery, also reached ended. A brief buffer stall occurred in the local 64 KiB/s scenario and is recorded. The local Docker Nginx proxy passed cross-origin playback, seeking, cache-hit, no-content-encoding, record-boundary Range/If-Range, ETag/CORS exposure, and resumption after three injected truncations; its weak-network trace also reported metrics and reached ended. A real RustFS object was interrupted after 70,000 bytes and replaced with a same-length object; the old-ETag Range request returned the new ETag, and the player explicitly rejected resumption without combining object versions. Acceptance against the actual production CDN remains to be done after deployment. Linux Chromium's HEVC capability rejection is also confirmed. Physical mobile-device acceptance remains deferred until after launch.

## 实施进度与已验证边界
## Implementation status and verified boundary

- [x] PHP `PlaylistEncryptor` 将本地多码率 fMP4 VOD HLS 原子打包为加密分片、逐段 sidecar、改写后的 M3U8 与 `playback.json`；不支持的音频/字幕、TS、byterange、预加密及 URI 轨道会明确拒绝。
- [x] PHP `PlaylistEncryptor` atomically packages local multi-rendition fMP4 VOD HLS into encrypted segments, per-segment sidecars, rewritten M3U8 files, and `playback.json`; unsupported audio/subtitle renditions, TS, byte ranges, pre-encrypted inputs, and auxiliary URI tracks are rejected explicitly.

- [x] 播放器以 `player/` 独立 npm 包构建，宿主应用通过 `keyProvider.getMasterKey()` 注入 32 字节密钥，并可同步注入请求凭据；构建产物不包含测试夹具与测试密钥。
- [x] The player builds as an independent npm package under `player/`; the host injects a 32-byte key through `keyProvider.getMasterKey()` and may synchronously inject request credentials; build output excludes test fixtures and test keys.

- [x] PHP 8.5.11 Docker + FFmpeg 5.1.9 全量 PHPUnit：587 tests、1,379 assertions 通过、9 skipped；PHP 8.5.11 Docker + FFmpeg 9.0.2：587 tests、1,405 assertions 通过、9 skipped。PHP 8.0.30 Docker 使用最低兼容依赖的 HLS 单测 30 tests/206 assertions 与进度单调性回归 4 tests/30 assertions 均通过。证据：`phpunit-php85-ffmpeg5-junit.xml`、`phpunit-php85-ffmpeg9-junit.xml`、`php80-runtime-hls.json` 及对应 JUnit 报告。
- [x] Full PHPUnit passed in PHP 8.5.11 Docker with FFmpeg 5.1.9: 587 tests, 1,379 assertions, 9 skipped; PHP 8.5.11 Docker with FFmpeg 9.0.2: 587 tests, 1,405 assertions, 9 skipped. Under PHP 8.0.30 Docker with the lowest compatible dependencies, HLS unit tests passed with 30 tests/206 assertions and the progress-monotonicity regression passed with 4 tests/30 assertions. Evidence: `phpunit-php85-ffmpeg5-junit.xml`, `phpunit-php85-ffmpeg9-junit.xml`, `php80-runtime-hls.json`, and its JUnit reports.

- [x] Workflow 在同一资产内发现 KeyProvider 更换 keyId、主密钥或 key URI 时会拒绝打包；当前规则要求每个视频资产在所有 rendition/分片中保持固定密钥。
- [x] The workflow rejects a KeyProvider that changes keyId, master key, or key URI within one asset; the current rule keeps one key stable across every rendition and segment for that video asset.

- [x] 修复 loader 成功后被误标记为 aborted 的问题，并让渐进 append 阶段持续更新 hls.js 所需的处理时序；18 秒 VOD 在带宽上升/下降时依次自动切换 360p、480p、720p、360p，所选播放分片均认证成功并播放至 ended。
- [x] Fixed successful loaders being incorrectly marked aborted and kept hls.js processing timestamps current during progressive appends; an 18-second VOD automatically switched through 360p, 480p, 720p, and 360p as bandwidth rose and fell, all selected playback segments authenticated, and playback reached ended.

- [x] tools_vue RustFS 专属测试 bucket 的真实 HLS 密文对象支持 `Range`，返回 `206`、正确 `Content-Range`、`Accept-Ranges: bytes` 和稳定 ETag；这只验证对象存储 HTTP 行为，不代表跨源播放器或 CDN 验收。
- [x] Real encrypted HLS objects in a dedicated tools_vue RustFS test bucket support `Range` and return `206`, correct `Content-Range`, `Accept-Ranges: bytes`, and a stable ETag; this verifies object-store HTTP behavior only, not cross-origin player or CDN acceptance.

- [x] 通过浏览器故障注入截断首个密文响应，再变更对象字节与 ETag；服务端仍返回 206 时，播放器因 ETag 不匹配而拒绝拼接并报错，未把两个对象版本的记录混合解密。
- [x] A browser fault-injection test truncated the first ciphertext response and then changed the object bytes and ETag; when the server still returned 206, the player rejected the ETag mismatch and did not concatenate or decrypt records from two object versions.

- [x] FFmpeg 9 Docker 中生成的非 faststart MP4 经 `FaststartNormalizer` stream-copy 重封装；输出 box 顺序检查为 faststart，重封装前后源文件 SHA-256 完全相同。
- [x] A non-faststart MP4 generated in the FFmpeg 9 Docker container was stream-copy remuxed by `FaststartNormalizer`; the output box order passed faststart inspection and the source SHA-256 was identical before and after remuxing.

- [x] KeyProvider 缺失时，Workflow 在调用 FFmpeg/FFprobe 能力探测前返回 `KEY_PROVIDER_REQUIRED`；新增的 Docker 回归测试确认工具进程未启动。播放器的有界 KeyProvider 超时、拒绝错误码及自动 ABR/卡顿/完成指标接口已由 Chromium Docker 行为验收，超时与未知 keyId 拒绝报告均通过且不泄漏 provider 诊断。
- [x] When KeyProvider is missing, Workflow returns `KEY_PROVIDER_REQUIRED` before invoking FFmpeg/FFprobe capability probes; a new Docker regression confirms neither tool starts. Chromium Docker behavior acceptance passed for the bounded KeyProvider timeout, categorized rejection errors, and automatic-ABR/rebuffer/completion metrics; timeout and unknown-keyId denial reports passed without exposing provider diagnostics.

- [x] 弱网验收报告：`h264-weak-64-recovery.json` 记录 64 KiB/s 两分片后恢复，`h264-weak-512-recovery.json` 记录 512 KiB/s 后恢复，`h264-abr-auto.json` 记录 256/8 MiB/128 KiB/8 MiB/s 的自动升降档轨迹；它们均为本地 HTTP 测试服务，不等同于 CDN 验收。
- [x] Weak-network reports: `h264-weak-64-recovery.json` records recovery after two segments at 64 KiB/s, `h264-weak-512-recovery.json` records recovery after 512 KiB/s, and `h264-abr-auto.json` records automatic switching under 256/8 MiB/128 KiB/8 MiB per second; these use a local HTTP test server and do not constitute CDN acceptance.

- [x] T8 自动 ABR 矩阵补齐：64、128、512 KiB/s 恒定带宽，64→512 升档、512→64 降档、64/512/128/512/64/512 周期波动及恢复；另验证自动切换后 seek 至 4 秒并继续播放。报告：`h264-constant-64kibs.json`、`h264-constant-128kibs.json`、`h264-constant-512kibs.json`、`h264-bandwidth-up-64-to-512.json`、`h264-bandwidth-down-512-to-64.json`、`h264-bandwidth-fluctuation.json`、`h264-abr-auto-seek.json`。所有通过报告均播放至 ended、无 fatal error；逐段认证事件记录 keyId、记录数和明文 SHA-256。64 KiB/s 与降档轨迹发生的卡顿保留在报告指标中。
- [x] T8 automatic-ABR coverage is complete: constant bandwidth at 64, 128, and 512 KiB/s; 64→512 upshift; 512→64 downshift; periodic 64/512/128/512/64/512 fluctuation and recovery; and seeking to 4 seconds after an automatic switch followed by continued playback. Reports: `h264-constant-64kibs.json`, `h264-constant-128kibs.json`, `h264-constant-512kibs.json`, `h264-bandwidth-up-64-to-512.json`, `h264-bandwidth-down-512-to-64.json`, `h264-bandwidth-fluctuation.json`, and `h264-abr-auto-seek.json`. Every passing report reached ended without a fatal error; per-segment authentication events record the keyId, record count, and clear SHA-256. Stalls observed at 64 KiB/s and during downshift remain recorded in the report metrics.

- [x] RustFS 跨源播放器验收：18 秒加密 VOD 直连对象存储并播放至 ended；在 128 KiB/s 加载两段后恢复，播放也到 ended；浏览器另行用 `Range` + `If-Range` 取回恰好 65,592 字节（第一条完整认证记录），并校验 `Content-Range` 与暴露的 ETag。
- [x] RustFS cross-origin player acceptance: an 18-second encrypted VOD fetched directly from object storage and reached ended; playback also reached ended after loading two segments at 128 KiB/s and recovering; the browser separately fetched exactly 65,592 bytes (the first complete authenticated record) with `Range` plus `If-Range` and checked `Content-Range` and the exposed ETag.

- [x] T8 按维护者选择的本地 Docker Nginx 代理 endpoint 验收缓存、内容编码、跨源 Range/If-Range、ETag/CORS 暴露、seek、弱网播放与最多 3 次截断续传；报告：`nginx-proxy-e2e.json`、`nginx-proxy-weak-e2e.json`、`nginx-proxy-range-resume.json`、`nginx-proxy-three-retries.json`、`nginx-proxy-seek.json`。这不代表未配置的生产 CDN 已通过。
- [x] T8 acceptance against the maintainer-selected local Docker Nginx proxy endpoint covered cache, content encoding, cross-origin Range/If-Range, ETag/CORS exposure, seeking, weak-network playback, and truncated-transfer resumption with up to 3 retries; reports: `nginx-proxy-e2e.json`, `nginx-proxy-weak-e2e.json`, `nginx-proxy-range-resume.json`, `nginx-proxy-three-retries.json`, and `nginx-proxy-seek.json`. This does not claim acceptance of an unconfigured production CDN.

- [x] T8 RustFS 真实对象替换故障注入已通过：RustFS 忽略不匹配的 `If-Range` 并返回 `206`，但变化后的 ETag 被播放器识别并明确拒绝；没有混用对象版本。证据：`rustfs-object-replacement.json`。
- [x] T8 real-object replacement fault injection on RustFS passed: RustFS ignored the mismatched `If-Range` and returned `206`, but the player detected the changed ETag and explicitly rejected the response; no object versions were mixed. Evidence: `rustfs-object-replacement.json`.

- [x] T9 发布准备审查记录在 `experiments/php-ffmpeg/reports/release-review.json`：记录本轮源码基线与 Docker 镜像 digest、工作区未提交这一发布阻断、播放器 `0.1.0/private` 与 Composer Git tag 版本策略、V1 schema/profile 兼容策略，以及应用 KeyProvider 必须先完成用户授权/资产授权再返回该视频固定密钥的责任边界。该记录不冒充最终 release commit、npm/Composer 发布或生产 CDN 验收。
- [x] T9 release-preparation review is recorded in `experiments/php-ffmpeg/reports/release-review.json`: it records the source baseline and Docker image digests for this run, the uncommitted worktree as a release blocker, the player `0.1.0/private` and Composer Git-tag version policy, the V1 schema/profile compatibility policy, and the application KeyProvider boundary requiring user/asset authorization before returning that video's stable key. This record does not claim a final release commit, npm/Composer publication, or production CDN acceptance.

- [x] Node 24 Docker 语法检查与构建通过，先前完整 `npm audit` 报告 0 个漏洞；PHP 与 Worker 通过固定记录向量及错误 tag/counter/序号/截断用例，ABR 包含 27 个实际加密分片并完成跨语言明文 SHA-256 校验。
- [x] Node 24 Docker syntax checks and build passed; the previous full `npm audit` reported 0 vulnerabilities; PHP and the Worker passed the fixed-record vector and invalid tag/counter/sequence/truncation cases, and the ABR package's 27 actual encrypted segments passed cross-language clear SHA-256 checks.

- [x] 本轮 Docker 验收报告保存在 `experiments/php-ffmpeg/reports/`，覆盖 Chromium 153、macOS Chrome 154、ABR 恒定/升降档/波动/seek、并行密钥域、本地 Nginx 代理、RustFS 故障注入、版本发布和 KeyProvider 拒绝/超时：`h264-abr-auto.json`、`h264-abr-auto-seek.json`、`h264-constant-64kibs.json`、`h264-constant-128kibs.json`、`h264-constant-512kibs.json`、`h264-bandwidth-up-64-to-512.json`、`h264-bandwidth-down-512-to-64.json`、`h264-bandwidth-fluctuation.json`、`h264-abr-auto-packaged.json`、`h264-abr-auto-final-regression.json`、`h264-abr-auto-macos-official-player.json`、`hevc-720p-macos-chrome-ctr-hmac.json`、`t4-transform-graph-ffmpeg5.json`、`t4-transform-graph-ffmpeg9.json`、`t5-rendition-audio-mapping-ffmpeg5.json`、`t5-rendition-audio-mapping-ffmpeg9.json`、`php80-syntax-compatibility.json`、`release-review.json`、`h264-switch-final.json`、`h264-range-resume-final.json`、`h264-etag-change.json`、`h264-seek-final.json`、`h264-weak-64-recovery.json`、`h264-weak-512-recovery.json`、`h264-rustfs-e2e.json`、`h264-rustfs-weak-128.json`、`nginx-proxy-e2e.json`、`nginx-proxy-weak-e2e.json`、`nginx-proxy-range-resume.json`、`nginx-proxy-three-retries.json`、`nginx-proxy-seek.json`、`rustfs-object-replacement.json`、`ctr-hmac-concurrent-generation.json`、`versioned-workflow-publication.json`、`key-provider-timeout.json` 和 `key-provider-rejection.json`。RustFS 故障注入使用临时 bucket，已在验收后删除。
- [x] Docker acceptance reports are saved under `experiments/php-ffmpeg/reports/` and cover Chromium 153, macOS Chrome 154, constant/upshift/downshift/fluctuating ABR and seek, parallel key domains, the local Nginx proxy, RustFS fault injection, version publication, and KeyProvider rejection/timeout: `h264-abr-auto.json`, `h264-abr-auto-seek.json`, `h264-constant-64kibs.json`, `h264-constant-128kibs.json`, `h264-constant-512kibs.json`, `h264-bandwidth-up-64-to-512.json`, `h264-bandwidth-down-512-to-64.json`, `h264-bandwidth-fluctuation.json`, `h264-abr-auto-packaged.json`, `h264-abr-auto-final-regression.json`, `h264-abr-auto-macos-official-player.json`, `hevc-720p-macos-chrome-ctr-hmac.json`, `t4-transform-graph-ffmpeg5.json`, `t4-transform-graph-ffmpeg9.json`, `t5-rendition-audio-mapping-ffmpeg5.json`, `t5-rendition-audio-mapping-ffmpeg9.json`, `php80-syntax-compatibility.json`, `release-review.json`, `h264-switch-final.json`, `h264-range-resume-final.json`, `h264-etag-change.json`, `h264-seek-final.json`, `h264-weak-64-recovery.json`, `h264-weak-512-recovery.json`, `h264-rustfs-e2e.json`, `h264-rustfs-weak-128.json`, `nginx-proxy-e2e.json`, `nginx-proxy-weak-e2e.json`, `nginx-proxy-range-resume.json`, `nginx-proxy-three-retries.json`, `nginx-proxy-seek.json`, `rustfs-object-replacement.json`, `ctr-hmac-concurrent-generation.json`, `versioned-workflow-publication.json`, `key-provider-timeout.json`, and `key-provider-rejection.json`. The RustFS fault-injection test used a temporary bucket that was deleted after acceptance.

- [x] 本次 PHP runtime 与稳定性证据另存为 `php80-runtime-hls.json`、`php80-runtime-hls-junit.xml`、`php80-runtime-progress-junit.xml`、`phpunit-php85-ffmpeg5-junit.xml`、`phpunit-php85-ffmpeg9-junit.xml` 和 `ffmpeg9-transcode-progress-stability.json`；汇总见 `release-review.json`。
- [x] PHP runtime and stability evidence from this pass is saved in `php80-runtime-hls.json`, `php80-runtime-hls-junit.xml`, `php80-runtime-progress-junit.xml`, `phpunit-php85-ffmpeg5-junit.xml`, `phpunit-php85-ffmpeg9-junit.xml`, and `ffmpeg9-transcode-progress-stability.json`; see `release-review.json` for the summary.

- [x] T2 stream-copy 失败后的 fallback 证据单独保存在 `faststart-remux-fallback-ffmpeg9.json`；PHP 8.0 语法兼容与 runtime 验收分别记录于 `php80-syntax-compatibility.json` 和 `php80-runtime-hls.json`。
- [x] T2 stream-copy failure fallback evidence is saved separately in `faststart-remux-fallback-ffmpeg9.json`; PHP 8.0 grammar compatibility and runtime acceptance are recorded in `php80-syntax-compatibility.json` and `php80-runtime-hls.json`.

- [x] 隔离 macOS Chrome 实测：应用注入测试密钥，播放 8.07 秒完整 VOD；从 360p 手动切至 720p 后继续播放结束。切档时观察到一次非致命请求取消，未阻断播放；这不证明自动 ABR 或弱网续传。
- [x] Isolated macOS Chrome check: the application injected the test key and played the complete 8.07-second VOD; playback continued to the end after a manual 360p-to-720p switch. One non-fatal request cancellation occurred during switching and did not block playback; this does not prove automatic ABR or weak-network resumption.

- [x] 另一轮 Chrome 检查将首个密文响应截断于 70,000 字节；播放器从完整记录边界 65,592 发送 `Range` + `If-Range`，服务端返回匹配 ETag 的 `206`，整段仍播放完成；独立检查从 4 秒位置 seek 后播放结束。
- [x] In a separate Chrome run, the first ciphertext response was truncated at 70,000 bytes; the player resumed from the complete-record boundary at byte 65,592 with `Range` plus `If-Range`, received a `206` with the matching ETag, and completed playback; a separate check sought to 4 seconds and played to the end.

- [x] 同一 PHP 加密打包器和播放器对 HEVC 720p fMP4 HLS 样本实测通过：macOS Chrome 154 解密并播放 3 个分片至 6.07 秒视频结束，报告尺寸为 1280×720，fatalErrors=0；仅代表该 Chrome/macOS 组合，不代表其他浏览器或移动系统。证据：`experiments/php-ffmpeg/reports/hevc-720p-macos-chrome-ctr-hmac.json`。
- [x] The same PHP encrypting packager and player passed against the 720p HEVC fMP4 HLS sample: macOS Chrome 154 decrypted and played 3 segments through the 6.07-second video to completion at 1280×720, with fatalErrors=0; this applies only to that Chrome/macOS combination and not to other browsers or mobile operating systems. Evidence: `experiments/php-ffmpeg/reports/hevc-720p-macos-chrome-ctr-hmac.json`.

播放器按 64 KiB 认证记录流式读取和解密，但只把完整 `moof`/`mdat` 对追加至 MSE；当前 2 秒 HLS 夹具每个媒体分片只有一个 `moof`，所以本次不能证明首帧早于该分片下载完成。若要求更低首帧延迟，生成侧必须缩短分片/fragment 周期并按目标网络实测，或另行设计 LL-HLS。
The player reads and decrypts authenticated 64 KiB records as a stream, but appends only complete `moof`/`mdat` pairs to MSE; each media segment in the current 2-second HLS fixture contains one `moof`, so this run does not prove that the first frame appears before that segment finishes downloading. For lower first-frame latency, the generation stage must shorten the segment/fragment cadence and test it against target networks, or LL-HLS must be designed separately.

以上结果只支持本 SDD 明确列出的本地 fMP4 VOD 后处理与已测试 Chrome/H.264 播放路径；未验证的平台、编码器、网络行为和生产密钥服务仍不得标记为 Supported。
These results support only the local fMP4 VOD post-processing and tested Chrome/H.264 playback path defined here; untested platforms, encoders, network behavior, and production key services must not be marked Supported.

## 当前实现边界
## Current implementation boundaries

类型化 Workflow 当前每次接收一个本地视频输入并产出一个本地 HLS VOD 输出；多个 rendition 属于同一视频资产。对外配置使用 value object、枚举式常量和有类型的 workflow step，不要求调用方构造 FFmpeg 参数字符串。
The typed Workflow currently accepts one local video input and produces one local HLS VOD output per run; its multiple renditions belong to that single video asset. Public configuration uses value objects, enum-like constants, and typed workflow steps, so callers do not construct FFmpeg argument strings.

首期只支持单个本地视频输入和最多一个内嵌音频流；不支持独立音频/字幕输入、多个内嵌音轨/视频轨/字幕轨、多个源资产拼接、直播 HLS 或远程 URL 输入，所有不支持的轨道组合必须在 FFmpeg 编码前拒绝。PHP 不会自动启动/编排 Docker，必须运行在已提供 FFmpeg 的容器内，并使用该容器可见的媒体路径。CTR/HMAC 可选择跨运行的版本目录与 current 指针事务发布。
The first release supports one local video input with at most one embedded audio stream. Separate audio/subtitle inputs, multiple embedded audio/video/subtitle tracks, concatenating multiple source assets, live HLS, and remote URL inputs are unsupported; every unsupported track combination must be rejected before FFmpeg encoding. PHP does not launch/orchestrate Docker; it must run inside a container with FFmpeg and use container-visible media paths. CTR/HMAC supports optional version-directory publication with a transactional current pointer across runs.

T9 的阶段性安全检查确认密钥不写入 descriptor/sidecar，`KeyMaterial` 的 debug 输出会脱敏且 PHP 序列化会被拒绝，播放器只有在每条 CTR/HMAC 记录验签后才向 MSE 提供明文；PHP 运行时字符串的内存清零保证、生产 KeyProvider 的授权/轮换治理及生产 CDN 配置仍由应用方负责并未在此验收。
The interim T9 security review confirms that keys are not written to descriptors or sidecars, `KeyMaterial` redacts debug output and rejects PHP serialization, and the player supplies clear bytes to MSE only after authenticating each CTR/HMAC record; guaranteed erasure of PHP runtime strings, authorization/rotation governance for the production KeyProvider, and production CDN configuration remain the application's responsibility and are not accepted here.

## 1. 背景与问题
## 1. Background and problem

隔离 Demo 已验证一条可工作的本地路径：FFmpeg 生成 H.264/HEVC fMP4 HLS，媒体分片按认证记录格式进行 AES-CTR 加密；Dedicated Worker 先验证 HMAC，再解密并将明文交给 hls.js/MSE。
The isolated Demo has verified a working local path: FFmpeg creates H.264/HEVC fMP4 HLS, media segments are encrypted as authenticated AES-CTR records, and a Dedicated Worker verifies each HMAC before decrypting and passing clear media to hls.js/MSE.

正式播放器已在 macOS Chrome 154 对本库 PHP 生成的 18 秒加密 H.264 多码率 VOD 完成自动 ABR：在受控带宽变化下自动切换 480p、720p、360p，9 个缓冲分片均通过 CTR/HMAC 与 sidecar 明文 SHA-256 校验并播放至 ended。此结果只覆盖该 macOS Chrome 组合与本地 Docker Nginx 源站，不代表其他浏览器或生产 CDN。
The packaged player completed automatic ABR in macOS Chrome 154 against an 18-second encrypted H.264 multi-rendition VOD generated by this library: under controlled bandwidth changes it automatically switched through 480p, 720p, and 360p; all 9 buffered segments passed CTR/HMAC and sidecar clear-SHA-256 verification and playback reached ended. This result covers only this macOS Chrome combination and the local Docker Nginx origin, not other browsers or the production CDN.

加密打包 API、sidecar/descriptor 生成和播放器源码已从隔离 Demo 移入库内；隔离 Demo 仍保留为历史实验记录，正式使用入口和支持范围以本 SDD 的实施状态段为准。
The encryption packager API, sidecar/descriptor generation, and player source have moved from the isolated Demo into the repository; the isolated Demo remains as historical experimental evidence, while the implementation-status section in this SDD defines the current usage entry point and support boundary.

本 SDD 把用户提出的两项目标定义为一项端到端交付：把已验证的 CTR/HMAC 记录加密接入 HLS 编排产物，并把播放逻辑整理成应用可集成的浏览器播放器，播放密钥由应用外部提供。
This SDD defines the user's two goals as one end-to-end delivery: integrate the verified CTR/HMAC record encryption into HLS orchestration outputs, and package the playback logic as a browser player that applications can integrate while supplying playback keys externally.

本设计中的 CTR/HMAC 是项目自定义的媒体加密封装，不是 HLS 标准 `AES-128`、`SAMPLE-AES`、CBCS 或 DRM；普通 HLS 播放器不能仅凭 M3U8 自动解密这种媒体。
The CTR/HMAC scheme in this design is a project-specific media-encryption envelope, not HLS-standard `AES-128`, `SAMPLE-AES`, CBCS, or DRM; a generic HLS player cannot decrypt these media files from the M3U8 alone.

## 2. 目标、非目标与设计约束
## 2. Goals, non-goals, and design constraints

- 将当前 CTR/HMAC 记录格式作为可选的 HLS 输出加密策略，集成到现有拟议的 Workflow/Runner 编排链路中。
- Integrate the current CTR/HMAC record format as an optional HLS output-encryption policy in the proposed Workflow/Runner orchestration path.

- 为每个输出分片生成不含秘密的 sidecar 元数据，并生成可供播放器发现播放配置的版本化描述文件。
- Generate a secret-free sidecar for every output segment and a versioned playback descriptor that the player can use to discover playback configuration.

- 将 Demo 播放逻辑整理为可独立版本化、可复用的浏览器播放器接口，使用 hls.js 的公开扩展点、Dedicated Worker 与 MSE。
- Package the Demo playback logic as an independently versioned, reusable browser-player interface using hls.js public extension points, a Dedicated Worker, and MSE.

- 加密端和播放端的密钥都必须由调用方的外部 provider 提供；密钥字节不得写入 HLS 清单、sidecar、播放描述文件、日志或最终媒体产物的非加密区域。
- Both encryption-side and playback-side keys must come from caller-supplied external providers; key bytes must not be written to HLS playlists, sidecars, playback descriptors, logs, or unencrypted portions of the final media output.

- 不改变既有 `open()->save()` 行为；HLS 编排与播放器均通过可单独使用的新 API/包提供。
- Do not change existing `open()->save()` behavior; expose HLS orchestration and the player as separately usable new APIs/packages.

- 在 Docker 环境中运行 PHP、FFmpeg、FFprobe 与打包/加密工具；浏览器播放器在最终用户浏览器中运行。
- Run PHP, FFmpeg, FFprobe, and packaging/encryption tools in Docker; run the browser player in the end user's browser.

- 本期不承诺 DRM、授权服务、FairPlay/Widevine 许可证、原生 iOS/Android 播放器支持、直播、密钥托管、离线播放或防止授权用户提取明文。
- This delivery does not promise DRM, an entitlement service, FairPlay/Widevine licenses, native iOS/Android player support, live streaming, hosted keys, offline playback, or protection against an authorized user extracting clear media.

## 3. 加密格式与互操作边界
## 3. Encryption format and interoperability boundary

对外算法标识使用版本化名称 `phpffmpeg-ctr-hmac-v1`；该名称表示分片字节被切为有序记录，每条记录包含序号、CTR counter、密文长度、密文字节和 HMAC-SHA-256 标签。
Use the versioned external algorithm identifier `phpffmpeg-ctr-hmac-v1`; it means each segment is divided into ordered records containing a sequence number, CTR counter, ciphertext length, ciphertext bytes, and an HMAC-SHA-256 tag.

记录最大明文长度、二进制头布局、counter 递增规则、HMAC 输入域分隔、字节序和校验顺序必须在独立的格式说明中冻结，并由 PHP 与 JavaScript 共用的测试向量验证。
Maximum record plaintext size, binary header layout, counter increment rules, HMAC domain separation, byte order, and verification order must be frozen in a separate format specification and validated by shared PHP/JavaScript test vectors.

解密端必须先验证记录完整性和序号/长度/counter 一致性，再运行 AES-CTR 解密；任何失败记录的明文都不得释放给 MSE。
The decryptor must verify record integrity and sequence/length/counter consistency before AES-CTR decryption; no clear bytes from a failed record may be released to MSE.

每个加密分片必须有唯一 `contentId` 和不可复用的 CTR counter 空间；实现不得因进程重启、ABR 变体并行生成或重试而在同一加密密钥下复用 counter。
Every encrypted segment must have a unique `contentId` and a non-reused CTR counter space; the implementation must not reuse counters under the same encryption key because of process restarts, parallel ABR rendition generation, or retries.

正式格式应支持从外部密钥派生互相隔离的 AES 与 HMAC 子密钥，或要求 provider 明确提供两把独立密钥；首选以 HKDF-SHA-256 按版本、用途及 `contentId` 派生子密钥，并用已评审的测试向量锁定派生输入。
The production format should either derive separate AES and HMAC subkeys from external key material or require the provider to supply two independent keys; prefer HKDF-SHA-256 derivation scoped by format version, purpose, and `contentId`, with reviewed test vectors fixing the derivation inputs.

集成前必须将 Demo 中的固定演示 AES/HMAC 密钥移除；生产 API 不提供默认密钥，也不得因未配置 provider 而退回演示密钥。
Before integration, remove the fixed demo AES/HMAC keys; the production API must not provide a default key or fall back to demo keys when no provider is configured.

此加密模式不能伪装成 `#EXT-X-KEY:METHOD=AES-128` 或 `METHOD=SAMPLE-AES`；标准 HLS 客户端看到的是不可直接解码的密文分片，只有兼容的自定义播放器可播放。
This encryption mode must not be represented as `#EXT-X-KEY:METHOD=AES-128` or `METHOD=SAMPLE-AES`; a standard HLS client sees ciphertext it cannot decode, and only a compatible custom player can play it.

未经加密的初始化段沿用 Demo 当前行为；调用方必须知晓 codec/init 信息仍可见，且本模式不提供 DRM 级内容保护。
Clear initialization segments follow the current Demo behavior; callers must understand that codec/init information remains visible and that this mode does not provide DRM-level content protection.

标准 CBCS/DRM 后端保持为独立加密 profile 和后续工作，不得混用自定义 CTR sidecar 或要求本播放器解密 CBCS。
The standard CBCS/DRM backend remains a separate encryption profile and follow-up effort; it must not reuse custom CTR sidecars or expect this player to decrypt CBCS.

## 4. 编排链路集成
## 4. Orchestration pipeline integration

一次 HLS 加密编排按可观察阶段执行：验证计划和工具能力、探测输入、转码并对齐各 rendition、生成明文 fMP4 HLS、加密每个媒体分片、生成 sidecar/播放描述文件、校验最终产物、原子发布。
An encrypted HLS workflow runs through observable stages: validate the plan and tool capabilities, probe inputs, transcode and align renditions, produce clear fMP4 HLS, encrypt each media segment, generate sidecars/playback descriptor, validate final artifacts, and publish atomically.

对有限、可 seek 的本地 MP4/MOV VOD 输入，执行转码前必须检查顶层 ISO-BMFF box 顺序；若 `moov` 位于首个 `mdat` 之后，或尚未验证为 faststart，则默认在 Docker 工作目录创建规范化副本，再以该副本作为探测和转码输入，绝不改写用户源文件。
For finite, seekable local MP4/MOV VOD inputs, inspect top-level ISO-BMFF box order before transcoding; if `moov` follows the first `mdat` or faststart has not been verified, create a normalized copy in the Docker work directory by default and use that copy for probing and transcoding, never modifying the user's source.

规范化优先使用 FFmpeg stream-copy remux（例如 `-map 0 -c copy -movflags +faststart`），不得仅为移动 `moov` 而有损重编码；必须再次解析 box 顺序并确认 `moov` 位于首个 `mdat` 之前，验证失败则停止并报告诊断信息。
Normalization must first try an FFmpeg stream-copy remux (for example, `-map 0 -c copy -movflags +faststart`) and must not perform lossy re-encoding merely to move `moov`; parse the box order again and confirm `moov` precedes the first `mdat`, otherwise stop and report diagnostics.

若 MP4/MOV 顶层 box 结构有效且输入可解码，但 stream-copy remux 失败或其输出未通过 faststart box 复验，则使用解码/转码 fallback 生成并验证 faststart 中间文件；fallback 失败必须在 HLS 打包前报告 remux 与 fallback 诊断。缺少完整 `moov`、box 结构损坏或不可 seek 的输入不能可靠解码，必须在任何编码尝试前作为无效输入拒绝，不得静默跳过检查。
If the MP4/MOV top-level box structure is valid and the input is decodable, but stream-copy remux fails or its output fails faststart box revalidation, use a decode/transcode fallback to produce and verify a faststart intermediate; if fallback fails, report both remux and fallback diagnostics before HLS packaging. Inputs missing a complete `moov`, with corrupt box structure, or not seekable cannot be reliably decoded and must be rejected as invalid before any encoding attempt instead of silently skipping the check.

faststart 是源/中间 MP4 的处理策略，不表示 `.m4s` 分片也必须具有相同布局；live/pipe 输入不属于本期有限 VOD 规范化范围，必须由 preflight 明确报告不支持或要求调用方提供有限输入。
Faststart is a policy for source/intermediate MP4 files and does not imply that `.m4s` fragments use the same layout; live/pipe inputs are outside this release's finite-VOD normalization scope, so preflight must explicitly report them as unsupported or require finite input from the caller.

规范化临时文件应位于任务隔离目录，记录输入是否已 faststart、是否发生 remux、FFmpeg 命令/版本及验证结果；任务完成或失败后按暂存产物清理策略处置。
Normalized temporary files must live in the isolated job directory, with the original faststart result, whether remux occurred, FFmpeg command/version, and verification result recorded; clean them according to the staging-artifact policy after success or failure.

faststart 检查器只需解析 ISO-BMFF 顶层 box，但必须支持 32 位 size、`largesize` 扩展 size 和文件尾部 size=0；box 越界、截断、size 小于 header 或找不到完整 `moov`/`mdat` 时均判为无效输入，不得仅用 `ffprobe` 的成功退出码推断 box 顺序。
The faststart inspector only needs to parse top-level ISO-BMFF boxes, but must support 32-bit sizes, extended `largesize`, and size=0 extending to EOF; out-of-bounds, truncated, undersized-header, or missing complete `moov`/`mdat` boxes make the input invalid, and a successful `ffprobe` exit code alone must not be used to infer box order.

FFmpeg 负责转码、时间戳/GOP 对齐和 HLS 分片；CTR/HMAC 加密作为独立后处理器逐个读取已经闭合的媒体分片，不把加密逻辑塞入编码器或依赖 FFmpeg 原生 HLS AES-128 选项。
FFmpeg handles transcoding, timestamp/GOP alignment, and HLS segmentation; CTR/HMAC encryption is a separate post-processor that reads each finalized media segment, rather than being embedded in the encoder or relying on FFmpeg's native HLS AES-128 option.

加密器写出密文临时文件、sidecar 和清单引用；全部分片、媒体清单和主清单通过完整性与引用检查后，才在同一输出发布边界内替换最终文件。
The encryptor writes ciphertext temporary files, sidecars, and playlist references; only after every segment, media playlist, and master playlist passes integrity and reference checks may the final files be replaced within one publication boundary.

不得先发布指向尚未完成密文或 sidecar 的主播放列表；失败时暂存目录应清理或保留为明确标记的诊断产物，不能冒充成功输出。
Do not publish a master playlist that points to ciphertext or sidecars that are not yet complete; on failure, clean the staging directory or retain it as explicitly marked diagnostic output, never as successful output.

HLS 输出对象应显式声明加密 profile；PHP 调用方使用类型化 `EncryptionProfile::ctrHmacV1()`，不手写 `phpffmpeg-ctr-hmac-v1`；该字符串只作为 descriptor/sidecar 的固定 wire-format 值生成。缺少 profile 表示明文输出，未来标准加密采用独立 profile 类型。
The HLS output object must declare its encryption profile explicitly; PHP callers use typed `EncryptionProfile::ctrHmacV1()` instead of writing `phpffmpeg-ctr-hmac-v1`, which is generated only as a fixed descriptor/sidecar wire-format value. No profile means clear output, and future standard encryption uses a separate profile type.

加密必须覆盖所有配置为保密的媒体类型；若首期不实现音频/字幕分片加密，则 `requireAllMediaEncrypted=true` 时应在执行前拒绝带独立音频/字幕的计划，而非静默输出明文轨道。
Encryption must cover every media type configured as confidential; if the first release does not encrypt separate audio/subtitle segments, reject plans containing those tracks before execution when `requireAllMediaEncrypted=true`, rather than silently emitting clear tracks.

自定义 CTR profile 首期仅接受 fMP4 媒体分片；若后端尚未实现 TS 记录加密和播放器解析，必须在静态预检中拒绝 MPEG-TS 输出。
The custom CTR profile initially accepts only fMP4 media segments; reject MPEG-TS during static preflight until TS record encryption and player parsing are implemented.

转码 rendition 必须使用同一时间线、分段边界和兼容的初始化段配置；包发布前检查媒体序号、分段时长、codec、分辨率和主播放列表 URI 与实际文件一致。
Transcoded renditions must share a timeline, segment boundaries, and compatible initialization-segment configuration; before publication, verify media sequence, segment durations, codec, resolution, and master-playlist URIs against actual files.

## 5. 编排 API 草案
## 5. Orchestration API proposal

`HlsOutput` 增加显式、类型化的加密配置，首期由 `EncryptionProfile::ctrHmacV1()` 构造；调用方不能传入任意 profile 字符串。加密配置引用 provider 与公开播放密钥 URI 解析器，不直接包含硬编码密钥字节。
Add an explicit, typed encryption configuration to `HlsOutput`, constructed for the first release with `EncryptionProfile::ctrHmacV1()`; callers cannot pass arbitrary profile strings. The encryption configuration references a provider and public playback-key-URI resolver rather than containing hard-coded key bytes.

编排 API 的 playlist mode、segment container、codec、分辨率策略、加密 profile、verify group、severity、key purpose、rotation policy、输入引用和处理方向均须由 PHP 8.0 兼容的类型化值对象/具名静态工厂表达；闭集选项不得要求用户手写字符串或 FFmpeg 参数。
The orchestration API must express playlist mode, segment container, codec, resolution policy, encryption profile, verify group, severity, key purpose, rotation policy, input references, and processing direction through PHP 8.0-compatible typed value objects/named static factories; callers must not need to write strings for closed choices or FFmpeg arguments.

路径、URL、用户定义的视频/输入/rendition ID、`keyId`、`keyUri`、文件名模板、语言标签、显示名和时间/码率等动态值不可能是预定义常量，但必须封装在 `ContainerPath`、`VideoAssetId`、`RenditionId`、`KeyId`、`KeyUri`、`Timecode`、`Bitrate` 等有语义的值对象中校验；仅高级扩展允许显式 opt-in 的原始 FFmpeg 选项。
Runtime values such as paths, URLs, caller-defined video/input/rendition IDs, `keyId`, `keyUri`, filename templates, language tags, display names, times, and bitrates cannot be predefined constants, but must be validated through semantic value objects such as `ContainerPath`, `VideoAssetId`, `RenditionId`, `KeyId`, `KeyUri`, `Timecode`, and `Bitrate`; only advanced extensions may accept raw FFmpeg options with explicit opt-in.

在 PHP 8.0 兼容 API 中，`EncryptionProfile`、`PlaylistMode`、`SegmentContainer`、`VideoCodec`、`AudioCodec`、`VerifyGroup`、`FindingSeverity`、`KeyPurpose` 和 `RotationPolicy` 等闭集选项必须使用类型化 value class/具名工厂；底层 M3U8/JSON 中的固定字符串由库序列化，不作为 PHP 调用方的配置参数。
In the PHP 8.0-compatible API, closed choices such as `EncryptionProfile`, `PlaylistMode`, `SegmentContainer`, `VideoCodec`, `AudioCodec`, `VerifyGroup`, `FindingSeverity`, `KeyPurpose`, and `RotationPolicy` must use typed value classes/named factories; the library serializes fixed strings into M3U8/JSON rather than exposing them as PHP caller configuration.

编排端定义 `EncryptionKeyProviderInterface`，按输出 ID、rendition ID、分片序号和密钥用途解析密钥材料；provider 可连接应用的 KMS、密钥服务、受限文件挂载或其他调用方设施。
The orchestrator defines `EncryptionKeyProviderInterface`, resolving key material by output ID, rendition ID, segment sequence, and key purpose; providers may connect to the application's KMS, key service, restricted file mount, or other caller infrastructure.

本期 `outputId` 同时作为视频资产的密钥作用域：同一视频的所有 rendition、分片和重新执行必须返回同一 `keyId` 与 32 字节主密钥；不同视频应使用不同 `outputId` 并可映射到不同密钥。CTR/HMAC 子密钥仍按每个分片的 `contentId` 独立派生，因此固定视频主密钥不意味着跨分片复用 AES/HMAC 子密钥或 CTR counter。
For this release, `outputId` is also the key scope for a video asset: all renditions, segments, and reruns of the same video must resolve to the same `keyId` and 32-byte master key; a different video uses a different `outputId` and may map to a different key. CTR/HMAC subkeys are still derived independently for each segment `contentId`, so a stable video master key does not mean reusing AES/HMAC subkeys or CTR counters across segments.

provider 只返回运行所需的密钥材料和非秘密 `keyId`；密钥不写入 WorkflowPlan 序列化结果、执行报告、异常、命令行、Docker 日志或 sidecar。
The provider returns only the required runtime key material and a non-secret `keyId`; key bytes must not enter serialized WorkflowPlans, execution reports, exceptions, command lines, Docker logs, or sidecars.

当下游加密器必须在独立进程内运行时，密钥仅能通过经过评审的受保护 IPC 或短生命周期权限 `0600` 的临时文件传递；临时文件需可靠清理，禁止通过可见进程参数传入。
If the encryptor must run in a separate process, pass keys only through reviewed protected IPC or a short-lived temporary file with `0600` permissions; reliably remove temporary files and never pass keys as visible process arguments.

建议调用顺序为：建立带容器路径的输入/步骤/输出计划，选择 CTR profile 并注入外部 `EncryptionKeyProviderInterface`，先运行 `verify()`，再运行 `execute()`；缺少 provider、URI 解析器或目标 profile 支持时 `verify()` 返回阻断 finding。
The suggested call sequence is: create an input/step/output plan using container paths, select the CTR profile and inject an external `EncryptionKeyProviderInterface`, call `verify()`, then call `execute()`; `verify()` returns a blocking finding when the provider, URI resolver, or target-profile support is missing.

`execute()` 结果包含生成产物索引、profile 版本、非秘密 keyId、分片数、sidecar URI、hash 校验结果和工具版本，不返回任何密钥或授权凭据。
The `execute()` result contains an artifact index, profile version, non-secret key IDs, segment count, sidecar URIs, hash-check results, and tool versions; it returns no keys or authorization credentials.

## 6. 输出文件与元数据契约
## 6. Output files and metadata contract

加密媒体分片继续使用 HLS playlist 中的分段 URI；URI 指向密文字节，扩展名由输出命名模板决定，不得让扩展名暗示标准播放器可直接解码。
Encrypted media segments retain their segment URIs in the HLS playlist; the URI points to ciphertext, and its extension comes from the output naming template without implying that a standard player can decode it directly.

每个分片 sidecar 的版本化字段至少包括 profile/version、segment URI、contentId、非秘密 keyId、key URI、base counter、记录表、明文字节数、密文字节数、明文 SHA-256、明文媒体 fragment 数和必要的认证参数。
Each versioned segment sidecar contains at least the profile/version, segment URI, contentId, non-secret keyId, key URI, base counter, record table, clear/cipher byte counts, clear SHA-256, clear media-fragment count, and required authentication parameters.

sidecar 不得包含 AES/HMAC 密钥、Bearer token、URL 用户名/密码、可重建秘密的派生输入或服务端内部文件路径。
Sidecars must not contain AES/HMAC keys, bearer tokens, URL usernames/passwords, derivation inputs that reveal secrets, or server-internal file paths.

输出根目录额外生成版本化 playback descriptor，声明 `profile=phpffmpeg-ctr-hmac-v1`、主 M3U8 URI、sidecar 查找/索引入口、mime/codec 信息及相对 URI 解析基准；它只包含播放器配置和资源索引，不包含密钥。
Generate a versioned playback descriptor at the output root declaring `profile=phpffmpeg-ctr-hmac-v1`, master M3U8 URI, sidecar lookup/index entry point, MIME/codec information, and relative-URI base; it contains player configuration and resource indexes only, never keys.

descriptor 与 M3U8 是独立产物；播放器不能假定 sidecar 总是与媒体同目录，必须按 descriptor/sidecar 中定义的 URL 和基准 URI 解析。
The descriptor and M3U8 are separate artifacts; the player must not assume sidecars always share a directory with media and must resolve URLs using the base URI defined by the descriptor/sidecar.

V1 当前 `playback.json` 固定包含 `version`、`profile`、`masterPlaylistUri`、`keyProvider` 和 `segmentCount`；播放器的 `load()` 接收 descriptor URL。V1 打包器将每个 sidecar 与对应 `.enc.m4s` 并置，并以媒体 URL 加 `.json` 得到 sidecar URL，未实现任意 sidecar 索引或跨目录资源清单。
The current V1 `playback.json` contains `version`, `profile`, `masterPlaylistUri`, `keyProvider`, and `segmentCount`; the player's `load()` accepts a descriptor URL. The V1 packager places each sidecar beside its `.enc.m4s` object and derives the sidecar URL by appending `.json` to the media URL; arbitrary sidecar indexes and cross-directory resource manifests are not implemented.

播放端必须验证 descriptor/profile 版本和 sidecar 所声明的 segment URI 与实际请求 URI 完全匹配，防止将一个对象的元数据用于另一个对象。
The player must validate descriptor/profile versions and require the segment URI in each sidecar to match the requested URI, preventing metadata for one object from being applied to another.

清单 JSON 如同时由既有编排需求启用，应从最终发布的 M3U8 解析生成；它与加密 sidecar、播放 descriptor 各有独立 schema 和职责。
If the existing orchestration option also enables M3U8 JSON, generate it by parsing the final published M3U8; it has a separate schema and purpose from encryption sidecars and the playback descriptor.

## 7. 可复用播放器与密钥外部注入
## 7. Reusable player and external key injection

播放器代码应从实验页面拆为独立 JavaScript/TypeScript package 或等价的独立发布单元，候选目录为 `player/`；不要将实验服务器、固定 demo key、样本媒体或测试密钥端点打入生产 bundle。公开集成应提供类型声明和导出的冻结常量对象，供调用方识别 playback profile、request purpose 等固定类别。
Extract the player from the experiment page into an independent JavaScript/TypeScript package or equivalent independently distributable unit, with `player/` as the candidate directory; do not bundle the experiment server, fixed demo keys, sample media, or test key endpoint. Public integration must provide type declarations and exported frozen constant objects so callers can identify closed choices such as playback profiles and request purposes.

播放器公开 API 至少接收 video element、由 `PlaybackDescriptorUrl.from()` 创建的 descriptor 地址、外部 `KeyProvider`、可选网络凭证/请求钩子、明确标为高级逃生舱的 hls.js 配置、生命周期事件回调和错误回调；请求钩子收到的 `purpose` 必须是有声明类型且可从包中导入的常量值。V1 不直接接收裸 M3U8 URL。
The public player API accepts at least a video element, a descriptor URL created by `PlaybackDescriptorUrl.from()`, external `KeyProvider`, optional network-credential/request hooks, hls.js configuration explicitly marked as an advanced escape hatch, lifecycle event callbacks, and an error callback; the `purpose` received by request hooks must be a declared typed value exposed as an importable package constant. V1 does not accept a raw M3U8 URL directly.

播放器包应导出冻结的 `PlaybackProfile.CTR_HMAC_V1`、`KeyProviderKind.APPLICATION`、`RequestPurpose.DESCRIPTOR`/`HLS`/`SEGMENT`/`SIDECAR`、`HttpCredentials.INCLUDE`/`SAME_ORIGIN`/`OMIT` 常量及 `PlaybackDescriptorUrl.from()` 构造器，并提供 JavaScript/TypeScript 声明；descriptor/sidecar 中必须使用的协议字符串由包解析，宿主应用通过导出的常量分支处理，不复制粘贴字符串字面值。
The player package should export frozen `PlaybackProfile.CTR_HMAC_V1`, `KeyProviderKind.APPLICATION`, `RequestPurpose.DESCRIPTOR`/`HLS`/`SEGMENT`/`SIDECAR`, and `HttpCredentials.INCLUDE`/`SAME_ORIGIN`/`OMIT` constants, plus a `PlaybackDescriptorUrl.from()` constructor and JavaScript/TypeScript declarations; the package parses protocol strings required in descriptors/sidecars, while host applications branch on exported constants instead of copying string literals.

首期密钥 provider 按 `{ keyId, keyUri, contentId, profile, signal }` 请求上下文返回恰好 32 字节的 `Uint8Array` 或 `ArrayBuffer` 主密钥；播放器将副本转移给 Worker，由 Worker 派生 AES/HMAC 子密钥。
The first-release key provider receives `{ keyId, keyUri, contentId, profile, signal }` and returns a 32-byte `Uint8Array` or `ArrayBuffer` master key; the player transfers a copy to the Worker, which derives the AES/HMAC subkeys.

播放器必须支持按分片 keyId 重新调用 provider；同一 keyId 的并发请求可合并，取消/切流后应使用 AbortSignal 取消失效请求，并且不得跨用户或跨授权上下文错误共享缓存。
The player must call the provider again when a segment's keyId changes; concurrent requests for the same keyId may be coalesced, stale requests must be cancelled with AbortSignal after cancellation or stream changes, and cache entries must not be shared across users or authorization contexts.

可选 `HttpKeyProvider` 可按 sidecar 的 key URI 使用 `fetch`，并允许应用注入 credentials、headers/token 获取回调、超时与重试策略；密钥 URI 与响应正文不得被播放器日志输出。
An optional `HttpKeyProvider` may use `fetch` with the key URI from the sidecar and allow the application to inject credentials, a headers/token callback, timeout, and retry policy; the player must not log key URIs or response bodies.

授权凭证由宿主应用通过内存中的回调/请求钩子提供；禁止把 token 或原始密钥拼入 playlist、sidecar、descriptor 的 query string、浏览器 URL、localStorage 或 IndexedDB。
The host application supplies authorization credentials through in-memory callbacks/request hooks; never place tokens or raw keys in playlist, sidecar, or descriptor query strings, browser URLs, localStorage, or IndexedDB.

取钥应使用 HTTPS；跨域部署必须正确配置 CORS、凭证模式和 OPTIONS 预检，播放器不得为绕过服务器策略而启用不安全的 `no-cors` 请求。
Key retrieval must use HTTPS; cross-origin deployments must configure CORS, credential mode, and OPTIONS preflight correctly, and the player must not enable unsafe `no-cors` requests to bypass server policy.

播放器将短生命周期主密钥副本以 transferable `ArrayBuffer` 发送给 Dedicated Worker；Worker 派生密钥后立即将接收的主密钥 buffer 清零，播放器销毁时终止 Worker 并清理引用。
The player sends a short-lived master-key copy to the Dedicated Worker as a transferable `ArrayBuffer`; the Worker zeroes its received master-key buffer immediately after derivation, and player destruction terminates the Worker and clears references.

该做法降低普通页面逻辑意外暴露密钥的机会，但不能抵御用户控制的浏览器、调试器、恶意扩展、内存检查或授权用户保存已解密媒体；产品描述不得称其为 DRM 或不可破解保护。
This reduces accidental key exposure to ordinary page code but cannot defend against a user-controlled browser, debugger, malicious extension, memory inspection, or an authorized user saving decrypted media; product claims must not call it DRM or unbreakable protection.

初期播放器沿用 hls.js `fLoader` 公共扩展点并为加密分片执行 sidecar/KeyProvider/Worker 管线；只有遇到已证实的 hls.js 公开 API 缺口时，才切换到自有 MSE 实现，并单独覆盖时间戳、append backpressure、音视频同步和 ABR。
The initial player retains hls.js's public `fLoader` extension point and runs the sidecar/KeyProvider/Worker pipeline for encrypted segments; switch to custom MSE only if a proven gap in hls.js's public API requires it, and separately cover timestamps, append backpressure, audio/video synchronization, and ABR.

首期播放器公开 `isSupported()`、`load()`、`play()`、`pause()`、`destroy()`、已实现的视频码率查询/选择、seek、错误与生命周期事件；独立音频轨选择尚未实现，播放库不负责转码、上传、用户登录、授权判定或密钥生成。
The first-release player exposes `isSupported()`, `load()`, `play()`, `pause()`, `destroy()`, implemented video-rendition query/selection, seeking, errors, and lifecycle events; separate audio-track selection is not implemented, and the library does not transcode, upload, authenticate users, decide entitlements, or generate keys.

## 8. Docker 与运行时边界
## 8. Docker and runtime boundaries

Composer 示例和集成验证在项目 Docker Compose 服务内执行；输入媒体、输出目录和运行时秘密源通过显式挂载/secret provider 暴露为容器路径。
Composer examples and integration validation run in the project's Docker Compose service; input media, output directories, and runtime secret sources are exposed as container paths through explicit mounts/secret providers.

宿主机不需要安装 PHP、FFmpeg 或加密工具；浏览器端 package 在消费者应用构建系统中安装/构建，不要求用户为 PHP 库部署 Demo Node 服务。
The host does not need PHP, FFmpeg, or encryption tools installed; the browser package is installed/built by the consumer application's toolchain and does not require deploying the PHP library's Demo Node server.

Docker image 必须固定并可报告 PHP、FFmpeg/FFprobe 和记录加密实现的版本；更换基础镜像或加密实现时，跨语言向量和端到端 HLS 验收必须重跑。
The Docker image must pin and report PHP, FFmpeg/FFprobe, and record-encryptor versions; changing the base image or encryption implementation requires rerunning cross-language vectors and end-to-end HLS acceptance.

宿主机密钥目录不得默认挂载；生产部署应使用 Docker secrets、只读受限挂载或应用自己的密钥服务适配器，且不能把 secrets 纳入 Git、镜像层或 Compose 输出。
Do not mount host key directories by default; production deployment should use Docker secrets, restricted read-only mounts, or the application's own key-service adapter, and must not include secrets in Git, image layers, or Compose output.

## 9. 错误、缓存与安全约定
## 9. Error, caching, and security conventions

任何缺失 provider、未知 profile/版本、sidecar 不匹配、密钥用途不匹配、HMAC 失败、counter 重用、播放器不支持 codec/MSE、CORS/授权失败都应返回可分类错误码和脱敏诊断。
Missing providers, unknown profiles/versions, sidecar mismatches, key-purpose mismatches, HMAC failures, counter reuse, unsupported codec/MSE, and CORS/authorization failures must return categorized error codes and redacted diagnostics.

认证失败、媒体身份不匹配或密钥获取被拒绝时，播放器应停止追加当前片段及其后继密文，不得回退到未经认证解密或原样交给媒体元素。
On authentication failure, media-identity mismatch, or denied key retrieval, the player must stop appending the current and subsequent ciphertext and must not fall back to unauthenticated decryption or pass ciphertext directly to the media element.

密钥响应建议使用 `Cache-Control: no-store`；如业务必须缓存，应由应用显式定义仅内存、按 keyId/授权上下文隔离且有限时的策略。
Key responses should use `Cache-Control: no-store`; if business requirements need caching, the application must explicitly define a memory-only, keyId/authorization-context-isolated, time-bounded policy.

日志与异常只允许输出 profile、非秘密 keyId、segment 序号、耗时、字节数和错误分类；禁止记录原始密钥、key 响应、Bearer token、带凭据 URL 或完整请求 headers。
Logs and exceptions may include only the profile, non-secret keyId, segment sequence, timing, byte counts, and error category; never log raw keys, key responses, bearer tokens, credential-bearing URLs, or full request headers.

播放器销毁、播放源切换、页面卸载和授权失效时，应中止进行中的 manifest/segment/key 请求、停止 Worker、移除媒体源并释放 hls.js/MSE 资源。
On player destruction, source changes, page unload, or entitlement expiry, abort in-flight manifest/segment/key requests, stop the Worker, detach the media source, and release hls.js/MSE resources.

## 10. 分阶段实施计划
## 10. Phased implementation plan

### 阶段 A：冻结互操作格式与密钥契约
### Phase A: Freeze the interoperability format and key contract

逐字段文档化记录格式、HKDF 输入/输出、counter 唯一性约束、sidecar schema 和播放 descriptor schema；建立 PHP/JavaScript 共享的合法与损坏向量。
Document the record format, HKDF inputs/outputs, counter-uniqueness requirements, sidecar schema, and playback-descriptor schema field by field; create shared valid and corrupted test vectors for PHP and JavaScript.

确定加密 profile 只服务自定义浏览器播放器，并决定首期是否只加密视频 rendition，或必须同时覆盖分离音频/字幕。
Confirm that the encryption profile targets only the custom browser player, and decide whether the first release encrypts video renditions only or must also cover separate audio/subtitle tracks.

### 阶段 B：接入 HLS 编排与输出发布
### Phase B: Integrate with HLS orchestration and artifact publication

实现 PHP 加密 provider 接口与 CTR/HMAC encryptor，并证明 PHP 产物与浏览器 Worker 对同一测试向量互通。
Implement the PHP encryption-provider interface and CTR/HMAC encryptor, and prove that PHP artifacts interoperate with the browser Worker using the same test vectors.

在 HLS Workflow 中增加显式 encryption profile、静态 preflight finding、分片后处理、sidecar/descriptor 输出、最终 HLS URI 重写和事务式发布。
Add an explicit encryption profile, static preflight findings, post-segmentation encryption, sidecar/descriptor output, final HLS URI rewriting, and transactional publication to the HLS Workflow.

Docker 集成测试使用短 H.264 与 HEVC fMP4 样本，检查所有 playlist 引用、各变体时间戳/分段边界、sidecar 密文/明文字节数和最终哈希。
Docker integration tests use short H.264 and HEVC fMP4 samples to check every playlist reference, rendition timestamps/segment boundaries, sidecar ciphertext/clear byte counts, and final hashes.

### 阶段 C：整理播放器为正式集成物
### Phase C: Package the player as a supported integration artifact

从 Demo 提取播放器核心、Worker、schema/type 定义和构建配置；依赖版本固定，生产构建不得打入测试 fixture、硬编码密钥和测试 key endpoint。
Extract the player core, Worker, schemas/type definitions, and build configuration from the Demo; pin dependencies and ensure production builds exclude test fixtures, hard-coded keys, and the test key endpoint.

实现外部 KeyProvider 契约、HTTP provider 扩展钩子、播放器生命周期/事件/错误模型和清晰的安装/使用示例。
Implement the external KeyProvider contract, HTTP provider extension hooks, player lifecycle/events/error model, and clear installation and usage examples.

播放器示例应由 PHP HLS Workflow 真实输出驱动，而不是使用 Demo 固定密钥或手工构造 sidecar。
Drive the player example with actual PHP HLS Workflow outputs instead of Demo fixed keys or hand-crafted sidecars.

### 阶段 D：互操作、网络与回归验收
### Phase D: Interoperability, network, and regression acceptance

验证 360p/480p/720p 多码率加密播放中的自动升档/降档、手动选档、跨 rendition 连续性，以及同一视频在所有 rendition 和分片上使用恒定 keyId/密钥。
Validate automatic up/down switching, manual selection, continuity across renditions, and one stable keyId/key across all renditions and segments of the same video during encrypted 360p/480p/720p playback.

ABR 验收必须针对仓库内正式 `player/` 包和 PHP 生成的加密播放清单，固定并记录浏览器版本、初始带宽、带宽变化时间线、播放分辨率、切档事件、卡顿时长、最终播放头和每个加载分片的 sidecar/HMAC/明文 hash 结果；分别覆盖自动升档、降档、抖动带宽和手动锁档。
ABR acceptance must use the packaged `player/` code and encrypted playlists generated by PHP, and record browser version, initial bandwidth, bandwidth-change timeline, playback resolution, switch events, rebuffer duration, final playhead, and sidecar/HMAC/clear-hash results for every loaded segment; cover automatic up-switching, down-switching, fluctuating bandwidth, and manual level selection.

首轮网络档位采用可复现的 64、128、512 KiB/s 限速轨迹，并包含限速变化及一次连接中断；本期弱网通过标准为播放器能够恢复并播放至 VOD 结束，允许出现卡顿，报告仍须记录卡顿次数和总时长，不得据此宣称弱网无卡顿。
The first reproducible network profiles use 64, 128, and 512 KiB/s throttling traces, including a bandwidth change and one connection interruption; the weak-network pass criterion for this release is recovery and playback through VOD completion, with stalls allowed. Reports must still record stall count and total duration and must not claim stall-free weak-network playback.

在 RustFS/CDN 代理链路测试渐进响应、HTTP Range/If-Range、ETag、对象缓存、CORS、弱网限速、断线续传与 seek 行为。
Test progressive responses, HTTP Range/If-Range, ETag, object caching, CORS, weak-network throttling, interrupted-transfer resume, and seeking through the RustFS/CDN delivery path.

RustFS/CDN 验收逐层记录请求与响应：`200`/`206`/`416`、`Content-Range`、`Accept-Ranges`、稳定 ETag、`If-Range` 过期行为、CORS 暴露的 `ETag`/`Content-Range`、缓存命中及对象内容编码；缺失或变化的 ETag 必须触发安全重取或明确失败，不能把不同对象版本拼接解密。
RustFS/CDN acceptance must record requests and responses at each layer: `200`/`206`/`416`, `Content-Range`, `Accept-Ranges`, stable ETags, stale `If-Range` behavior, CORS exposure of `ETag`/`Content-Range`, cache hits, and content encoding; a missing or changed ETag must trigger a safe refetch or explicit failure, never concatenate and decrypt different object versions.

RustFS 本地对象存储与 CDN/反向代理必须分别报告结果；仅 RustFS 通过不能推定 CDN 缓存键、跨源 CORS、压缩/变换或断点续传行为兼容。
Report RustFS object-storage results separately from CDN/reverse-proxy results; passing RustFS alone does not establish compatible CDN cache keys, cross-origin CORS, compression/transformation, or resume behavior.

### 阶段 D 的可执行验证步骤
### Executable verification steps for Phase D

所有生成、打包、存储、限速代理和自动化浏览器依赖均通过 Docker 运行；不得要求宿主机安装 PHP、FFmpeg、Node 或浏览器驱动。上线前不要求连接 iOS/Android 真机；移动设备验收安排在上线后。
Run all generation, packaging, storage, throttling-proxy, and automated-browser dependencies in Docker; do not require PHP, FFmpeg, Node, or browser drivers on the host. No iOS/Android physical device is required before launch; mobile-device acceptance is scheduled after launch.

先用 Docker FFmpeg 从固定短样本生成时间线对齐的 H.264 360p/480p/720p fMP4 VOD，片段目标时长为 2 秒；再生成 720p HEVC 样本。记录源 hash、命令、镜像 digest、实际 codec/分辨率/码率、每档分片时长及明文 hash，确保所有 rendition 使用可切换的共同边界。
First use Docker FFmpeg to generate timeline-aligned H.264 360p/480p/720p fMP4 VOD from the fixed short sample with a 2-second target segment duration, then generate a 720p HEVC sample. Record source hash, command, image digest, actual codec/resolution/bitrate, segment durations per rendition, and clear hashes to ensure renditions share switchable boundaries.

用正式 PHP 打包器及测试 KeyProvider 生成加密产物，并由正式 `player/` 包播放；每次用例保存浏览器事件、HTTP 请求/响应头、ABR 切档、缓冲状态、Worker 验签结果和最终播放状态。隔离 Demo 只能用于比较，不得作为该步骤的通过证据。
Generate encrypted artifacts with the packaged PHP encryptor and a test KeyProvider, then play them through the packaged `player/`; save browser events, HTTP request/response headers, ABR switches, buffer state, Worker authentication results, and final playback state for every case. The isolated Demo may be used for comparison but cannot count as passing evidence for this step.

ABR 用例至少包括恒定 64/128/512 KiB/s、64 至 512 KiB/s 升速、512 至 64 KiB/s 降速、周期性抖动、手动锁定各档及切档后 seek；通过条件为发生预期切档、所有已追加分片认证/hash 通过、无 fatal error，且断连用例恢复后 VOD 到达 ended。允许卡顿，报告卡顿次数和总时长即可。
ABR cases must include constant 64/128/512 KiB/s, an increase from 64 to 512 KiB/s, a decrease from 512 to 64 KiB/s, periodic fluctuation, manual locking of each rendition, and seeking after a switch; pass when the expected switch occurs, every appended segment passes authentication/hash checks, no fatal error occurs, and VOD reaches ended after recovery in the interruption case. Stalls are allowed; report their count and total duration.

弱网验收夹具固定使用 2 秒目标 HLS 分片和 CTR/HMAC V1 的 64 KiB 最大明文记录；播放器对中断/短读最多执行 3 次续传尝试，且每次续传必须从完整记录边界开始并使用匹配 ETag。首帧延迟只记录测量值，不设本期通过阈值；只有完整媒体 fragment 可追加时，报告不得承诺早于该 fragment 下载完成的首帧。
The weak-network acceptance fixture uses a 2-second target HLS segment and the CTR/HMAC V1 maximum clear record size of 64 KiB; the player makes at most 3 resume attempts after interruption/short reads, and every resume must start at a complete record boundary with a matching ETag. Measure first-frame latency but set no pass threshold for this release; when only complete media fragments can be appended, do not promise a first frame before the fragment has downloaded completely.

固定密钥用例为每个视频资产配置一个测试 keyId/主密钥，并在所有 rendition 与分片中保持不变；另一个视频资产必须使用不同 keyId/主密钥。逐段断言 sidecar 与 provider 的 keyId 一致，并覆盖 ABR 切换、seek、未知 keyId 拒绝及 provider 超时；密钥内容不得写入 fixture、日志或报告。
For the fixed-key case, assign one test keyId/master key to each video asset and keep it unchanged across all renditions and segments; a different video asset must use a different keyId/master key. Assert per segment that the sidecar and provider keyIds match, and cover ABR switching, seeking, unknown-keyId rejection, and provider timeout; key bytes must never appear in fixtures, logs, or reports.

先对 RustFS 对象端点执行同源 Range/If-Range 与对象变更用例，再通过实际反向代理/CDN 路径重复相同测试并打开跨源 CORS；每条路径均检查首个完整认证记录开始解密、断点续传不重复/漏读记录、ETag 变化不拼接对象，以及 seek 后能按需取得相应分片。
First run same-origin Range/If-Range and object-mutation cases against the RustFS endpoint, then repeat them through the actual reverse-proxy/CDN path with cross-origin CORS enabled; for each path, verify decryption starts at the first complete authenticated record, resume neither duplicates nor skips records, changed ETags do not mix object versions, and seeking fetches the required segments on demand.

上线前浏览器验证覆盖 Docker 可复现的自动化桌面浏览器与现有 macOS Chrome；移动真机浏览器验证推迟到上线后，作为单独的兼容性验收阶段。对纳入自动化矩阵的环境先跑 Worker/WebCrypto/MSE/codec 探测，再跑 CTR/HMAC H.264 播放、seek、ABR 和密钥拒绝；HEVC 单独探测和播放，任何缺失能力都不得静默回退到未经解密的原生 HLS。
Before launch, browser checks cover reproducible automated desktop browsers in Docker and the available macOS Chrome; physical mobile-browser checks are deferred to a separate post-launch compatibility phase. For environments in the automated matrix, run Worker/WebCrypto/MSE/codec checks before CTR/HMAC H.264 playback, seeking, ABR, and key denial; probe and play HEVC separately, and never silently fall back to undecrypted native HLS when a capability is missing.

每轮验收生成可复查报告，至少包括提交 SHA、Docker 镜像 digest、样本 SHA、环境/设备版本、测试参数、原始事件日志、请求头、输出 hash、通过/失败项和已知限制；测试密钥只用临时随机值，报告只记录 keyId。
Each acceptance run must produce a reviewable report containing at least commit SHA, Docker image digest, sample SHA, environment/device versions, test parameters, raw event logs, request headers, output hashes, pass/fail items, and known limitations; use temporary random test keys and record only keyIds in reports.

- [x] 隔离浏览器夹具验证一次明确截断响应后的 HTTP Range/If-Range 续传及 4 秒 seek；该检查未经过 RustFS、CDN、跨源 CORS 或限速代理。
- [x] The isolated browser fixture verified HTTP Range/If-Range resumption after an explicitly truncated response and a 4-second seek; this check did not use RustFS, a CDN, cross-origin CORS, or a throttling proxy.

上线前至少在现有 macOS Chrome 验证 H.264 与 HEVC；桌面自动化浏览器记录浏览器版本、MSE/Worker/WebCrypto/codec 能力、实际 rendition 和播放结果。Safari/iOS 与 Android 真机不作为上线前阻断项，列入上线后的专项验收，并在该验收完成前标记为未验证/不支持。
Before launch, validate H.264 and HEVC in the available macOS Chrome at minimum; desktop automation records browser version, MSE/Worker/WebCrypto/codec capabilities, selected rendition, and playback results. Physical Safari/iOS and Android checks do not block this release; schedule them as post-launch acceptance and mark them unverified/unsupported until they pass.

所有纳入验收的浏览器先执行能力探测，再执行加密 H.264 720p 播放、适用时的 HEVC 720p 播放、seek、ABR 档位切换和密钥拒绝用例；不支持自定义解密链路的原生 HLS 回退必须显式报不支持，不能把普通原生 HLS 播放成功记为 CTR/HMAC 播放通过。
Run capability detection before encrypted H.264 720p playback, HEVC 720p playback where applicable, seeking, ABR level switching, and key-denial cases in every browser included in acceptance; if a native-HLS fallback cannot use the custom decryption path, report it as unsupported and do not count ordinary native HLS playback as a CTR/HMAC pass.

### 阶段 E：稳定化与发布决策
### Phase E: Stabilization and release decision

完成安全审查、PHPUnit 单元/集成覆盖、浏览器自动化覆盖、包版本策略、Docker 示例、迁移/限制说明及用户可复制的错误排查文档。
Complete security review, PHPUnit unit/integration coverage, browser automation coverage, package-version policy, Docker examples, migration/limitations notes, and reproducible troubleshooting documentation.

播放器 npm 包在 API 稳定并准备发布前保持 `0.1.0` 且 `private: true`；本库 Composer 版本继续使用上游 Git tag 管理，不在 `composer.json` 固定独立版本。首期 `playback.json` schema 与 `phpffmpeg-ctr-hmac-v1` profile 固定为 V1；V1 仅允许不改变解释方式的可选扩展字段，未知 profile/schema 必须拒绝。任何密文记录、派生或必需字段语义不兼容的变更都必须新增 profile/schema 版本并提供迁移说明。
Keep the player npm package at `0.1.0` with `private: true` until its API is stable and publication is approved; continue managing the Composer library version through upstream Git tags rather than pinning an independent version in `composer.json`. Freeze the initial `playback.json` schema and `phpffmpeg-ctr-hmac-v1` profile at V1; V1 permits only optional extensions that do not change interpretation, and unknown profiles/schemas must be rejected. Any incompatible change to ciphertext records, derivation, or required-field semantics must introduce a new profile/schema version with migration notes.

### 施工任务编排与依赖
### Implementation task order and dependencies

以下任务按依赖顺序执行；每项完成后保存实现、自动化验证结果和可复查产物，再进入依赖它的任务。
Execute the tasks below in dependency order; save the implementation, automated verification results, and reviewable artifacts for each task before starting its dependents.

任务状态以代码和验收证据为准；已有 Demo 结果或仅能成功构建的包不等同于正式链路验收通过。
Task status is determined by code and acceptance evidence; prior Demo results or a package that merely builds do not count as acceptance of the production path.

#### ✅ T0：冻结契约并建立共享测试向量
#### ✅ T0: Freeze contracts and establish shared test vectors

交付物：冻结 CTR/HMAC V1 记录格式、sidecar/descriptor schema、每视频固定 key 契约及跨 PHP/Worker 的合法、损坏、截断测试向量；播放器已有的常量、类型声明和 URL 包装器纳入契约。
Deliverables: freeze the CTR/HMAC V1 record format, sidecar/descriptor schemas, fixed-key-per-video contract, and valid, invalid, and truncated test vectors shared by PHP and Worker; include the player constants, type declarations, and URL wrapper already added to the contract.

退出条件：PHP 与 JavaScript 对同一向量得到完全一致的认证结果、明文和错误分类；格式版本不匹配时明确拒绝。
Exit criteria: PHP and JavaScript produce identical authentication results, cleartext, and error classifications for the same vectors; mismatched format versions are explicitly rejected.

#### ✅ T1：实现 PHP 类型安全 API 与不可变计划模型
#### ✅ T1: Implement the type-safe PHP API and immutable plan model

依赖：T0。
Dependency: T0.

交付物：基于项目最低 PHP 版本实现具名 value objects、闭合集合常量、不可变 WorkflowPlan、稳定的输入/资产/rendition ID 和结构化诊断；普通调用不得要求用户手写 FFmpeg 参数字符串。
Deliverables: implement named value objects, closed-set constants, an immutable WorkflowPlan, stable input/asset/rendition IDs, and structured diagnostics using the project's minimum PHP version; normal use must not require users to write FFmpeg argument strings.

退出条件：PHPUnit 覆盖非法值、类型边界、计划序列化/校验和诊断；面向用户的示例只用类型/常量表达闭合集合选项；PHP 8.0 Docker runtime 以最低依赖组合运行 HLS 单测。
Exit criteria: PHPUnit covers invalid values, type boundaries, plan serialization/validation, and diagnostics; user-facing examples express closed-set options only with types/constants; the PHP 8.0 Docker runtime runs the HLS unit tests with the lowest compatible dependencies.

- [x] T1 PHP PHPUnit 验证 `WorkflowPlan` 的序列化往返保留 typed inputs、steps、outputs，并覆盖不可变性、重复 ID 拒绝和 typed option 边界。证据：`WorkflowTest::testWorkflowPlanCanBeSerializedAndRestoredWithoutChangingTypedSteps` 与 `WorkflowTest::testPlanIsImmutableAndRejectsDuplicateInputIds`。
- [x] T1 PHP PHPUnit verifies that a `WorkflowPlan` serialization round trip preserves typed inputs, steps, and outputs, and covers immutability, duplicate-ID rejection, and typed-option bounds. Evidence: `WorkflowTest::testWorkflowPlanCanBeSerializedAndRestoredWithoutChangingTypedSteps` and `WorkflowTest::testPlanIsImmutableAndRejectsDuplicateInputIds`.

- [x] PHP 8.0 grammar parser 在 PHP 8.5 Docker 中对 50 个 HLS source/test/example PHP 文件解析通过；PHP 8.0.30 Docker + PHPUnit 9.6.33 + 最低兼容依赖运行 HLS 单测 30/206 与进度回归 4/30 均通过。证据：`php80-syntax-compatibility.json`、`php80-runtime-hls.json`、`php80-runtime-hls-junit.xml`、`php80-runtime-progress-junit.xml`。
- [x] The PHP 8.0 grammar parser passed on 50 HLS source/test/example PHP files inside PHP 8.5 Docker; PHP 8.0.30 Docker with PHPUnit 9.6.33 and the lowest compatible dependencies then passed the HLS unit suite (30/206) and progress regression (4/30). Evidence: `php80-syntax-compatibility.json`, `php80-runtime-hls.json`, `php80-runtime-hls-junit.xml`, and `php80-runtime-progress-junit.xml`.

#### ✅ T2：实现输入探测与 faststart 规范化
#### ✅ T2: Implement input probing and faststart normalization

依赖：T1。
Dependency: T1.

交付物：Docker 内输入探测、MP4 box 检查、必要时优先 stream-copy remux 到任务暂存区；若结构有效的输入无法 remux，则解码/转码生成 faststart 中间文件并复验；不得修改源文件，WorkflowResult 应记录处理策略、验证状态和工具版本。
Deliverables: probe inputs and inspect MP4 boxes in Docker, preferring stream-copy remux into the task staging area; if a structurally valid input cannot be remuxed, decode/transcode a faststart intermediate and revalidate it. Never modify the source; WorkflowResult records the normalization method, validation state, and tool versions.

退出条件：本 SDD 所列正常/扩展长度/size=0/截断/越界 box 用例通过；非 faststart 输入得到可验证中间文件，失败时在 FFmpeg 编码前给出诊断。
Exit criteria: the normal, extended-size, size-zero, truncated, and out-of-bounds box cases listed in this SDD pass; non-faststart inputs produce a verifiable intermediate, and failures provide diagnostics before encoding.

#### ✅ T3：实现静态 Verify 与兼容性预检
#### ✅ T3: Implement static verification and compatibility preflight

依赖：T1、T2。
Dependencies: T1 and T2.

交付物：在转码前验证容器/codec/HLS 封装组合、恰好一个视频流、至多一个音频流且没有字幕流、仅支持单视频输入、输出路径冲突、faststart 状态及加密 profile/provider；预检 finding 使用稳定 code 和类型化上下文。V1 不公开任意流索引或播放器能力声明；rendition 的实际时间线对齐在 T5 输出后验证，播放器 codec/MSE 能力由播放器在运行时检测。
Deliverables: before transcoding, validate container/codec/HLS packaging combinations, exactly one video stream, at most one audio stream and no subtitle streams, the single-video-input limit, output-path collisions, faststart state, and encryption profile/provider; preflight findings use stable codes and typed context. V1 exposes no arbitrary stream indexes or player-capability declarations; T5 checks actual rendition timeline alignment after encoding, and the player detects codec/MSE capability at runtime.

退出条件：已知不兼容组合在启动 FFmpeg 编码前失败且指出修复方式；无视频流、多输入计划和不支持的内嵌音视频/字幕流组合在 FFmpeg capability probes 前被拒绝；warning 与 error 可由调用方通过常量稳定识别。
Exit criteria: known-incompatible combinations fail before FFmpeg encoding and identify how to fix them; missing-video, multi-input, and unsupported embedded audio/video/subtitle combinations are rejected before FFmpeg capability probes; callers can identify warnings and errors through stable constants.

- [x] T3 预检会探测输入的全部轨道；缺少视频时返回 `VIDEO_STREAM_REQUIRED`，多视频返回 `MULTIPLE_VIDEO_STREAMS_UNSUPPORTED`，多输入返回 `MULTIPLE_INPUTS_UNSUPPORTED`，多音频或字幕返回 `AUXILIARY_MEDIA_STREAMS_UNSUPPORTED`，均在 FFmpeg capability probe 前停止。Docker PHPUnit 覆盖视频缺失、不支持的内嵌轨道和多输入拒绝路径。
- [x] T3 preflight inspects every input stream; missing video returns `VIDEO_STREAM_REQUIRED`, multiple video streams return `MULTIPLE_VIDEO_STREAMS_UNSUPPORTED`, multiple inputs return `MULTIPLE_INPUTS_UNSUPPORTED`, and multiple audio or subtitle streams return `AUXILIARY_MEDIA_STREAMS_UNSUPPORTED`. All stop before FFmpeg capability probes. Docker PHPUnit covers missing video, unsupported embedded tracks, and multi-input rejection.

#### ✅ T4：实现转码图与 Docker FFmpeg 执行器
#### ✅ T4: Implement the transform graph and Docker FFmpeg runner

依赖：T1、T2、T3。
Dependencies: T1, T2, and T3.

交付物：把裁剪、旋转/转置、截取和音频处理表示为有类型的步骤；缩放尺寸、视频编码、视频码率和音频码率由类型化 rendition/output 配置表达。执行器生成参数数组并调用 Docker FFmpeg，记录版本、命令摘要和退出诊断，不记录密钥。
Deliverables: represent crop, rotate/transpose, trim, and audio processing as typed steps; express scale dimensions, video codec, video bitrate, and audio bitrate through typed rendition/output configuration. The runner generates argument arrays and invokes Docker FFmpeg, recording versions, command summaries, and exit diagnostics without logging keys.

退出条件：Docker PHPUnit 覆盖类型化步骤的闭合集合/边界和 FFmpeg 失败清理；短样本组合处理结果经 ffprobe 与输出探测复核；失败任务不发布部分输出；宿主机无需安装 PHP/FFmpeg。
Exit criteria: Docker PHPUnit covers the typed steps' closed values/bounds and cleanup after FFmpeg failure; a short combined-transform output is checked with ffprobe and output probing; failed tasks do not publish partial outputs; the host does not need PHP/FFmpeg installed.

- [x] T4 类型化转码图与 Docker 执行器验收通过：Docker PHPUnit 覆盖 crop、transpose、trim、AudioGain 的封闭滤镜与边界，并注入 FFmpeg 退出码 7 验证暂存区和正式输出均清理；Docker FFmpeg 5.1.9 与 FFmpeg 9.0.2 均对 26.mp4 的 3 秒测试输入执行 320×180 crop、顺时针转置、+6 dB 音频增益和 360×640 fMP4 输出。原样本没有音频，因此仅为该验收在 Docker 中加入合成 440 Hz AAC 音轨；两种版本均由 ffprobe 确认输出时长 3.003 秒、视频尺寸及音频轨道，生成 2 个分片。结果携带不含原始参数/密钥的类型化命令摘要。证据：`t4-transform-graph-ffmpeg5.json`、`t4-transform-graph-ffmpeg9.json`。
- [x] T4 typed transform graph and Docker runner acceptance passed: Docker PHPUnit covers the closed filters and bounds for crop, transpose, trim, and AudioGain, and injects FFmpeg exit code 7 to verify cleanup of staging and final output; FFmpeg 5.1.9 and FFmpeg 9.0.2 in Docker both processed a 3-second test input derived from 26.mp4 with a 320×180 crop, clockwise transpose, +6 dB audio gain, and 360×640 fMP4 output. The original sample has no audio, so a synthetic 440 Hz AAC track was added in Docker for this acceptance only; ffprobe on both versions confirmed 3.003-second duration, video dimensions, and an audio track, and 2 segments were generated. The result includes a typed command summary without raw arguments or keys. Evidence: `t4-transform-graph-ffmpeg5.json` and `t4-transform-graph-ffmpeg9.json`.

#### ✅ T5：实现多 rendition HLS 输出
#### ✅ T5: Implement multi-rendition HLS output

依赖：T4。
Dependency: T4.

交付物：生成时间线可切换的 H.264 360p/480p/720p fMP4 VOD 与独立 720p HEVC 用例，支持约定的 master/media playlist 输出模式；首期只支持单个源视频及最多一个内嵌音频流，必须校验每个 rendition 的视频/音频轨道及 `.m4s` 引用。独立音频/字幕、多内嵌音轨/视频轨或字幕轨映射属于后续版本，当前必须在预检中明确拒绝。
Deliverables: generate switch-aligned H.264 360p/480p/720p fMP4 VOD and a separate 720p HEVC case, and support the agreed master/media playlist modes. V1 supports one source video and at most one embedded audio stream, and must validate video/audio streams and `.m4s` references for every rendition. Separate audio/subtitle inputs and multiple embedded audio/video/subtitle tracks belong to a later version and must be explicitly rejected during preflight for now.

退出条件：所有 rendition 的共同切换边界、初始化段、分片时长、内嵌音频映射和 playlist URI 均通过自动检查；独立音频/字幕多输入及不支持的内嵌轨道在 FFmpeg capability probe 前被拒绝；输出由固定测试样本在 Docker 中可重复生成。
Exit criteria: common switch boundaries, initialization segments, segment durations, embedded-audio mapping, and playlist URIs pass automated checks for all renditions; separate audio/subtitle inputs and unsupported embedded tracks are rejected before FFmpeg capability probes; outputs can be reproduced in Docker from the fixed test sample.

- [x] T5 多 rendition HLS 与内嵌音频映射在 Docker FFmpeg 5.1.9 与 9.0.2 上均通过：360p/480p/720p 三档均由 ffprobe 确认尺寸正确且各含一个视频/音频流；三档均有 2 个同名边界分片，执行器同时验证 fMP4 init、URI 存在与累计时间线一致。独立音频/字幕输入、多内嵌音轨/视频轨及字幕轨均在工具探测前拒绝。证据：`t5-rendition-audio-mapping-ffmpeg5.json`、`t5-rendition-audio-mapping-ffmpeg9.json`、`WorkflowTest::testSeparateTrackInputsAreRejectedBeforeToolProbes`、`WorkflowTest::testUnsupportedEmbeddedTracksAreRejectedBeforeFfmpegCapabilityProbe`。
- [x] T5 multi-rendition HLS and embedded-audio mapping passed with Docker FFmpeg 5.1.9 and 9.0.2: ffprobe confirmed the expected dimensions and one video/audio stream in each of the 360p/480p/720p renditions; each has two segments with matching boundary names, and the runner also validates fMP4 init files, URI existence, and aligned cumulative timelines. Separate audio/subtitle inputs, multiple embedded audio/video streams, and embedded subtitle tracks are rejected before tool probes. Evidence: `t5-rendition-audio-mapping-ffmpeg5.json`, `t5-rendition-audio-mapping-ffmpeg9.json`, `WorkflowTest::testSeparateTrackInputsAreRejectedBeforeToolProbes`, and `WorkflowTest::testUnsupportedEmbeddedTracksAreRejectedBeforeFfmpegCapabilityProbe`.

#### ✅ T6：接入 CTR/HMAC 加密与事务式发布
#### ✅ T6: Integrate CTR/HMAC encryption and transactional publication

依赖：T0、T5。
Dependencies: T0 and T5.

交付物：调用外部 KeyProvider 获取每个 video asset 固定的 keyId/密钥；逐分片加密并生成 sidecar、descriptor 和重写后的播放清单；验证完成后发布不可变版本并原子切换指针。
Deliverables: obtain the fixed keyId/key for each video asset from an external KeyProvider; encrypt each segment and generate sidecars, descriptors, and rewritten playlists; publish an immutable version and atomically switch the pointer only after validation.

退出条件：不同视频资产使用不同 key；同一资产所有 rendition/分片使用同一 keyId；PHP/Worker 明文 hash 一致；注入发布故障时旧版本仍可读且暂存产物被清理。
Exit criteria: different video assets use different keys; all renditions/segments of one asset use the same keyId; PHP/Worker cleartext hashes match; injected publication failures leave the old version readable and clean staged artifacts.

#### ✅ T7：将正式 PHP 产物接入播放器包
#### ✅ T7: Connect production PHP artifacts to the player package

依赖：T1、T6。
Dependencies: T1 and T6.

交付物：播放器从 PHP descriptor 加载 profile、playlist 和外部 KeyProvider；通过公开常量/类型配置闭合集合选项，保留动态 URL/ID 的语义类型，并提供端到端 Docker 示例。
Deliverables: load the profile, playlist, and external KeyProvider from the PHP descriptor; configure closed-set options through public constants/types, retain semantic types for dynamic URLs/IDs, and provide an end-to-end Docker example.

退出条件：Node 24 Docker 构建及包 API 检查通过；生产构建不含 fixture/测试 key endpoint；由正式 PHP 生成物驱动 H.264 加密播放且每个追加分片认证成功。
Exit criteria: the Node 24 Docker build and package API checks pass; production builds contain no fixtures/test key endpoint; production PHP artifacts drive encrypted H.264 playback and every appended segment authenticates successfully.

#### ✅ T8：完成浏览器、ABR、RustFS/CDN 与弱网验收
#### ✅ T8: Complete browser, ABR, RustFS/CDN, and weak-network acceptance

依赖：T6、T7。
Dependencies: T6 and T7.

交付物：按阶段 D 执行 ABR 升降档、手动选档、seek、Range/If-Range、ETag 变化、断线续传、RustFS 与代理/CDN 分层测试及 64/128/512 KiB/s 弱网轨迹；分开报告 H.264 与 HEVC 结果。
Deliverables: execute Phase D's ABR up/down switching, manual selection, seeking, Range/If-Range, ETag changes, interrupted-transfer resume, layered RustFS and proxy/CDN testing, and 64/128/512 KiB/s weak-network traces; report H.264 and HEVC separately.

退出条件：所有已追加分片认证通过、无 fatal error、断连后 VOD 最终 ended；允许卡顿但必须记录；RustFS 通过不能替代 CDN/代理路径通过。
Exit criteria: every appended segment authenticates, no fatal error occurs, and VOD eventually reaches ended after interruption; stalls are allowed but must be recorded; passing RustFS does not substitute for passing the CDN/proxy path.

#### ✅ T9：安全审查、全量回归与发布准备（发布 commit/tag 于合并后创建）
#### ✅ T9: Security review, full regression, and release preparation (release commit/tag follows merge)

依赖：T1 至 T8。
Dependencies: T1 through T8.

交付物：运行 Docker PHPUnit 与播放器自动化回归，完成密钥/日志/临时文件审查、schema/profile 兼容策略、安装文档、限制说明和可复查验收报告。
Deliverables: run Docker PHPUnit and player automation regression, review key/log/temp-file handling, define schema/profile compatibility policy, and complete installation docs, limitations, and a reviewable acceptance report.

退出条件：第 11 节上线前桌面验收项逐项有证据；未通过或未覆盖的生产 CDN、移动真机和最终发布 commit/tag 明确列为上线边界/待办，不以 Demo 结果替代。全量 Docker PHPUnit：PHP 8.5.11 + FFmpeg 5.1.9 为 587 tests/1,379 assertions/9 skipped；PHP 8.5.11 + FFmpeg 9.0.2 为 587 tests/1,405 assertions/9 skipped；PHP 8.0.30 最低依赖 HLS 单测 30/206 和进度回归 4/30 通过。安全/密钥、schema/profile、安装文档、限制说明及发布边界审查记录于 `release-review.json`。合并前工作区与生产 CDN、移动真机、release commit/tag 均保留为明确边界。
Exit criteria: every desktop pre-launch criterion in Section 11 has evidence; production CDN, physical mobile devices, and the final release commit/tag are explicitly listed as deployment boundaries/follow-up work and are not replaced by Demo results. Full Docker PHPUnit reports 587 tests/1,379 assertions/9 skipped on PHP 8.5.11 + FFmpeg 5.1.9 and 587 tests/1,405 assertions/9 skipped on PHP 8.5.11 + FFmpeg 9.0.2; PHP 8.0.30 minimum-dependency HLS tests passed with 30/206 and the progress regression with 4/30. Security/key handling, schema/profile policy, installation docs, limitations, and release boundaries are recorded in `release-review.json`. The pre-merge worktree, production CDN, physical mobile devices, and release commit/tag remain explicit boundaries.

#### ⏳ T10：上线后移动设备专项验收
#### ⏳ T10: Post-launch mobile-device acceptance

依赖：T9；这是上线后的独立阶段，不阻断本期桌面发布，但未通过前必须标记为未验证/不支持。
Dependency: T9; this is a separate post-launch phase and does not block this desktop release, but must remain marked unverified/unsupported until it passes.

交付物：在真实 Safari/iOS 与 Android 设备上按能力探测、H.264 CTR/HMAC、seek、ABR、弱网和适用时 HEVC 的流程记录设备/系统/浏览器版本及结果。
Deliverables: on real Safari/iOS and Android devices, record device/OS/browser versions and results for capability detection, H.264 CTR/HMAC, seeking, ABR, weak-network behavior, and HEVC where applicable.

退出条件：每个明确支持的设备组合均有可复查通过报告；不支持的组合给出明确能力诊断。
Exit criteria: every explicitly supported device combination has a reviewable passing report; unsupported combinations provide clear capability diagnostics.

## 11. 验收标准
## 11. Acceptance criteria

- [x] 非 faststart 的有限 MP4 输入在 Docker Workflow 中默认以 stream-copy 规范化；box 顺序复验通过、源文件 hash 不变，且已 faststart 输入不会重复 remux。证据：`experiments/php-ffmpeg/reports/faststart-workflow.json`。
- [x] A finite non-faststart MP4 input is normalized by default in the Docker Workflow using stream copy; box-order revalidation passes, the source hash is unchanged, and an already-faststart input is not remuxed again. Evidence: `experiments/php-ffmpeg/reports/faststart-workflow.json`.

- [x] 无法验证 faststart 的损坏 MP4 在启动 remux 前失败并给出 box 检查诊断；Workflow Verify 会在启动 FFmpeg 前阻断非法 MP4。证据：`WorkflowTest::testFaststartNormalizerFailsClearlyOnMalformedInputBeforeRemux` 与 `experiments/php-ffmpeg/reports/faststart-workflow.json`。
- [x] A malformed MP4 that cannot pass faststart inspection fails with a box-inspection diagnostic before remux; Workflow Verify blocks invalid MP4 before FFmpeg starts. Evidence: `WorkflowTest::testFaststartNormalizerFailsClearlyOnMalformedInputBeforeRemux` and `experiments/php-ffmpeg/reports/faststart-workflow.json`.

- [x] Docker PHPUnit 覆盖正常顺序、`largesize`、size=0、截断、越界、缺少 `moov`/`mdat` 与 non-faststart 顺序；真实 Docker remux 前后源文件 hash 相同。证据：`WorkflowTest` 与 `experiments/php-ffmpeg/reports/faststart-workflow.json`。
- [x] Docker PHPUnit covers normal ordering, `largesize`, size=0, truncation, out-of-bounds boxes, missing `moov`/`mdat`, and non-faststart ordering; the source hash is identical before and after a real Docker remux. Evidence: `WorkflowTest` and `experiments/php-ffmpeg/reports/faststart-workflow.json`.

- [x] FFmpeg 9 短暂回报较早的时间戳时，进度百分比和 current time 保持单调不减；新增确定性回归用例通过，PHP 8.0/8.5 均验证通过；修复后 FFmpeg 5 与 FFmpeg 9 全量 PHPUnit 均通过，原先间歇失败的 FFmpeg 9 转码用例连续 10 次通过。证据：`VideoProgressListenerTest::testProgressDoesNotMoveBackWhenFfmpegReportsAnEarlierTimestamp`、`ffmpeg9-transcode-progress-stability.json`、`phpunit-php85-ffmpeg5-junit.xml`、`phpunit-php85-ffmpeg9-junit.xml`。
- [x] When FFmpeg 9 briefly reports an earlier timestamp, progress percentage and current time remain monotonic; the deterministic regression passes on PHP 8.0/8.5, and the full PHPUnit suites pass after the fix on both FFmpeg 5 and FFmpeg 9. The previously intermittent FFmpeg 9 transcode case then passed 10 consecutive runs. Evidence: `VideoProgressListenerTest::testProgressDoesNotMoveBackWhenFfmpegReportsAnEarlierTimestamp`, `ffmpeg9-transcode-progress-stability.json`, `phpunit-php85-ffmpeg5-junit.xml`, and `phpunit-php85-ffmpeg9-junit.xml`.

- [x] T2 stream-copy remux 被故障注入为 exit 42 后，Docker FFmpeg 9 自动进入 decode/transcode fallback；生成的 H.264/AAC 中间文件由 box parser 与 ffprobe 验证为 faststart，源文件 SHA-256 保持不变。无完整 `moov` 的损坏输入仍在编码前拒绝。证据：`experiments/php-ffmpeg/reports/faststart-remux-fallback-ffmpeg9.json`、`WorkflowTest::testFaststartNormalizerFailsClearlyOnMalformedInputBeforeRemux`、`WorkflowTest::testFaststartNormalizerFallsBackToTranscodeWhenStreamCopyRemuxFails`。
- [x] After injecting exit 42 into the stream-copy remux, Docker FFmpeg 9 entered the decode/transcode fallback; the generated H.264/AAC intermediate was verified as faststart by the box parser and ffprobe, while the source SHA-256 remained unchanged. Corrupt input without a complete `moov` is still rejected before encoding. Evidence: `experiments/php-ffmpeg/reports/faststart-remux-fallback-ffmpeg9.json`, `WorkflowTest::testFaststartNormalizerFailsClearlyOnMalformedInputBeforeRemux`, and `WorkflowTest::testFaststartNormalizerFallsBackToTranscodeWhenStreamCopyRemuxFails`.

- [x] 弱网或短读时最多续传 3 次；连续注入 3 次短读后，播放器发出 3 次 Range 请求，起点 `65592`、`131184`、`131184` 均为 sidecar 完整记录边界且每次 `If-Range` 使用原 ETag，明文记录验证后播放至 VOD 末尾；旧 ETag 变化场景仍被拒绝。证据：`nginx-proxy-three-retries.json`、`h264-etag-change.json`。
- [x] The player resumes at most 3 times after weak-network interruption or short reads; after injecting 3 consecutive short reads it made 3 Range requests at `65592`, `131184`, and `131184`, all complete sidecar-record boundaries using the original ETag in every `If-Range`, authenticated the clear records, and played through the VOD; stale-ETag changes remain rejected. Evidence: `nginx-proxy-three-retries.json` and `h264-etag-change.json`.

- [x] CTR/HMAC Workflow 可用 `PublicationMode::versioned()` 将完整多 rendition 包写入不可变版本目录，校验 master/descriptor/segments/sidecars 后再原子替换 `current.json`；重复发布后旧版本仍可读。构建阶段和指针提交阶段故障注入均清理暂存/未提交目录并保留旧指针。证据：`versioned-workflow-publication.json`、`testVersionedPublisherKeepsThePreviousVersionWhenBuildingOrCommittingFails`。
- [x] CTR/HMAC Workflow can use `PublicationMode::versioned()` to write each complete multi-rendition package into an immutable version directory, validate master/descriptor/segments/sidecars, and then atomically replace `current.json`; the previous version remains readable after republishing. Fault injection during build and pointer commit removes staging/uncommitted directories and preserves the prior pointer. Evidence: `versioned-workflow-publication.json` and `testVersionedPublisherKeepsThePreviousVersionWhenBuildingOrCommittingFails`.

- [x] HLS Workflow 可显式选择 `phpffmpeg-ctr-hmac-v1`；未配置 KeyProvider/KeyUriResolver 时返回 `KEY_PROVIDER_REQUIRED`，且回归用例确认 FFmpeg/FFprobe 都未启动。证据：`experiments/php-ffmpeg/reports/key-provider-preflight.json`。
- [x] The HLS Workflow can explicitly select `phpffmpeg-ctr-hmac-v1`; without a KeyProvider/KeyUriResolver it returns `KEY_PROVIDER_REQUIRED`, and a regression test confirms neither FFmpeg nor FFprobe starts. Evidence: `experiments/php-ffmpeg/reports/key-provider-preflight.json`.

- [x] 首期 PHP 后处理输出包含可解析的主/媒体 M3U8、逐段密文与 sidecar、`playback.json`；跨语言夹具覆盖三档、12 段并由 Chrome 播放其中的 360p/720p rendition。
- [x] The first-release PHP post-processor emits master/media M3U8 files, one ciphertext and sidecar per segment, and `playback.json`; the interoperability fixture covers 12 segments across three renditions, and Chrome played its 360p/720p renditions.

- [x] 12 个 PHP 生成分片的 Worker 解密明文 SHA-256 均匹配；跨语言测试还篡改首条记录 tag 并确认 Worker 在释放该记录明文前拒绝。
- [x] Worker clear SHA-256 matched for all 12 PHP-generated segments; the interoperability test also corrupted a first-record tag and confirmed that the Worker rejects it before releasing that record's clear bytes.

- [x] Docker PHPUnit 同时启动两个相同资产、相同主密钥的 PHP 打包进程；每个进程并行处理两档 rendition 和 4 个分片，8 个 `contentId` 全部唯一，各分片内 CTR counter 唯一，跨 PHP/Worker 测试向量继续通过。报告只记录 keyId/内容域编号，不包含主密钥。证据：`ctr-hmac-concurrent-generation.json`、`CtrHmacV1Test`。
- [x] Docker PHPUnit launches two PHP packagers concurrently for the same asset and master key; each processes two renditions and four segments, all 8 `contentId` values are unique, counters are unique within every segment, and PHP/Worker interoperability vectors continue to pass. The report records keyIds/content-domain identifiers only and contains no master key. Evidence: `ctr-hmac-concurrent-generation.json` and `CtrHmacV1Test`.

- [x] 输出描述文件、M3U8、sidecar 与 WorkflowResult 只暴露 keyId/路径等非密钥字段；测试扫描发布产物中的原始、hex、base64 密钥，验证凭据 URL 被拒绝且诊断不回显 token；KeyMaterial debug/序列化脱敏测试通过，浏览器报告会剥离 URL 查询并过滤凭据请求头。证据：`CtrHmacV1Test`、`key-provider-rejection.json`、`key-provider-timeout.json`。
- [x] Playback descriptors, M3U8 files, sidecars, and WorkflowResult expose only non-secret fields such as keyIds and paths; tests scan published artifacts for raw, hex, and base64 keys, reject credential-bearing URLs without echoing tokens, and verify KeyMaterial debug/serialization redaction; browser reports strip URL queries and redact credential request headers. Evidence: `CtrHmacV1Test`, `key-provider-rejection.json`, and `key-provider-timeout.json`.

- [x] 独立播放器在隔离浏览器页面由宿主测试应用注入 KeyProvider，未依赖 Demo 密钥服务；取钥拒绝/超时策略仍由调用方实现并验证。
- [x] The standalone player accepted a KeyProvider injected by an isolated host test page without using the Demo key service; callers still own and must validate key-denial/timeout policy.

- [x] macOS Chrome 154 正式播放器自动 ABR 通过：18 秒 VOD 自动切换 480p→720p→360p 并完整 ended；9 个已缓冲分片均通过 sidecar、CTR/HMAC 与明文 SHA-256 校验，fatalErrors=0、completed=true。弱网轨迹与 Chrome/Node/Docker 版本记录在 `experiments/php-ffmpeg/reports/h264-abr-auto-macos-official-player.json`。
- [x] Official-player automatic ABR passed in macOS Chrome 154: the 18-second VOD automatically switched 480p→720p→360p and reached ended; all 9 buffered segments passed sidecar, CTR/HMAC, and clear SHA-256 checks, with fatalErrors=0 and completed=true. The network trace and Chrome/Node/Docker versions are recorded in `experiments/php-ffmpeg/reports/h264-abr-auto-macos-official-player.json`.

- [x] 正式播放器对自动升档/降档、弱网、RustFS 和 Nginx 代理轨迹记录切档/卡顿/完成指标；已验收的弱网和截断续传场景均在结束或恢复后播放至 VOD 末尾，允许卡顿。证据：`h264-abr-auto-packaged.json`、`nginx-proxy-weak-e2e.json`、`nginx-proxy-range-resume.json`。
- [x] The packaged player reports switch, rebuffer, and completion metrics for automatic up/down-switching and weak-network traces through RustFS and the Nginx proxy; accepted weak-network and truncated-transfer scenarios reach the end of the VOD after recovery or completion, with stalls allowed. Evidence: `h264-abr-auto-packaged.json`, `nginx-proxy-weak-e2e.json`, and `nginx-proxy-range-resume.json`.

- [x] PHP API 示例与实际调用仅使用类型化闭集配置；播放器包公开 profile/request-purpose 常量及声明文件，应用示例不比较或传入自定义字符串 token。证据：`examples/hls-workflow.php`、`player/README.md`、`player/src/index.d.ts`。
- [x] PHP API examples and calls use typed closed-choice configuration only; the player package exports profile/request-purpose constants and declaration files, and application examples do not compare or pass hand-written string tokens. Evidence: `examples/hls-workflow.php`, `player/README.md`, and `player/src/index.d.ts`.

- [x] 同一视频资产的所有 rendition、分片和 seek 均使用恒定 keyId/主密钥；不同视频资产可使用不同密钥；任何一段意外改变 keyId 都必须在验证或播放时明确失败。PHP 确定性 provider 覆盖跨 rendition/分片、重复发布、跨资产密钥隔离与意外 key 变化拒绝；正式播放器 seek 报告通过。
- [x] Every rendition, segment, and seek for one video asset uses a stable keyId/master key; different video assets can use different keys; any unexpected key change fails explicitly during validation or playback. The deterministic PHP provider covers renditions/segments, repeated publication, per-asset key separation, and rejection of unexpected key changes; the packaged-player seek report passed.

- [x] 确定性 provider 验证同一视频跨至少两个 rendition、全部分片和重复发布使用同一 keyId/密钥，另一资产使用不同 keyId；正式播放器 seek、未知 keyId 拒绝和 provider 超时均有浏览器证据。报告只保留 keyId，不含密钥字节。证据：`CtrHmacV1Test`、`h264-seek-final.json`、`key-provider-rejection.json`、`key-provider-timeout.json`。
- [x] A deterministic provider verifies one stable keyId/key across at least two renditions, all segments, and repeated publication, with a different keyId for another asset; the packaged player has browser evidence for seeking, unknown-keyId denial, and provider timeout. Reports retain keyIds only and contain no key bytes. Evidence: `CtrHmacV1Test`, `h264-seek-final.json`, `key-provider-rejection.json`, and `key-provider-timeout.json`.

- [x] 维护者选定的本地 Docker Nginx 代理已分别留存缓存/内容编码/跨源 Range/If-Range/ETag/CORS、弱网播放、seek 和截断续传报告；这只证明该 Nginx 配置，不代表生产 CDN。
- [x] The maintainer-selected local Docker Nginx proxy has separate reports for cache/content encoding/cross-origin Range/If-Range/ETag/CORS, weak-network playback, seeking, and truncated-transfer resumption; this proves only this Nginx configuration, not a production CDN.

- [x] RustFS 跨源真实替换故障注入通过：密文 GET 在 70,000 字节处截断后覆盖同一对象；播放器以旧 ETag 从完整认证记录边界 `65592` 请求 Range。RustFS 对不匹配的 `If-Range` 仍返回 `206`，但返回新 ETag；播放器明确拒绝响应且未把新版本字节追加到旧版本。临时 bucket 已删除。证据：`experiments/php-ffmpeg/reports/rustfs-object-replacement.json`。
- [x] RustFS cross-origin real-object replacement fault injection passed: after truncating the encrypted GET at 70,000 bytes, the same object was overwritten; the player requested a Range from the complete authenticated-record boundary `65592` with the old ETag. RustFS still returned `206` for the mismatched `If-Range`, but supplied the new ETag; the player explicitly rejected the response and did not append bytes from the new version to the old one. The temporary bucket was deleted. Evidence: `experiments/php-ffmpeg/reports/rustfs-object-replacement.json`.

- [x] 上线前支持声明限于实际通过验收的桌面浏览器组合；iOS Safari、Android Chrome/WebView 真机兼容验收列为上线后任务，在完成前标记为未验证/不支持。平台边界已在本 SDD 与 `player/README.md` 明确。
- [x] Before launch, support claims are limited to desktop browser combinations that actually pass acceptance; physical iOS Safari and Android Chrome/WebView compatibility is a post-launch task and remains marked unverified/unsupported until completed. Platform boundaries are stated in this SDD and `player/README.md`.

- [x] Docker 中的 HLS 集成示例无需宿主机 PHP/FFmpeg；`examples/hls-workflow.php` 在项目 Docker PHP/FFmpeg 镜像中运行，全量 PHPUnit 回归覆盖既有 `open()->save()` 与非 HLS 格式行为及原有配置。
- [x] The Docker HLS integration example requires no host PHP/FFmpeg; `examples/hls-workflow.php` runs in the project's Docker PHP/FFmpeg image, and the full PHPUnit regression covers existing `open()->save()` and non-HLS behavior under the existing configuration.

- [x] PHP HLS 示例以 PHP 8.0 兼容的 value objects/具名工厂表达 playlist、container、codec、encryption 与 Verify 选项；播放器示例导入 profile/request-purpose/credentials 常量并使用包声明文件，不传自定义字符串 token。证据：`examples/hls-workflow.php`、`player/README.md`、`player/src/index.d.ts`。
- [x] PHP HLS examples express playlist, container, codec, encryption, and Verify choices with PHP 8.0-compatible value objects/named factories; the player example imports profile/request-purpose/credentials constants and uses the package declarations without hand-written string tokens. Evidence: `examples/hls-workflow.php`, `player/README.md`, and `player/src/index.d.ts`.

- [x] 文档明确说明 CTR/HMAC profile 需要兼容自定义播放器、不等同 DRM、不承诺标准 HLS 客户端可播，并列出当前已测和未测平台边界。
- [x] Documentation states that the CTR/HMAC profile requires a compatible custom player, is not DRM, is not playable by standard HLS clients, and lists tested and untested platform boundaries.

## 12. 风险与未决决定
## 12. Risks and open decisions

- [x] 首期按已确认范围只加密视频 rendition；独立音频/字幕若要求保密，必须在执行前拒绝，后续另行设计覆盖范围。
- [x] The confirmed first-release scope encrypts video renditions only; reject separate audio/subtitle tracks before execution when confidentiality is required, and design their coverage separately later.

- [x] 首期密钥契约采用应用外部提供的 32 字节主密钥，由 CTR/HMAC profile 按分片 `contentId` 和用途以 HKDF-SHA-256 派生独立 AES/HMAC 子密钥；派生参数与共享向量由格式规范冻结。
- [x] The first-release key contract uses a 32-byte master key supplied externally by the application; the CTR/HMAC profile derives separate AES/HMAC subkeys with HKDF-SHA-256 scoped by segment `contentId` and purpose, with derivation parameters and shared vectors frozen in the format specification.

- [x] 首期播放器作为仓库内可独立构建和版本化的 `player/` package；是否发布到 npm/CDN 在打包稳定后决定。
- [x] The first-release player is an independently buildable and versioned `player/` package in the repository; npm/CDN publication is decided after packaging stabilizes.

- [x] 本期每个视频资产使用一个恒定 `keyId`/主密钥；同一视频的所有 rendition、分片与重复播放保持不变，不做自动或周期性密钥轮换。HLS 媒体序号不得用作视频密钥身份。
- [x] This release uses one stable `keyId`/master key per video asset; every rendition, segment, and replay of that video keeps it unchanged, with no automatic or periodic key rotation. HLS media sequence numbers are never video-key identities.

本期不实现密钥轮换：同一视频资产的所有 rendition、分片和重复 seek 均使用同一 `keyId` 与主密钥；不同视频资产必须可映射到不同密钥。当前 `KeyRequest` 按分片调用 provider，因此实现必须保证 provider 对同一视频资产稳定返回相同 keyId/密钥，并避免将 HLS 序号用作视频密钥身份。
Key rotation is out of scope for this release: every rendition, segment, and repeated seek for one video asset uses the same `keyId` and master key, while different video assets must be mappable to different keys. Since the current `KeyRequest` invokes the provider per segment, the implementation must ensure the provider returns the same keyId/key for the same video asset and must not treat HLS sequence numbers as video-key identity.

自动 ABR、视频级固定密钥、RustFS/CDN 与桌面浏览器可依据本 SDD 开发和验收；移动真机兼容性明确推迟到上线后，密钥轮换明确不属于本期范围。Demo/旧原型记录只作为背景证据，不能替代正式播放器和 PHP 产物的验收。
Automatic ABR, stable per-video keys, RustFS/CDN, and desktop browsers can be implemented and accepted against this SDD; physical mobile-device compatibility is explicitly deferred until after launch, and key rotation is explicitly out of scope for this release. Demo/older prototype results are background evidence only and cannot replace acceptance of the packaged player and PHP artifacts.

- [x] 自定义 CTR/HMAC 是必须集成的可选应用级加密 profile，播放要求使用兼容播放器；不宣称标准 HLS 加密或 DRM，CBCS/DRM 继续由独立 SDD 管理。
- [x] Custom CTR/HMAC is an optional application-level encryption profile that must be integrated and requires a compatible player; it is not claimed as standard HLS encryption or DRM, and CBCS/DRM remains governed by a separate SDD.

- [x] 弱网验收固定使用 2 秒目标分片与 64 KiB 最大明文记录；续传最多尝试 3 次并从完整记录边界恢复，首帧延迟只测量、不设门槛。生产分片时长可由输出配置覆盖，但实际时长必须写入报告。
- [x] Weak-network acceptance uses a 2-second target segment and a 64 KiB maximum clear record; resume is attempted at most 3 times from complete record boundaries, and first-frame latency is measured without a release threshold. Production segment duration may be overridden by output configuration, but actual durations must be reported.

- [x] 多输出发布采用事务语义：先写入同一文件系统内的任务暂存目录，全部 rendition、分片、sidecar 和清单验证通过后，以目录 rename 发布新的不可变版本；需要替换当前版本时，再原子更新小型版本指针/manifest。失败时清理暂存产物并保留此前成功版本，诊断信息写入报告，不默认留下媒体明文或密文副本。
- [x] Multi-output publication is transactional: write to a job staging directory on the same filesystem, then publish a new immutable version with a directory rename only after every rendition, segment, sidecar, and playlist passes validation; when replacing the current version, atomically update a small version pointer/manifest. On failure, remove staged artifacts and preserve the previous successful version, recording diagnostics in the report without retaining media cleartext or ciphertext by default.

## 13. 参考与验证依据
## 13. References and validation evidence

正式播放器的 H.264 加密 ABR 记录在 `experiments/php-ffmpeg/reports/h264-abr-auto-macos-official-player.json` 与 `h264-abr-auto-final-regression.json`；HEVC 720p 解密播放记录在 `hevc-720p-macos-chrome-ctr-hmac.json`。隔离 Demo 的 `experiments/hls-ctr-progressive-demo/capability-validation-report.json` 仅作为早期原型背景，不能替代正式播放器证据。
Official-player H.264 encrypted ABR is recorded in `experiments/php-ffmpeg/reports/h264-abr-auto-macos-official-player.json` and `h264-abr-auto-final-regression.json`; HEVC 720p decryption and playback is recorded in `hevc-720p-macos-chrome-ctr-hmac.json`. The isolated Demo's `experiments/hls-ctr-progressive-demo/capability-validation-report.json` is historical prototype context only and does not replace evidence from the packaged player.

当前 Dedicated Worker + MSE 的单对象渐进式实验及其与 hls.js 多 `moof` 时间线限制的对比记录在[技术验证 SDD TV-9](SDD-20261004-hls-technical-validation.md)中；本 SDD 的播放器首期应优先沿用经验证的 hls.js 多分片路径，不把单对象原型误写为完整 HLS 播放器。
The single-object progressive Dedicated Worker + MSE experiment and its comparison with the hls.js multi-`moof` timeline limitation are recorded in [technical validation SDD TV-9](SDD-20261004-hls-technical-validation.md); the first player release in this SDD should prefer the verified hls.js multi-segment path and must not describe the single-object prototype as a complete HLS player.

本 SDD 只定义实现方案和验收门槛；只有相应代码、Docker 端到端验证、密钥外部注入验证和平台测试完成后，相关能力才能从 Draft/Planned 转为 Supported。
This SDD defines an implementation plan and acceptance gates only; these capabilities may move from Draft/Planned to Supported only after the corresponding code, Docker end-to-end checks, external-key injection checks, and platform tests are complete.
