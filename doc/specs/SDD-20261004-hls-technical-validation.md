# SDD：HLS 技术验证计划
# SDD: HLS technical validation plan

> 状态：Implementing
> Status: Implementing
> 创建日期：2026-10-04
> Created: 2026-10-04
> 负责人：项目维护者
> Owner: Project maintainers
> 关联 SDD：[HLS 输出与输入支持](SDD-20261003-hls-support.md)、[HLS API 使用与参数设计](SDD-20261004-hls-api-usage-design.md)
> Related SDD: [HLS output and input support](SDD-20261003-hls-support.md), [HLS API usage and parameter design](SDD-20261004-hls-api-usage-design.md)

## 1. 背景与问题
## 1. Background and problem

HLS 主规格涵盖多码率视频、独立音频和字幕、加密与密钥轮换、TS/fMP4、媒体编排、输出模式及执行前预检；这些能力涉及 FFmpeg 版本和构建差异，也受目标播放器行为影响。
The HLS feature specification covers adaptive-bitrate video, separate audio and subtitles, encryption and key rotation, TS/fMP4, media orchestration, output modes, and preflight checks; these capabilities vary by FFmpeg version/build and are also affected by target-player behavior.

本轮在 FFmpeg 9 Docker 服务中补充验证了独立音频/字幕组、密钥轮换、URL 密钥材料来源及变换滤镜；加密 fMP4 明确失败，字幕分片保持明文。
This run added validation of separate audio/subtitle groups, key rotation, URL key-material sources, and transform filters in the FFmpeg 9 Docker service; encrypted fMP4 explicitly failed, and subtitle segments remained cleartext.

如果在这些不确定项解决前确定公开 API 和首期支持承诺，后续可能需要改动配置模型、输出布局或兼容性语义。
Defining the public API and first-release support commitments before resolving these uncertainties may require later changes to the configuration model, output layout, or compatibility semantics.

本规格定义一组有边界、可重复的技术验证；它的结论用于修订 HLS 主规格，不代表已经批准或实现 HLS API。
This specification defines a bounded, repeatable set of technical validations; its conclusions will inform revisions to the main HLS specification and do not mean that an HLS API has been approved or implemented.

## 2. 目标与范围
## 2. Goals and scope

### 目标
### Goals

- 验证首期候选功能在选定的 FFmpeg 构建上能否生成结构正确、可探测的 HLS 产物。
- Verify whether first-release candidate features produce structurally correct, probeable HLS artifacts with the selected FFmpeg builds.
- 用实验区分 FFmpeg 能生成的内容、本库能够可靠编排的内容，以及已在目标播放器验证的内容。
- Use experiments to distinguish what FFmpeg can generate, what this library can orchestrate reliably, and what has been verified in target players.
- 为密钥来源、密钥轮换、字幕加密和分片格式形成明确的支持建议、限制及后续问题。
- Produce explicit support recommendations, limitations, and follow-up questions for key sources, key rotation, subtitle encryption, and segment formats.
- 验证不依赖 FairPlay/Widevine 的自定义 AES-CTR 加密 fMP4 HLS Web 播放路径，并比较 Dedicated Web Worker、Service Worker 和主线程解密的职责与兼容性。
- Validate a custom AES-CTR encrypted fMP4 HLS web playback path that does not depend on FairPlay/Widevine, and compare the roles and compatibility of Dedicated Web Workers, Service Workers, and main-thread decryption.
- 把命令、输入、版本、产物和结论保存在可复查的验证记录中，供实现者和上游评审者复现。
- Keep commands, inputs, versions, artifacts, and conclusions in reviewable validation records so implementers and upstream reviewers can reproduce them.

### 不在本次范围
### Out of scope

- 不在本规格中实现或确定最终公开 API、类名、配置字段或命令行接口。
- Implementing or finalizing public APIs, class names, configuration fields, or command-line interfaces is out of scope.
- 不部署播放器、CDN、生产密钥服务、认证服务或远程存储后端。
- Deploying players, CDNs, production key services, authentication services, or remote storage backends is out of scope.
- 不把 FFprobe 成功探测当作目标播放器兼容性证明。
- Successful FFprobe probing is not accepted as proof of target-player compatibility.
- 不把自定义 CTR 清单约定称为标准 HLS 加密，也不承诺原生 HLS 播放器、iOS Safari 或 Android 原生播放器无需适配即可播放。
- Do not describe the custom CTR playlist convention as standard HLS encryption, or claim that native HLS players, iOS Safari, or Android native players can play it without adaptation.
- 不进行长视频、4K 全片或性能基准测试；性能测量仅记录短样片验证中影响设计的明显成本。
- Long-form, full-length 4K, and performance benchmark testing are out of scope; only obvious costs that affect design will be recorded during short-sample validation.
- 不在仓库中提交测试视频、密钥字节、生成分片或临时脚本。
- Test videos, key bytes, generated segments, and temporary scripts must not be committed to the repository.

## 3. 用户场景
## 3. User scenarios

维护者在设计 HLS 编排 API 前，先用 Docker 中的 FFmpeg 和短样片验证关键组合，并根据结果决定首期支持矩阵和已知限制。
Before designing the HLS orchestration API, maintainers use FFmpeg in Docker and short samples to verify critical combinations, then use the results to decide the first-release support matrix and known limitations.

实现者能够按本文档复现成功与失败用例，并知道某项结果属于工具能力、库行为还是播放器兼容性结论。
Implementers can reproduce successful and failing cases in this document and identify whether a result concerns tool capability, library behavior, or player compatibility.

## 4. 需求与预期行为
## 4. Requirements and expected behavior

- **REQ-1：** 每个验证用例必须记录日期、宿主架构、Docker 服务/镜像、FFmpeg 与 FFprobe 完整版本、`-buildconf` 摘要、输入文件特征、完整命令、退出码和产物位置。
- **REQ-1:** Every validation case must record the date, host architecture, Docker service/image, full FFmpeg and FFprobe versions, a `-buildconf` summary, input characteristics, complete command, exit code, and artifact location.
- **REQ-2：** 所有本地实验必须通过 Docker 执行；源样片以只读方式挂载，生成物写入仓库外的隔离目录。
- **REQ-2:** All local experiments must run through Docker; source samples must be mounted read-only, and generated artifacts must be written to an isolated directory outside the repository.
- **REQ-3：** 静态探测成功、FFmpeg 生成成功、FFprobe 解析成功和目标播放器播放成功必须作为不同结果记录。
- **REQ-3:** Successful static probing, FFmpeg generation, FFprobe parsing, and target-player playback must be recorded as distinct outcomes.
- **REQ-4：** 每个失败用例必须保留底层 FFmpeg/FFprobe 错误、失败阶段、是否生成部分产物，以及是否可安全重试。
- **REQ-4:** Every failed case must retain the underlying FFmpeg/FFprobe error, failure stage, whether partial artifacts were created, and whether a safe retry is possible.
- **REQ-5：** 验证不得静默降低编码格式、加密方法或轨道配置来获得成功；任何替代设置必须另列为不同用例。
- **REQ-5:** Validation must not silently downgrade codecs, encryption methods, or rendition settings to obtain success; any alternative settings must be recorded as separate cases.
- **REQ-6：** 结果应标记为“通过”“失败”“部分通过”或“未知”，并给出证据和适用范围；不能以一次本机成功结果推导普遍兼容。
- **REQ-6:** Results must be marked “pass,” “fail,” “partial,” or “unknown,” with evidence and scope; one successful local run must not be generalized into universal compatibility.
- **REQ-7：** 需播放器参与的兼容性结论，必须记录播放器名称/版本、操作系统/设备、播放路径和观察到的结果。
- **REQ-7:** Compatibility findings involving players must record the player name/version, operating system/device, playback path, and observed result.
- **REQ-8：** 实验记录不得包含真实凭据或生产密钥；密钥轮换只使用专门生成的测试密钥。
- **REQ-8:** Experiment records must not contain real credentials or production keys; key-rotation tests must use dedicated test keys.

### 验证工作流
### Validation workstreams

#### TV-0：基线与工具能力
#### TV-0: Baseline and tool capabilities

- 在 `php` 和 `php-ffmpeg9` 两个 Compose 服务中分别记录 `ffmpeg -version`、`ffprobe -version` 和 `ffmpeg -buildconf`。
- Record `ffmpeg -version`, `ffprobe -version`, and `ffmpeg -buildconf` in both Compose services: `php` and `php-ffmpeg9`.
- 记录 HLS muxer、`libx264`/`libx265`/AAC 编码器、WebVTT 编码器/封装能力，以及 `file`、`http`、`https` 等协议能力。
- Record HLS muxer, `libx264`/`libx265`/AAC encoder, WebVTT encoder/muxing capabilities, and protocol capabilities such as `file`, `http`, and `https`.
- 对比两个服务的差异，并检查当前能力探测输出是否足以让预检准确识别缺失项。
- Compare the two services and check whether current capability-query output is sufficient for preflight to identify missing capabilities accurately.
- **预期：** FFmpeg 9 服务版本和构建选项固定且可复现；默认服务反映 Debian 提供的版本；能力清单能解释具体组合是否可尝试，但不能单独证明可播放。
- **Expected:** The FFmpeg 9 service has a pinned, reproducible version and build configuration; the default service reflects the Debian-provided version; capability listings explain whether a combination can be attempted but do not prove playability.

#### TV-1：多码率视频、主播放列表与文件布局
#### TV-1: Multi-rendition video, master playlist, and file layout

- 使用 `/Users/macbookpro/Devs/samples/26.mp4` 制作不超过 8 秒的只读源样片；保留原始尺寸、帧率、编码和时长的探测结果。
- Make a source sample of no more than 8 seconds from `/Users/macbookpro/Devs/samples/26.mp4`, keeping the probe results for source dimensions, frame rate, codec, and duration.
- 用 FFmpeg 9 从同一次输入处理生成 480p、720p 和 1080p H.264 变体、主播放列表及 MPEG-TS 分片；使用独立变体目录和稳定命名模板。
- Use FFmpeg 9 to generate 480p, 720p, and 1080p H.264 variants, a master playlist, and MPEG-TS segments from one input operation, using per-variant directories and a stable naming template.
- 从主样片额外生成一个低于 480p 的控制输入，分别验证跳过不适用变体和配置策略拒绝两种方案的可行性，不预先替维护者选定产品策略。
- Create an additional control input below 480p and assess both skipping inapplicable variants and rejecting the configuration as possible policies, without choosing a product policy for maintainers in advance.
- 检查主播放列表中每个 URI 均存在且相对路径正确；检查变体分辨率、编解码器、码率元数据、分片时长、结束标签和关键帧边界。
- Check that every URI in the master playlist exists and resolves correctly as a relative path; inspect variant resolution, codec, bitrate metadata, segment duration, end tags, and keyframe boundaries.
- 逐个使用 FFprobe 读取媒体播放列表和解密后的分片；再用一条故意错误的路径模板验证链接检查能发现布局错误。
- Use FFprobe to read each media playlist and decrypted segment; then use one deliberately incorrect path template to verify that the link checks detect layout errors.
- **预期：** 三档流与所有 URI 可解析；低于目标尺寸的输入不得被静默放大；主播放列表声明必须与实际探测结果一致。
- **Expected:** All three renditions and their URIs are resolvable; inputs smaller than a target rendition are not silently upscaled; master-playlist declarations match the probed outputs.

#### TV-2：独立音频、字幕与元数据映射
#### TV-2: Separate audio, subtitles, and metadata mapping

- 为无音轨的样片准备独立 AAC 测试音频和外部 SRT 字幕；另用包含音频的短素材验证从源文件映射音轨的路径。
- Prepare a separate AAC test track and external SRT subtitle for the video-only sample; use a second short asset with audio to verify mapping an audio track from the source file.
- 生成一组视频变体、至少一个独立音频媒体播放列表和一个 WebVTT 字幕媒体播放列表，并在主播放列表中声明组关联。
- Generate video variants, at least one separate audio media playlist, and one WebVTT subtitle media playlist, declaring the rendition-group associations in the master playlist.
- 分别设置语言、名称、默认/自动选择属性；验证 FFmpeg 9 接受的变体映射字段，并确认名称和语言实际出现在正确的 `EXT-X-MEDIA` 条目中。
- Set language, display name, default, and autoselect attributes separately; verify which variant-map fields FFmpeg 9 accepts and confirm that names and languages appear in the correct `EXT-X-MEDIA` entries.
- 用 FFprobe 验证音频和字幕播放列表、媒体格式、时长与 URI；使用实际字幕内容确认字幕分片不是空文件或错误转码。
- Use FFprobe to verify audio and subtitle playlists, media formats, duration, and URIs; use actual subtitle content to confirm that subtitle segments are neither empty nor incorrectly converted.
- **预期：** 主播放列表中的音频/字幕组引用全部存在，语言和名称映射稳定；若 FFmpeg 对某项元数据支持不足，记录由库后处理清单的可行性和成本。
- **Expected:** All audio/subtitle group references in the master playlist resolve, and language/name mapping is stable; if FFmpeg lacks a metadata feature, record the feasibility and cost of having the library post-process the playlist.

#### TV-3：加密覆盖、分片类型和编码组合
#### TV-3: Encryption coverage, segment types, and codec combinations

- 以每个组合独立目录测试 H.264 + MPEG-TS + AES-128、H.264 + fMP4 + AES-128、H.265 + MPEG-TS + AES-128，以及 H.265 + fMP4 + AES-128。
- Test H.264 + MPEG-TS + AES-128, H.264 + fMP4 + AES-128, H.265 + MPEG-TS + AES-128, and H.265 + fMP4 + AES-128 in separate output directories.
- 每个组合都先检查 FFmpeg 退出码与分片产物，再检查媒体播放列表的 `EXT-X-KEY`、`EXT-X-MAP`（适用时）、协议版本、密钥 URI 和分片实际格式。
- For each combination, first inspect the FFmpeg exit code and segment artifacts, then inspect `EXT-X-KEY`, `EXT-X-MAP` when applicable, protocol version, key URI, and actual segment format in the media playlist.
- 使用仅供测试的 16 字节密钥和允许所需本地扩展名的 FFprobe 参数读取媒体播放列表；检查所有加密分片能被正确解密和探测。
- Use a test-only 16-byte key and FFprobe options that allow the required local extension to read each media playlist; verify that all encrypted segments decrypt and probe correctly.
- 额外生成未加密控制组，确认检测能区分加密成功、未加密输出和加密声明存在但密钥/分片无法读取。
- Generate an unencrypted control case to ensure checks distinguish successful encryption, unencrypted output, and a playlist with an encryption declaration whose key/segments cannot be read.
- 对 WebVTT 字幕分片逐项检查是否加密、播放列表是否声明对应密钥，以及 FFprobe/候选播放器能否读取；不得假设 TS 音视频的加密设置会自动覆盖字幕。
- Inspect each WebVTT subtitle segment for encryption, verify whether its playlist declares the corresponding key, and test whether FFprobe/candidate players can read it; do not assume that TS audio/video encryption automatically covers subtitles.
- **预期：** H.264 + TS + AES-128 是已初步验证组合；HEVC/H.265 的目标 HLS 配置必须使用 fMP4（初始化段加媒体片段），HEVC + TS 即使能由 FFmpeg 生成并被 FFprobe 探测，也判定为配置不兼容。原生 muxer 的加密 fMP4 在本构建明确失败，字幕加密尚无实现路径。只有产物结构、解密读取及目标播放器验证分别通过后，才能纳入相应支持承诺。
- **Expected:** H.264 + TS + AES-128 is an initially verified combination; the target HLS profile requires fMP4 (an initialization section plus media fragments) for HEVC/H.265, so HEVC + TS is incompatible even if FFmpeg generates it and FFprobe can probe it. Encrypted fMP4 explicitly fails on this build's native muxer, and no subtitle-encryption path has been established. Add a combination to the support commitment only after its artifact structure, decryption/probing, and target-player checks each pass.

#### TV-4：密钥材料来源、播放器密钥 URI 与轮换
#### TV-4: Key material sources, player key URIs, and rotation

- 将“FFmpeg 用于加密的密钥材料位置”与“写入 M3U8、播放器获取密钥的 URI”作为两个独立输入验证；首先使用本地密钥文件和 HTTP 测试服务器提供的播放器密钥 URI。
- Verify “where FFmpeg reads encryption key material” and “the URI written to M3U8 for player key retrieval” as separate inputs; begin with a local key file and a player key URI served by a local HTTP test server.
- 另测把受控 HTTP(S) URL 作为 FFmpeg key-info 文件第二行密钥材料路径的行为；记录各协议是否被构建支持、身份验证方式、超时行为及失败诊断。
- Separately test using a controlled HTTP(S) URL as the key-material path on the second line of the FFmpeg key-info file; record supported protocols, authentication behavior, timeouts, and failure diagnostics.
- 不将凭据放入命令参数或可记录 URI；通过测试服务器请求日志和容器日志检查凭据是否泄漏，并记录实际发起请求的一方。
- Do not place credentials in command arguments or loggable URIs; inspect test-server request logs and container logs for credential leakage, and record which component made each request.
- 使用 FFmpeg HLS `periodic_rekey` 做短时轮换实验：先生成并使用 K1，再创建独立的 K2 文件，并通过原子替换 key-info 文件切换到 K2。
- Run a short rotation experiment with the FFmpeg HLS `periodic_rekey` flag: begin with K1, create a separate K2 file, and switch to K2 by atomically replacing the key-info file.
- 为轮换前后分别使用可区分且播放器可访问的 key URI（例如 `test-key-v1.key` 与 `test-key-v2.key`），并预先保留两份对应密钥文件供播放端解密旧分片。
- Use distinct, player-accessible key URIs before and after rotation (for example, `test-key-v1.key` and `test-key-v2.key`), and retain both corresponding key files so the player can decrypt older segments.
- 轮换前后各生成至少两个分片；检查播放列表在正确分片边界更新 `EXT-X-KEY`/URI，并用 K1、K2 分别解密其对应分片。
- Generate at least two segments before and after rotation; verify that the playlist updates `EXT-X-KEY`/URI at the correct segment boundary and that the corresponding segments decrypt with K1 and K2 respectively.
- **预期：** 明确区分静态单密钥和 VOD 过程中轮换；若轮换依赖外部进程修改 key-info 文件，记录同步、原子替换、失败恢复和播放端获取旧/新密钥的责任边界。
- **Expected:** Clearly distinguish a static single key from rotation during VOD generation; if rotation depends on an external process updating the key-info file, document ownership for synchronization, atomic replacement, failure recovery, and player access to old/new keys.

#### TV-5：有序编排步骤与多输出目标
#### TV-5: Ordered workflow steps and multiple output targets

- 用短样片构造输入映射和顺序步骤：选择视频流、裁剪、旋转/转置、缩放，再输出多档 HLS；记录每个步骤实际使用的 FFmpeg 输入选项、滤镜和映射。
- Build an input mapping and ordered steps from a short sample: select a video stream, trim, rotate/transpose, scale, then output multi-rendition HLS; record the FFmpeg input options, filters, and mappings used at each step.
- 对照 FFprobe 的时长、画面尺寸、旋转方向、音视频轨道和每个输出目标的播放列表，确认步骤顺序会产生预期结果。
- Compare FFprobe duration, dimensions, orientation, audio/video tracks, and each target playlist to confirm that step order produces the expected result.
- 测试两个独立输出目标、目标目录冲突、重复分片名、缺失步骤引用和中途失败；记录 FFmpeg 是否启动、失败后留下哪些部分文件，以及是否需要暂存目录/原子发布。
- Test two independent output targets, destination conflicts, duplicate segment names, missing step references, and mid-run failure; record whether FFmpeg starts, which partial files remain after failure, and whether staging/atomic publication is needed.
- **预期：** 有序步骤可用明确的输入/输出映射表示；验证能在启动 FFmpeg 前发现纯配置错误；失败清理和多目标发布语义可据实验结果定案。
- **Expected:** Ordered steps can be represented with explicit input/output mappings; validation can detect configuration-only errors before FFmpeg starts; cleanup and multi-target publication semantics can be decided from experimental evidence.

#### TV-6：媒体播放列表、JSON 表示与预检检查组
#### TV-6: Media playlists, JSON representation, and preflight check groups

- 分别生成主播放列表和单个媒体播放列表模式；确认前者引用完整轨道集合，后者只描述指定轨道且不会冒充主播放列表。
- Generate master-playlist and single-media-playlist modes separately; verify that the former references the complete rendition set and the latter describes only the selected rendition without masquerading as a master playlist.
- 准备含未知标签、带引号/逗号的属性、相对 URI、顺序敏感标签和多媒体组的 M3U8 样例；评估解析成 JSON 时能否无损保留原始信息及版本字段。
- Prepare M3U8 cases with unknown tags, quoted/comma-containing attributes, relative URIs, order-sensitive tags, and multiple rendition groups; assess whether JSON conversion can preserve source information and version fields without loss.
- 按输入/步骤、工具能力、输出路径、加密配置、目标兼容性分组执行预检；为每组准备一个通过项、一个阻断项和一个无法判断项。
- Run preflight by input/step, tool capability, output path, encryption configuration, and target compatibility groups; prepare one passing, one blocking, and one indeterminate case for each group.
- 确认预检默认不执行完整转码；另行触发显式的短样片编码/解码检查，并将耗时检查与静态结果分开报告。
- Confirm that preflight does not perform a full transcode by default; trigger a short sample encode/decode check separately and report this time-consuming check apart from static findings.
- **预期：** JSON 能保留原始 M3U8 的顺序和未知信息，或规格明确采用有损字段模式；预检结果能区分错误、警告、信息和未知，且未知有原因。
- **Expected:** JSON either preserves M3U8 ordering and unknown information or the specification explicitly adopts a lossy field model; preflight distinguishes errors, warnings, information, and unknown results, with a reason for unknowns.

#### TV-7：目标播放器兼容性
#### TV-7: Target-player compatibility

- 在开始播放器测试前，由维护者确定首期目标播放器、版本/操作系统组合和支持优先级；未选定目标时本工作流保持“未执行”。
- Before player testing, maintainers must select first-release target players, version/operating-system combinations, and support priorities; this workstream remains “not run” until targets are selected.
- 对选定组合播放加密 TS、候选加密 fMP4、H.264/H.265、独立 AAC、WebVTT 字幕和轮换密钥样例；分别观察首帧、切档、音轨/字幕切换、seek 和密钥切换。
- For selected combinations, play encrypted TS, candidate encrypted fMP4, H.264/H.265, separate AAC, WebVTT subtitles, and rotating-key samples; observe startup, rendition switching, audio/subtitle switching, seeking, and key transitions separately.
- **预期：** 只把在已命名设备/播放器组合中通过的项目记为已验证；其他组合标记为未知或需目标方确认，不推断普遍浏览器/设备兼容性。
- **Expected:** Mark a capability as verified only for the named device/player combinations that pass; mark other combinations unknown or requiring target-owner confirmation, and do not infer universal browser/device compatibility.

#### TV-8：FFmpeg 编码 + Shaka Packager CBCS HLS
#### TV-8: FFmpeg encoding + Shaka Packager CBCS HLS

- 在独立 Docker 服务中加入固定版本的 Shaka Packager；FFmpeg 负责解码、滤镜和 HEVC 编码，输出关键帧对齐的中间 MP4；Shaka Packager 负责 fMP4 分片、HLS 清单和 `cbcs` sample 加密。
- Add a pinned Shaka Packager version in a separate Docker service; FFmpeg handles decoding, filters, and HEVC encoding into keyframe-aligned intermediate MP4 files, while Shaka Packager creates fMP4 fragments, HLS playlists, and `cbcs` sample encryption.
- 使用不超过 8 秒的测试片段和测试专用密钥生成一个 HEVC 变体的加密 HLS；再验证多分辨率视频、独立 AAC、WebVTT 字幕和主播放列表组合。
- Use a test-only key to package an encrypted HLS output with one HEVC rendition from a clip no longer than 8 seconds; then validate multiple video resolutions, separate AAC, WebVTT subtitles, and a master playlist.
- 检查清单 `EXT-X-KEY` 的 METHOD/KEYFORMAT/URI、初始化段、`.m4s` 片段、CENC `cbcs` 标记、时间戳和关键帧边界；用独立解析工具检查加密标记及 KID，并用测试密钥验证可解密还原媒体 sample。
- Inspect `EXT-X-KEY` METHOD/KEYFORMAT/URI, initialization sections, `.m4s` fragments, CENC `cbcs` markers, timestamps, and keyframe boundaries; use an independent parser to inspect encryption markers and KID, and verify that media samples can be decrypted with the test key.
- 浏览器播放验证作为独立兼容性记录：检查客户端是否先由 DRM/CDM 解密，再能否将 HEVC sample 交给原生解码器或调用方插件；这项结果不作为产物生成的阻断条件。
- Record browser playback as a separate compatibility result: determine whether the client decrypts through DRM/CDM and can then pass HEVC samples to a native decoder or caller-provided plugin; this result does not block artifact generation.
- 对比编码前后的分辨率、帧率、码流、音画时长、字幕 URI 和主清单属性；将目标客户端解密/播放结果单独记录，不与封装产物正确性混为同一结论。
- Compare resolution, frame rate, bitstream, audio/video duration, subtitle URIs, and master-playlist attributes; any artifact that the target client cannot decrypt and play counts as a failure.
- 记录 Docker 镜像来源、固定版本/摘要、许可证、架构支持、资源消耗、输入容器限制及安全更新流程；生产密钥不得通过可见命令行参数传入，需验证受保护密钥 provider 或 CPIX/密钥服务集成。
- Record Docker image source, pinned version/digest, license, architecture support, resource use, input-container limits, and security-update process; production keys must not be passed as visible command-line arguments, and integration with a protected key provider or CPIX/key service must be validated.
- **预期：** 若结构检查、CBCS 信令和测试密钥解密检查通过，采用双阶段流水线作为首选候选：FFmpeg 生成编码后的中间 MP4，Shaka Packager 生成并加密 HLS fMP4。播放器/插件兼容性单独记录；若打包验证失败，评估 Bento4 或自研 packager adapter，不回退到 HEVC+TS。
- **Expected:** If structure checks, CBCS signaling, and decryption with the test key pass, use a two-stage pipeline as the preferred candidate: FFmpeg creates encoded intermediate MP4 files, and Shaka Packager creates and encrypts HLS fMP4. Record player/plugin compatibility separately; if packaging validation fails, evaluate Bento4 or a custom packager adapter, without falling back to HEVC+TS.

## 4.1 本轮实验结果
## 4.1 Results from this validation run

本轮实验日期为 2026-10-04，均通过仓库 `php-ffmpeg9` Compose 服务执行；输入样片和产物位于 `/private/tmp/php-ffmpeg/technical-validation-20261004-run2/`，未写入仓库。
This run took place on 2026-10-04, entirely through the repository's `php-ffmpeg9` Compose service; the sample and artifacts are under `/private/tmp/php-ffmpeg/technical-validation-20261004-run2/` and were not written into the repository.

TV-0：FFmpeg/FFprobe 9.0.2 的版本、构建配置、HLS muxer、编码器和协议清单已保存到 `TV0/`；`libx264`、`libx265`、AAC、WebVTT 及 HTTP 相关能力可供静态预检查询。
TV-0: FFmpeg/FFprobe 9.0.2 version, build configuration, HLS muxer, encoder, and protocol listings are saved under `TV0/`; `libx264`, `libx265`, AAC, WebVTT, and HTTP-related capabilities are available for static preflight queries.

TV-1：复用了先前的 H.264 480p/720p/1080p 加密 TS 多变体实验；本轮没有重跑低于 480p 的策略、错误路径模板或完整 URI 清点，因此这些子项仍为未知。
TV-1: The earlier H.264 480p/720p/1080p encrypted TS multi-rendition experiment was reused; this run did not repeat the below-480p policy, incorrect path-template, or complete URI audit, so those subcases remain unknown.

TV-2：FFmpeg 9.0.2 成功将视频、独立 AAC 音频和外部 SRT 转为带组关联的 master、TS 音视频媒体播放列表和 WebVTT 播放列表；FFprobe 能读取加密视频/音频以及 WebVTT 清单。
TV-2: FFmpeg 9.0.2 successfully generated a master with group associations, TS video/audio media playlists, and a WebVTT playlist from video, separate AAC audio, and external SRT; FFprobe read the encrypted video/audio and WebVTT playlists.

TV-2：音频 `name` 变体字段没有控制 master 中的 `NAME`，实际输出为 `audio_1`；字幕 `sname` 可生成 `EnglishSubtitles`。音频 `LANGUAGE=eng` 正常写入，字幕语言尚未验证。
TV-2: The audio `name` variant-map field did not control `NAME` in the master, which was emitted as `audio_1`; subtitle `sname` produced `EnglishSubtitles`. Audio `LANGUAGE=eng` was written correctly; subtitle language remains unverified.

TV-2/TV-3：TS 音频和视频媒体清单包含 AES-128 `EXT-X-KEY`，但 WebVTT 清单与 `.vtt` 字幕分片未加密。FFmpeg HLS muxer 不会自动把 TS 加密覆盖到字幕；首期“所有媒体轨道均加密”的要求需要额外实现或重新界定字幕的交付安全要求。
TV-2/TV-3: TS audio and video playlists contain AES-128 `EXT-X-KEY`, while the WebVTT playlist and `.vtt` subtitle segments remain unencrypted. The FFmpeg HLS muxer does not automatically extend TS encryption to subtitles; the first-release requirement to encrypt every rendition needs additional implementation or a clarified subtitle-delivery security requirement.

TV-3：H.264+fMP4 与 H.265+fMP4 未加密控制输出均可生成并被 FFprobe 探测；H.264+fMP4+AES-128 在 FFmpeg 9.0.2 失败。根因已定位到 FFmpeg `libavformat/hlsenc.c`：`hls_start()` 检查到启用了 `key_info_file` 或 `encrypt` 且 `segment_type == SEGMENT_TYPE_FMP4` 时，直接记录 `Encrypted fmp4 not yet supported` 并返回 `AVERROR_PATCHWELCOME`。失败发生在写媒体头之前，与编码器、输入视频和 key-info 文件内容无关；重试或换 key URI 不会解决。此前 H.265+TS+AES-128 的“成功”仅表示命令生成了产物且 FFprobe 识别出 HEVC；按本项目目标 HLS 配置（Apple HEVC authoring profile），该组合不符合要求，应视为验证失败，不得作为支持证据。HEVC 输出必须使用 fMP4，因此首期若要求加密 HEVC，必须增加经验证的 fMP4 sample-encryption/打包路径；原生 HLS muxer 的 AES-128 TS 路径不能满足此项。
TV-3: Clear H.264+fMP4 and H.265+fMP4 control outputs were generated and probed by FFprobe; H.264+fMP4+AES-128 failed on FFmpeg 9.0.2. The root cause is in FFmpeg `libavformat/hlsenc.c`: when `hls_start()` sees `key_info_file` or `encrypt` enabled together with `segment_type == SEGMENT_TYPE_FMP4`, it logs `Encrypted fmp4 not yet supported` and returns `AVERROR_PATCHWELCOME` directly. This happens before the media header is written and is unrelated to the encoder, input video, or key-info contents; retrying or changing the key URI will not fix it. The earlier “success” for H.265+TS+AES-128 only means the command produced artifacts and FFprobe identified HEVC; it does not meet this project's target HLS profile (Apple's HEVC authoring profile) and must be recorded as a validation failure, not support evidence. HEVC output must use fMP4, so encrypted HEVC in the first release requires a validated fMP4 sample-encryption/packaging path; the native HLS muxer's AES-128 TS path cannot meet this requirement.

跨版本源码检查：同一拒绝分支存在于 FFmpeg 4.0、5.1、6.0、7.1、8.0、8.1、9.0 和当前 trunk 的 HLS muxer 源码；这些版本均不能通过原生 HLS muxer 生成 AES-128 加密 fMP4。代表性源码：[4.0](https://ffmpeg.org/doxygen/4.0/hlsenc_8c_source.html)、[5.1](https://www.ffmpeg.org/doxygen/5.1/hlsenc_8c_source.html)、[7.1](https://ffmpeg.org/doxygen/7.1/hlsenc_8c_source.html)、[8.1](https://ffmpeg.org/doxygen/8.1/hlsenc_8c_source.html)、[9.0](https://www.ffmpeg.org/doxygen/9.0/hlsenc_8c_source.html)、[trunk](https://ffmpeg.org/doxygen/trunk/hlsenc_8c_source.html)。
Cross-version source check: the same rejection branch is present in the HLS muxer source for FFmpeg 4.0, 5.1, 6.0, 7.1, 8.0, 8.1, 9.0, and current trunk; none of these versions can produce AES-128 encrypted fMP4 through the native HLS muxer. Representative sources: [4.0](https://ffmpeg.org/doxygen/4.0/hlsenc_8c_source.html), [5.1](https://www.ffmpeg.org/doxygen/5.1/hlsenc_8c_source.html), [7.1](https://ffmpeg.org/doxygen/7.1/hlsenc_8c_source.html), [8.1](https://ffmpeg.org/doxygen/8.1/hlsenc_8c_source.html), [9.0](https://www.ffmpeg.org/doxygen/9.0/hlsenc_8c_source.html), and [trunk](https://ffmpeg.org/doxygen/trunk/hlsenc_8c_source.html).

FFmpeg 3.4 的源码中没有这条显式拒绝分支，并在旧 HLS 写入路径中使用通用 `crypto:` 协议加密片段；也有用户报告称 3.4.6 生成过此类输出。但这只说明旧版本可能尝试整段 AES 加密；RFC 8216 规定 fMP4 媒体分片使用 Common Encryption 的 `cbcs` 方案，因此旧路径不能据此认定为符合标准或可与目标播放器互通。本项目没有在 Docker 中实测 3.4，不把它列为受支持的替代版本。[FFmpeg 3.4 `hlsenc.c`](https://ffmpeg.org/doxygen/3.4/hlsenc_8c_source.html)、[FFmpeg 用户报告](https://www.reddit.com/r/ffmpeg/comments/fbys84/)、[RFC 8216 §4.3.2.4](https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.2.4)。
FFmpeg 3.4 source lacks this explicit rejection branch and uses the generic `crypto:` protocol to encrypt segments in its older HLS write path; a user also reported that 3.4.6 generated such output. This only indicates that the old version may have attempted whole-segment AES encryption; RFC 8216 specifies the Common Encryption `cbcs` scheme for fMP4 media segments, so the old path cannot be assumed to be standards-compliant or interoperable with target players. This project has not tested 3.4 in Docker and does not list it as a supported alternative. [FFmpeg 3.4 `hlsenc.c`](https://ffmpeg.org/doxygen/3.4/hlsenc_8c_source.html), [user report](https://www.reddit.com/r/ffmpeg/comments/fbys84/), [RFC 8216 §4.3.2.4](https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.2.4).

标准与实现的区别：RFC 8216 明确支持 fMP4 HLS 加密，使用 `SAMPLE-AES` 和 Common Encryption `cbcs`；因此 H.265 + 加密 fMP4 是有效需求。FFmpeg 的 HLS AES-128 路径是整段加密实现，不等同于 fMP4 所需的 sample-level CBCS。FFmpeg 9 的 MOV muxer 文档列出的加密方案只有 `cenc-aes-ctr`，没有 `cbcs`；加上 HLS muxer 的拒绝分支，不能通过简单增加 HLS 参数得到符合该标准的加密 fMP4。
Standards versus implementation: RFC 8216 explicitly supports encrypted fMP4 HLS using `SAMPLE-AES` and Common Encryption `cbcs`, so H.265 plus encrypted fMP4 is a valid requirement. FFmpeg's HLS AES-128 path encrypts whole segments and is not the sample-level CBCS required for fMP4. FFmpeg 9's MOV muxer documentation lists only `cenc-aes-ctr`, not `cbcs`; together with the HLS muxer's rejection branch, this means a simple HLS option cannot produce standard-compliant encrypted fMP4. [RFC 8216](https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.2.4), [FFmpeg MOV muxer options](https://ffmpeg.org/ffmpeg-formats.html#Options-26).

历史原因的证据显示，FFmpeg Trac #7138 于 2018-04-13 报告“fMP4 加密 HLS 产生段错误”；2018-04-16 开发邮件的补丁主题为“为 fMP4 加密模式添加错误消息”，随后源码通过明确拒绝取代潜在崩溃。根据问题与补丁时间及当前保护分支推断，这更像是对未实现/会崩溃路径的安全拒绝，而不是 FFmpeg 判定 HLS 标准不允许 fMP4 加密；公开记录没有证明后续完成过 CBCS 输出实现。
Historical evidence shows that FFmpeg Trac #7138 reported a segmentation fault when generating encrypted fMP4 HLS on 2018-04-13; a 2018-04-16 development patch was titled “add error message for encrypt fmp4 mode,” after which the source explicitly rejected the combination instead of risking a crash. Based on the timing and current guard, this appears to be a defensive rejection of an incomplete/crashing path, not a decision that the HLS standard forbids fMP4 encryption; the public records do not show a later completed CBCS output implementation. [Trac #7138 report](https://www.mail-archive.com/ffmpeg-trac%40avcodec.org/msg43198.html), [FFmpeg-devel patch discussion](https://ffmpeg.org/pipermail/ffmpeg-devel/2018-April/228311.html).

该结论由 FFmpeg 9.0 源码中的明确条件分支交叉确认，参见 [FFmpeg 9.0 `hlsenc.c` 源码，行 1781–1784](https://www.ffmpeg.org/doxygen/9.0/hlsenc_8c_source.html)。
This conclusion is cross-checked against the explicit conditional branch in FFmpeg 9.0 source; see [FFmpeg 9.0 `hlsenc.c`, lines 1781–1784](https://www.ffmpeg.org/doxygen/9.0/hlsenc_8c_source.html).

已在 Docker 中复跑并保存完整日志：使用 8.04 秒 H.264 样片、`libx264`、`-hls_segment_type fmp4` 和有效的 16 字节密钥；日志显示 FFmpeg 打开/创建了 0 字节的 `init.mp4`，随即报告上述 muxer 错误，未生成媒体播放列表或分片。日志位于验证目录 `TV3-h264-fmp4/repro.log`。
The case was rerun in Docker and its full log saved: an 8.04-second H.264 sample, `libx264`, `-hls_segment_type fmp4`, and a valid 16-byte key were used; the log shows FFmpeg opening/creating a zero-byte `init.mp4`, then reporting the muxer error, without producing a media playlist or segments. The log is at `TV3-h264-fmp4/repro.log` in the validation directory.

以下 Docker 命令可复现失败；`keyinfo` 第一行是播放列表 URI，第二行指向容器内 16 字节测试密钥。
The following Docker command reproduces the failure; line one of `keyinfo` is the playlist URI, and line two points to the 16-byte test key inside the container.

```sh
docker compose --profile ffmpeg9 run --rm \
  -v /private/tmp/php-ffmpeg/technical-validation-20261004-run2:/validation \
  php-ffmpeg9 ffmpeg -hide_banner -y \
  -i /validation/fixtures/clip.mp4 -map 0:v:0 -an \
  -c:v libx264 -preset ultrafast -f hls -hls_time 2 \
  -hls_playlist_type vod -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 \
  -hls_key_info_file /validation/TV3-h264-fmp4/keyinfo \
  -hls_segment_filename /validation/TV3-h264-fmp4/segment_%03d.m4s \
  /validation/TV3-h264-fmp4/index.m3u8
```

TV-4：`periodic_rekey` 配合原子替换 key-info 在连续分片中切换了 K1/K2 URI，FFprobe 可读取整份轮换清单。该验证证明 muxer 能响应外部轮换者，不代表本库已具备密钥生成、轮换调度或密钥分发职责。
TV-4: `periodic_rekey` combined with atomic key-info replacement switched K1/K2 URIs across consecutive segments, and FFprobe read the full rotation playlist. This proves the muxer responds to an external rotator; it does not mean the library owns key generation, rotation scheduling, or key delivery.

TV-4：把 HTTP URL 用作 key-info 第二行密钥材料路径时，容器内 PHP 测试服务器收到 GET 请求且 FFmpeg 成功生成加密 TS；M3U8 中仍写入独立的播放器 key URI。仅验证了本地 HTTP，无 TLS、认证、超时和凭据脱敏结论。
TV-4: When an HTTP URL was used as the key-material path on line two of key-info, the PHP test server in the container received a GET and FFmpeg generated encrypted TS; the M3U8 still contained a separate player key URI. Only local HTTP was tested; TLS, authentication, timeouts, and credential redaction remain unknown.

TV-5：按 `transpose=clock` → `crop=400:700` → `scale=-2:360` 的声明顺序处理样片，输出由 FFprobe 确认为 H.264 206x360；同一容器还成功生成另一独立目录的 HLS 输出。该 CLI 实验验证了滤镜链顺序与独立目标可行性，未验证库级配置错误拦截、并行/原子发布或中途失败清理。
TV-5: Processing the sample in the declared order `transpose=clock` → `crop=400:700` → `scale=-2:360` produced H.264 206x360 as confirmed by FFprobe; the same container also generated a separate HLS output in another directory. This CLI experiment validates filter ordering and independent destinations, but not library-level rejection of invalid configuration, parallel/atomic publication, or cleanup after mid-run failure.

TV-6：本轮确认 FFmpeg 可输出 master 和 media playlist，但未实现或试验 M3U8 JSON 解析器，也未实现预检结果对象；这两项属于库级设计/实现验证，当前仍待定。
TV-6: This run confirmed that FFmpeg emits master and media playlists, but did not implement or test an M3U8-to-JSON parser or a preflight result object; both remain pending library design/implementation validation.

TV-7：未执行。尚无维护者选定的播放器/设备矩阵；所有当前结论均为 FFmpeg/FFprobe 工具级结果，不构成播放兼容承诺。
TV-7: Not run. Maintainers have not selected a player/device matrix; all current findings are at the FFmpeg/FFprobe tool level and do not constitute playback compatibility claims.

### 错误与边界情况
### Errors and edge cases

- 密钥丢失、密钥长度错误、key-info 文件更新中断、播放列表 URI 不存在、分片部分写入和不支持的编码器/封装器都必须作为独立失败场景记录。
- Missing keys, invalid key length, interrupted key-info replacement, missing playlist URIs, partially written segments, and unsupported encoders/muxers must each be recorded as distinct failure cases.
- 输入短于一个分片、无音轨、无字幕、旋转元数据存在、输入尺寸低于目标变体和变帧率都应纳入适用的用例。
- Cases applicable to short inputs, missing audio, missing subtitles, rotation metadata, source dimensions below a target rendition, and variable frame rate must be included.
- 本地 FFprobe 读取失败时，先区分本地协议/扩展名白名单限制与媒体文件损坏；不得因此扩大生产协议白名单。
- When local FFprobe reading fails, first distinguish local protocol/extension allow-list restrictions from damaged media; do not widen production protocol allow-lists as a workaround.
- 任何部分产物、密钥访问失败或无法解释的播放器行为都标为失败或未知，不以重试后偶然成功覆盖首次结果。
- Any partial artifacts, key-access failures, or unexplained player behavior must be marked failed or unknown; an occasional successful retry must not overwrite the first result.

## 5. API 与兼容性
## 5. API and compatibility

本规格不新增 PHP API、配置项或 CLI；验证使用 Docker Compose 和 FFmpeg/FFprobe 命令。
This specification adds no PHP API, configuration option, or CLI; validation uses Docker Compose and FFmpeg/FFprobe commands.

主要验证基线为仓库 `php-ffmpeg9` 服务中的 BtbN FFmpeg 9.0.2 静态构建；默认 Debian FFmpeg 服务用于识别旧版行为差异，不自动承诺完整跨版本支持。
The primary validation baseline is the BtbN FFmpeg 9.0.2 static build in the repository's `php-ffmpeg9` service; the default Debian FFmpeg service is used to identify older-version differences and does not automatically imply full cross-version support.

FFmpeg 构建能力必须与版本号分开记录；测试报告不得仅写“FFmpeg 9”而省略构建标识和所需编码器/协议能力。
FFmpeg build capabilities must be recorded separately from the version number; reports must not say only “FFmpeg 9” while omitting the build identifier and required encoder/protocol capabilities.

## 6. 设计方案
## 6. Design

验证采用短样片、独立输出目录和命令级原型；每个工作流完成后先形成结论，再决定是否进入下一个依赖它的实验。
Validation uses short samples, isolated output directories, and command-level prototypes; each workstream produces a conclusion before dependent experiments proceed.

样片源为 `/Users/macbookpro/Devs/samples/26.mp4`；已知特征为 H.264、3840×2160、约 29.97 fps、约 76 秒且没有音轨，因此需额外创建合成音频和外部字幕测试输入。
The sample source is `/Users/macbookpro/Devs/samples/26.mp4`; its known characteristics are H.264, 3840×2160, about 29.97 fps, about 76 seconds, and no audio track, so synthetic audio and external subtitle inputs are needed.

所有输出默认存放在仓库外的 `/private/tmp/php-ffmpeg/technical-validation-20261004/<case-id>/`；实际操作应创建专属子目录，不覆盖此前的 HLS 试验产物。
All outputs default to `/private/tmp/php-ffmpeg/technical-validation-20261004/<case-id>/` outside the repository; each run must use a dedicated subdirectory and must not overwrite earlier HLS trial artifacts.

每项实验先建立未加密或不带可选轨道的控制组，再逐一增加一个变量；发生失败时保留命令、日志、播放列表和部分文件以便复现。
Each experiment begins with an unencrypted control or a case without optional renditions, then adds one variable at a time; on failure, retain the command, logs, playlist, and partial files for reproduction.

加密测试区分三种材料：FFmpeg 读取的密钥字节、写入播放列表的播放器密钥 URI，以及 URL 密钥提供器的请求/响应；它们不得在记录中混为同一配置字段。
Encryption tests distinguish three items: key bytes read by FFmpeg, the player key URI written into a playlist, and requests/responses to a URL key provider; records must not conflate them as one configuration field.

密钥轮换按 FFmpeg HLS muxer 的 `periodic_rekey` 能力验证；key-info 文件及其引用的密钥文件必须按 FFmpeg 要求安全更新，实验通过预先生成带版本号的密钥文件并原子替换 key-info 文件避免读取到半写入状态。
Key rotation is tested using the FFmpeg HLS muxer's `periodic_rekey` capability; update the key-info file and referenced key safely as required by FFmpeg, using pre-created versioned key files and atomic key-info replacement to avoid partial reads.

FFmpeg 官方格式文档说明，启用 `periodic_rekey` 时会周期检查 key-info 文件；只有在这一行为于当前锁定构建中经实验确认后，才据此设计库的轮换接入点。
The official FFmpeg format documentation says that `periodic_rekey` periodically checks the key-info file; use this to design a library integration point only after the behavior is confirmed experimentally with the pinned build.

JSON 验证以 M3U8 原始产物为输入，检查 JSON 的往返/字段映射能力；它不应成为生成播放列表的替代路径。
JSON validation uses the raw M3U8 artifact as input and checks JSON round-trip/field-mapping capability; JSON must not become a replacement path for generating playlists.

### 可复现命令模板
### Reproducible command templates

以下命令从仓库根目录运行；样片只读挂载，输出目录必须是本次运行独占的临时目录。
Run the following commands from the repository root; mount the sample read-only and use a temporary output directory dedicated to this run.

```sh
VALIDATION_DIR=/private/tmp/php-ffmpeg/technical-validation-20261004
mkdir -p "$VALIDATION_DIR/TV-1/hls"
head -c 16 /dev/urandom > "$VALIDATION_DIR/TV-1/test.key"
printf '%s\n' '../../test.key' '/validation/TV-1/test.key' > "$VALIDATION_DIR/TV-1/keyinfo"
```

先从原始样片截取 8 秒视频，不重编码，以缩短后续实验时间。
First cut an 8-second clip from the original sample without re-encoding to shorten later experiments.

```sh
docker compose --profile ffmpeg9 run --rm \
  -v /Users/macbookpro/Devs/samples:/samples:ro \
  -v "$VALIDATION_DIR":/validation \
  php-ffmpeg9 ffmpeg -hide_banner -y -ss 0 -i /samples/26.mp4 -t 8 \
  -map 0:v:0 -an -c:v copy /validation/TV-1/clip.mp4
```

运行多码率 TS + AES-128 基线；`../../test.key` 从变体子目录相对解析到验证目录中的测试密钥。
Run the multi-rendition TS + AES-128 baseline; `../../test.key` resolves from each rendition subdirectory to the test key in the validation directory.

```sh
docker compose --profile ffmpeg9 run --rm \
  -v "$VALIDATION_DIR":/validation \
  php-ffmpeg9 ffmpeg -hide_banner -y -i /validation/TV-1/clip.mp4 \
  -filter_complex '[0:v:0]split=3[v480][v720][v1080];[v480]scale=-2:480[o480];[v720]scale=-2:720[o720];[v1080]scale=-2:1080[o1080]' \
  -map '[o480]' -map '[o720]' -map '[o1080]' -c:v libx264 -preset ultrafast \
  -g 60 -keyint_min 60 -sc_threshold 0 -b:v:0 1200k -b:v:1 2800k -b:v:2 5000k \
  -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_key_info_file /validation/TV-1/keyinfo \
  -var_stream_map 'v:0,name:480p v:1,name:720p v:2,name:1080p' \
  -master_pl_name master.m3u8 \
  -hls_segment_filename '/validation/TV-1/hls/%v/segment_%03d.ts' \
  '/validation/TV-1/hls/%v/index.m3u8'
```

读取主清单及三个变体，验证相对 URI、AES-128 解密和实际视频尺寸；若本机构建限制本地密钥扩展名，`-allowed_extensions ALL` 只用于这次本地验证。
Read the master playlist and all three variants to verify relative URIs, AES-128 decryption, and actual video dimensions; if the local build restricts key-file extensions, use `-allowed_extensions ALL` only for this local validation.

```sh
for rendition in 480p 720p 1080p; do
  docker compose --profile ffmpeg9 run --rm \
    -v "$VALIDATION_DIR":/validation php-ffmpeg9 ffprobe \
    -allowed_extensions ALL -protocol_whitelist file,crypto,data \
    -v error -show_entries stream=codec_name,width,height -of csv=p=0 \
    "/validation/TV-1/hls/$rendition/index.m3u8"
done
```

TV-3 的单变体 fMP4 用例沿用相同输入和 key-info，改用 `-hls_segment_type fmp4`、独立的 `-hls_fmp4_init_filename init.mp4` 和 `.m4s` 分片名；TS 与 fMP4 必须写入不同目录。
For the single-rendition fMP4 case in TV-3, reuse the same input and key-info, set `-hls_segment_type fmp4`, use a distinct `-hls_fmp4_init_filename init.mp4`, and name segments with the `.m4s` extension; write TS and fMP4 outputs to different directories.

TV-2 音频/字幕用例必须把每个输入作为独立 `-i` 参数传入，并用显式 `-map` 选择视频、AAC 音频和字幕流；将字幕编码为 WebVTT，再检查 FFmpeg 9 接受的 `-var_stream_map` 音频/字幕组参数及生成的每份播放列表。
For TV-2 audio/subtitle cases, pass each input as a separate `-i` argument and use explicit `-map` options to select video, AAC audio, and subtitle streams; encode subtitles as WebVTT, then inspect the audio/subtitle group parameters accepted by FFmpeg 9 in `-var_stream_map` and every generated playlist.

TV-4 轮换用例使用至少 8 个短分片；轮换进程观察正在写入的媒体播放列表，在达到预定分片边界后原子替换 key-info 文件，再验证 K1/K2 对应的分片和 `EXT-X-KEY` 变更顺序。
For TV-4 rotation, use at least eight short segments; have the rotation process observe the media playlist being written, atomically replace the key-info file at a predetermined segment boundary, then verify the segment-to-K1/K2 mapping and `EXT-X-KEY` change order.

## 7. 验收标准
## 7. Acceptance criteria

- [ ] TV-9 必须证明密文下载、认证解密和 MSE append 可增量流水执行，首个可解码帧早于整片下载完成；并验证弱网、Range 续传、CDN 缓存、码率/关键帧对齐、错误处理及目标浏览器兼容边界。
- [ ] TV-9 must prove that ciphertext download, authenticated decryption, and MSE appends proceed incrementally, with the first decodable frame before the full segment download completes; it must also validate poor networks, Range resume, CDN caching, rendition/keyframe alignment, error handling, and target-browser compatibility boundaries.
- [ ] TV-9 Demo first phase passes every Demo-specific completion criterion defined in its isolation and fixed-choice section; the report identifies any criterion not run or not passed.
- [ ] The first phase of the TV-9 Demo passes every Demo-specific completion criterion in its isolation and fixed-choice section; the report identifies any criterion that was not run or did not pass.

- [ ] 所有 TV-0 至 TV-6 用例均有完成状态、环境记录、可复现命令、产物清单和结论；不适用项需说明原因。
- [ ] Every TV-0 through TV-6 case has a completion status, environment record, reproducible command, artifact list, and conclusion; explain any not-applicable case.
- [ ] TS/fMP4、H.264/H.265、音频/字幕与加密的首期候选组合被标记为通过、失败、部分通过或未知，并注明证据范围。
- [ ] Candidate first-release combinations across TS/fMP4, H.264/H.265, audio/subtitles, and encryption are marked pass, fail, partial, or unknown with the scope of evidence stated.
- [ ] 静态单密钥、轮换密钥、播放器密钥 URI 和密钥材料 URL 的行为及限制分别形成结论。
- [ ] Static keys, rotating keys, player key URIs, and key-material URLs each have separate findings and limitations.
- [ ] 多码率、轨道组、文件路径和输出模式的 M3U8 URI 均通过实际存在性和 FFprobe 解析检查。
- [ ] M3U8 URIs for multi-rendition output, rendition groups, file paths, and output modes pass existence checks and FFprobe parsing.
- [ ] 任何播放器兼容结论均绑定到明确命名的播放器/设备；未确定目标播放器时，TV-7 明确保持待决。
- [ ] Every player compatibility result is tied to a specifically named player/device; TV-7 remains explicitly pending when targets have not been selected.
- [ ] 验证报告列出哪些需求可直接保留、哪些需缩小首期范围、哪些需要库后处理/适配层，以及哪些等待维护者决策。
- [ ] The validation report identifies which requirements can remain as written, which need a narrower first-release scope, which need library post-processing/an adapter, and which await maintainer decisions.
- [ ] HLS 主 SDD 根据已验证事实更新待决项、风险、兼容范围和验收标准；技术验证 SDD 仅在所有必做工作流完成并记录后标记为 Complete。
- [ ] Update the main HLS SDD's open questions, risks, compatibility scope, and acceptance criteria based on verified facts; mark this technical-validation SDD Complete only after all required workstreams are completed and recorded.
- [ ] TV-8 在 Docker 中可重复生成 HEVC + fMP4 + `cbcs` HLS，并验证密钥信令和测试密钥解密；浏览器插件/DRM 兼容性作为单独结果记录，不限制产物能力声明。
- [ ] TV-8 reproducibly generates HEVC + fMP4 + `cbcs` HLS in Docker and validates key signaling and decryption with a test key; browser plugin/DRM compatibility is recorded separately and does not limit claims about artifact-generation capability.

## 8. 验证计划
## 8. Verification plan

### TV-9：自定义 AES-CTR fMP4 HLS Web 播放
### TV-9: Custom AES-CTR fMP4 HLS web playback

**目标：**判断本项目能否提供由自有 Web 播放器消费的自定义加密模式：fMP4 初始化段保持明文；媒体分片以 AES-CTR 连续加密，但网络读取、解密和 MSE append 必须分批流式推进，不能等整个 `.m4s` 下载并解密完才开始播放；sidecar/JSON 清单记录方案版本、分片 URI、密钥授权 URI、初始 counter 和分块校验元数据。
**Goal:** Determine whether the project can provide a custom encryption mode consumed by its own web player: keep the fMP4 initialization segment clear; encrypt media segments with a continuous AES-CTR stream, while network reads, decryption, and MSE appends must progress incrementally rather than waiting for the entire `.m4s` to download and decrypt; record the scheme version, segment URI, key authorization URI, initial counter, and chunk-integrity metadata in a sidecar/JSON manifest.

**协议边界：**这是私有 Web 播放协议，不是 RFC 8216 的 HLS `AES-128`，也不是 HLS 2nd Edition Internet-Draft 中的 `SAMPLE-AES-CTR`（该草案定义 fMP4 的 sample encryption 使用 CENC `cenc`）。截至本次查阅的 HLS 2nd Edition draft-22，标准草案列有整分片 `AES-256-GCM`，没有整分片 `AES-CTR`。hls.js 支持 `AES-256-CTR` 是播放器扩展实现；hls.js 维护者在 GitHub 讨论中明确指出它不在 RFC 8216 的 METHOD 列表中。因此自定义 CTR 字段/记录不会被通用 HLS 客户端自动理解，必须由项目播放器处理；若追求 HLS 草案方向，需另测 `AES-256-GCM`（但整片认证/解密可能不满足片内渐进出明文的流式目标）。
**Protocol boundary:** This is a private web playback protocol, not RFC 8216 HLS `AES-128`, nor `SAMPLE-AES-CTR` in the HLS 2nd Edition Internet-Draft (which defines fMP4 sample encryption using Common Encryption `cenc`). As of the reviewed HLS 2nd Edition draft-22, the draft lists whole-segment `AES-256-GCM`, but not whole-segment `AES-CTR`. hls.js support for `AES-256-CTR` is a player extension; an hls.js maintainer explicitly noted in a GitHub discussion that it is not among RFC 8216's METHOD values. Generic HLS clients will therefore not understand custom CTR fields/records automatically; the project player must process them. If following the HLS draft direction, separately test `AES-256-GCM` (although whole-segment authentication/decryption may not meet the requirement to emit clear bytes progressively from within a segment).

**公开实现考察——hls.js：**hls.js 的公开扩展点在代码和 API 文档中均可确认：`fLoader` 负责媒体、初始化和 partial fragment；loader callback 提供 `onProgress(stats, context, data, networkDetails)` 分块回调；开启全局 `progressive: true` 后，`FragmentLoader` 会把回调数据包装为对应 fragment 的 `payload`，并沿 `_handleFragmentLoadProgress()` → `TransmuxerInterface` → `BufferController` 的现有渐进管线处理。默认 `progressive` 是 `false`，实验必须显式开启。API 文档还直接规定：完全接管解密时，在 `fLoader` 解密，并在 `pLoader` 移除 `#EXT-X-KEY`，否则播放器会对已解密数据再次解密；移除标签后，密钥轮换也由自定义 loader 根据 fragment 序号/level 等信息管理。因此从接口/源码结构看，不需要先验证“有没有公开扩展点”：这些扩展点确实存在，理论上可以把已解密的 progress 数据接回现成 MSE/ABR/重试管线。
**Public implementation review—hls.js:** hls.js's public extension points are confirmed by both source and API docs: `fLoader` handles media, initialization, and partial fragments; the loader callback provides chunked `onProgress(stats, context, data, networkDetails)`; with global `progressive: true`, `FragmentLoader` wraps callback data as the corresponding fragment's `payload` and routes it through the existing `_handleFragmentLoadProgress()` → `TransmuxerInterface` → `BufferController` progressive pipeline. `progressive` defaults to `false` and must be explicitly enabled for the experiment. The API docs also directly specify that fully custom decryption belongs in `fLoader`, with `#EXT-X-KEY` removed by `pLoader`; otherwise the player decrypts already-decrypted bytes a second time. After removing those tags, custom key rotation is the loader's responsibility, tracked using fragment sequence/level and related context. Thus the source/API structure confirms that the public extension points exist; in principle, clear progress data can be reconnected to the existing MSE/ABR/retry pipeline.

仍需做原型验证的不是扩展点是否存在，而是异步记录式 CTR 解密器能否按序、带背压地替换 `onProgress` 数据并避免最后一次 `onSuccess` 重复追加；自定义 sidecar/清单如何为每个 fragment 提供记录 counter 与认证信息；Range 续传如何恢复记录边界/counter；以及 HEVC/fMP4 progressive transmux/MSE 是否在目标浏览器中早于整片下载完成产生可解码帧。只有这些工作必须修改 hls.js 内部实现时，才重新比较 fork 与独立播放器。
What remains to be validated is not whether the extension points exist, but whether an asynchronous record-based CTR decryptor can replace `onProgress` data in order with backpressure and without appending it again through the final `onSuccess`; how the custom sidecar/manifest supplies each fragment's record counters and authentication data; how Range resume restores record boundaries/counters; and whether HEVC/fMP4 progressive transmux/MSE produces a decodable frame in target browsers before the full segment downloads. Compare a fork with a standalone player only if these tasks require changes to hls.js internals.

**公开实现考察——Shaka Player：**Shaka Player 的插件文档提供 networking plugin 注册点（按 URI scheme）及可配置 ABR manager；这说明网络和码率策略可扩展，但本次未找到官方文档证明它可直接对自定义 CTR 记录执行流式解密。因此只把它列为候选网络/ABR 架构参考，不把 Shaka Packager 的加密能力误认为 Shaka Player 的对应播放能力。
**Public implementation review—Shaka Player:** Shaka Player's plugin documentation exposes networking-plugin registration (by URI scheme) and a configurable ABR manager. This shows that networking and bitrate policy are extensible, but the reviewed official docs do not establish direct streaming decryption of custom CTR records. Treat it only as a candidate networking/ABR architecture reference; do not infer that Shaka Packager's encryption capabilities imply the same playback capability in Shaka Player.

**候选代码形状（示意，尚未实现）：**网络读取 chunk 是任意切分的，必须先经过记录组帧器；记录只有在完整且认证通过后才能释放明文。明文 append 需串行排队，避免 `SourceBuffer.updating` 时并发调用。
**Candidate code shape (illustrative, not implemented):** Network chunks have arbitrary boundaries and must first pass through a record framer; release clear bytes only after a complete record has passed authentication. Serialize clear appends to avoid concurrent calls while `SourceBuffer.updating` is true.

```ts
// Dedicated Worker: stream fetch -> frame authenticated crypto records -> decrypt.
// Dedicated Worker：流式 fetch -> 组装带认证的加密记录 -> 解密。
const response = await fetch(segmentUrl, { signal });
if (!response.ok || !response.body) throw new Error(`segment HTTP ${response.status}`);
const reader = response.body.getReader();
const framer = new CryptoRecordFramer(); // network chunk boundaries are not record boundaries
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  for (const record of framer.push(value)) {
    await verifyRecord(record, macKey); // authenticate before exposing plaintext
    const clear = await decryptCtrRecord(record, contentKey);
    postMessage({ type: 'clear-bytes', bytes: clear }, [clear.buffer]);
  }
}
framer.assertComplete();
```

```ts
// Main thread: append ordered plaintext batches; wait for updateend between calls.
// 主线程：按序追加明文批次；每次调用之间等待 updateend。
async function appendInOrder(sourceBuffer: SourceBuffer, bytes: Uint8Array) {
  await waitUntilNotUpdating(sourceBuffer);
  sourceBuffer.appendBuffer(bytes);
  await once(sourceBuffer, 'updateend');
}
```

上述伪代码中的 `CryptoRecordFramer`、`verifyRecord`、`decryptCtrRecord`、取消/重试协调、内存背压及 append 失败恢复都需要定义与验证；不能直接作为生产加密协议。
The pseudocode's `CryptoRecordFramer`, `verifyRecord`, `decryptCtrRecord`, cancellation/retry coordination, memory backpressure, and append-failure recovery all still need specification and validation; it is not a production encryption protocol as written.

**Service Worker：**Service Worker 可拦截受控页面发出的 Fetch 请求并返回自定义 `Response`，适合请求路由、鉴权头注入、缓存或离线支持；它需要安全上下文（通常 HTTPS），并受 scope 与页面控制状态约束。它不作为首选解密环境：原生媒体元素/浏览器内部 HLS 请求经过 Service Worker 的行为不能跨浏览器假定，且事件驱动生命周期不适合管理播放器缓冲状态。
**Service Worker:** A Service Worker can intercept Fetch requests from a controlled page and return a custom `Response`, making it useful for request routing, authorization-header injection, caching, or offline support; it requires a secure context (normally HTTPS) and is constrained by scope and page-control state. It is not the preferred decryption runtime: do not assume native media-element/internal HLS requests pass through it consistently across browsers, and its event-driven lifecycle is poorly suited to managing player buffer state.

**Dedicated Web Worker 与流式解密：**播放器显式把分片 URL 和授权上下文交给 Dedicated Worker；Worker 读取 `Response.body` 的 `ReadableStream`，按协议边界取密文、增量解密并将小批明文传给主线程 MSE。Web Crypto `SubtleCrypto.decrypt()` 的输入/输出是完整 `BufferSource`/`ArrayBuffer`，不是可跨调用延续的流式 CTR API，因此不能简单对每个任意网络 chunk 各调用一次并假设 CTR 状态自动延续。TV-9 必须比较：A) 自有 JS/WASM 增量 AES-CTR 保持单一连续 counter 状态；B) 定义有序、独立计数器的加密记录块（crypto records），使用 Web Crypto 逐记录解密，并对每条记录单独认证。两者均不得因网络 chunk 边界变化而改变解密结果。CTR 不提供完整性认证；收到并验证对应认证标签/MAC 后才把该记录明文交给 MSE。Worker 不保护 Key 免受已授权用户或调试工具读取。
**Dedicated Web Worker and streaming decryption:** The player explicitly passes the segment URL and authorization context to a Dedicated Worker; the Worker reads the `Response.body` `ReadableStream`, processes ciphertext at protocol-defined record boundaries, decrypts incrementally, and sends small clear batches to main-thread MSE. Web Crypto `SubtleCrypto.decrypt()` takes/returns a complete `BufferSource`/`ArrayBuffer`; it is not a streaming CTR API with state carried across calls, so the implementation cannot call it on arbitrary network chunks and assume CTR state continues automatically. TV-9 must compare: A) custom JS/WASM incremental AES-CTR that maintains one continuous counter state; B) ordered crypto records with independent counters, decrypted one record at a time by Web Crypto and authenticated per record. In both designs, changing network chunk boundaries must not change the decryption result. CTR provides no integrity authentication; release each record's clear bytes to MSE only after its authentication tag/MAC is verified. A Worker does not protect Keys from authorized users or debugging tools.

**MSE 放置：**先实现 Worker 解密 + 主线程 `MediaSource`/`SourceBuffer`；再测试 Worker 内 MSE 并转移 `MediaSourceHandle`。后者可能减少主线程媒体工作，但该 Handle 目前不是所有主流浏览器都支持，且不能经 Service Worker 转移，因此只能作为可选优化。用 `MediaSource.isTypeSupported()` 或 Media Capabilities 查询编码能力，最终仍以真实 append、播放、seek 和错误恢复结果为准。
**MSE placement:** First implement Worker decryption + main-thread `MediaSource`/`SourceBuffer`; then test MSE inside a Worker and transfer `MediaSourceHandle`. The latter may reduce main-thread media work, but the Handle is not supported in all major browsers and cannot be transferred through a Service Worker, so it can only be an optional optimization. Query codec capability with `MediaSource.isTypeSupported()` or Media Capabilities, but use actual append, playback, seek, and error-recovery results as the verdict.

**弱网与 CDN 要求：**此模式必须将清单、加密媒体对象作为不可变、可缓存资源；密钥授权端点与媒体对象分离，响应需按授权策略禁止共享缓存或正确区分用户。CDN 必须验证 HTTPS、Range/`206 Partial Content`、`Content-Range`、ETag/If-Range、断点重试、跨域 CORS 与缓存键配置。授权 URL 上的用户 token 不得意外成为公共缓存键，也不得让 CDN 缓存密钥响应。
**Poor-network and CDN requirements:** This mode must expose manifests and encrypted media objects as immutable cacheable resources; separate the key authorization endpoint from media objects, and prevent shared caching of its responses or correctly partition them by authorization policy. Validate HTTPS, Range/`206 Partial Content`, `Content-Range`, ETag/If-Range, retry/resume, cross-origin CORS, and cache-key configuration at the CDN. User tokens in authorization URLs must not accidentally become public cache keys, and the CDN must not cache key responses.

**Range 与分片对齐：**HTTP Range 的单位是资源表示中的字节，不知道 MP4 box、CMAF fragment 或 AES counter 边界。不能把任意 `206` 字节片段直接 append 给 MSE；但流式播放要求已认证的明文前缀能在整片下载完之前分批送入 MSE。MSE parser 会在多次 append 间保留未解析字节，并可在形成完整 coded frame 后推进处理，因此需验证 fragment 内部渐进 append 是否适用于目标 HEVC/fMP4 浏览器。首选将每个可独立解码的 CMAF/fMP4 fragment 作为 CDN 对象，或为拼接对象中的完整 fragment 生成精确 `EXT-X-BYTERANGE`；变体/音频时间边界、关键帧/IDR 与分片索引对齐。若需要从中断点续传，按对象 ETag 与 Range 恢复密文，再从记录边界续解密；任意 HTTP 网络 chunk 边界不得被当作密码记录或媒体边界。“AES 块 16 字节对齐”本身不等于有效 fMP4/MSE 边界。
**Range and segment alignment:** HTTP Range addresses byte positions in a resource representation; it does not know MP4 box, CMAF fragment, or AES counter boundaries. Arbitrary `206` byte slices cannot be appended directly to MSE; however, streaming playback requires authenticated clear prefixes to be appended incrementally before the whole segment is downloaded. The MSE parser retains unparsed bytes across multiple appends and may process complete coded frames as they become available, so progressive append within a fragment must be verified for target HEVC/fMP4 browsers. Prefer one independently decodable CMAF/fMP4 fragment per CDN object, or exact `EXT-X-BYTERANGE` ranges for complete fragments in a concatenated object; align rendition/audio timelines, keyframe/IDR points, and segment indexes. Resume interrupted transfers using the object's ETag and Range, then continue decryption from a record boundary; arbitrary HTTP chunk boundaries must not be treated as cryptographic-record or media boundaries. 16-byte AES-block alignment alone is not a valid fMP4/MSE boundary.

**低带宽和 HEVC：**HEVC 可在相近主观质量下降低码率，但实际收益取决于内容、编码器、profile/level、设备解码能力和 CDN/播放器选择；不能以“H.265 文件更小”替代实测。编码梯度需提供足够低的 HEVC variant，并在每个切换点对齐 IDR、时间戳、音视频边界；清单中准确声明 CODECS、RESOLUTION、BANDWIDTH/AVERAGE-BANDWIDTH。对用户网络低于最低 HEVC variant、设备不支持 HEVC、或解密/解码开销过高的情况，验证是否提供 H.264 fallback，或明确返回不支持，不得无提示地选错 variant。
**Low bandwidth and HEVC:** HEVC may achieve a lower bitrate at similar subjective quality, but actual gains depend on content, encoder, profile/level, device decoding capability, and CDN/player selection; do not substitute “H.265 is smaller” for measurement. The bitrate ladder needs a sufficiently low HEVC variant, with IDR, timestamps, and audio/video boundaries aligned at every switching point; declare CODECS, RESOLUTION, BANDWIDTH/AVERAGE-BANDWIDTH accurately. For networks below the lowest HEVC variant, devices without HEVC, or excessive decrypt/decode cost, validate an H.264 fallback or return a clear unsupported result rather than silently selecting an unsuitable variant.

**TV-9 Demo 的隔离范围与固定选择：**Demo 的全部代码、Docker 配置、锁文件、操作 README 和生成产物索引必须放在仓库根目录的 `experiments/hls-ctr-demo/`；不得修改 `src/`、`tests/`、根目录 `composer.json`、根目录 `compose.yaml` 或正常 PHPUnit 配置。Demo 使用自己的 `Dockerfile`、`compose.yaml` 和 Node/npm 锁文件，通过从仓库根目录执行 `SAMPLE_FILE=/绝对路径/样片.mp4 docker compose -f experiments/hls-ctr-demo/compose.yaml up --build` 启动；缺少 `SAMPLE_FILE` 或文件不可读时 Compose 必须报错退出。端口固定映射为 `127.0.0.1:8789:8789`；应用代码和依赖烘焙进独立镜像，容器仅挂载 Demo 的 `output/` 可写目录及只读样片文件 `/input/source.mp4`。生成物写入 Demo 专属 `output/` 并由目录内 `.gitignore` 排除。hls.js 使用精确锁定的 npm 发布包 `1.7.3`；npm 锁文件记录包完整性，Docker 构建阶段执行 `npm audit --omit=dev`。Node.js 使用 `24.21.0`，Docker 基础镜像锁定明确版本和多架构索引摘要，不得使用 `latest`，构建记录中写明 Node/npm 版本及实际镜像摘要。该目录不是 Composer autoload、PHPUnit 或正式库发布内容的一部分。
**TV-9 Demo isolation and fixed choices:** Put all Demo code, Docker configuration, lockfiles, the operation README, and generated-artifact index under `experiments/hls-ctr-demo/` at the repository root; do not modify `src/`, `tests/`, the root `composer.json`, root `compose.yaml`, or normal PHPUnit configuration. The Demo uses its own `Dockerfile`, `compose.yaml`, and Node/npm lockfile, launched from the repository root with `SAMPLE_FILE=/absolute/path/sample.mp4 docker compose -f experiments/hls-ctr-demo/compose.yaml up --build`; Compose must fail if `SAMPLE_FILE` is missing or unreadable. Bind the port as `127.0.0.1:8789:8789`; bake application code and dependencies into its separate image, and mount only the Demo `output/` directory as writable and the read-only sample file at `/input/source.mp4`. Write generated files to the Demo-specific `output/`, excluded by its local `.gitignore`. Use the exact-lockfile npm release package `hls.js` `1.7.3`; the npm lockfile records package integrity, and the Docker build runs `npm audit --omit=dev`. Use Node.js `24.21.0`; pin the Docker base image to an explicit version and multi-architecture index digest, never `latest`, and record Node/npm versions and the actual image digest in the build record. This directory is outside Composer autoloading, PHPUnit, and formal library release contents.

**Demo 第一阶段固定实现：**只做桌面 Chrome 稳定版 H.264 VOD、单一视频轨、一个变体、一个逻辑媒体分片、明文 fMP4 init；从输入起始位置截取 8 秒并缩放编码为 H.264 8-bit `yuv420p` 480p、目标码率 500 kbit/s，不含音频。编码器生成约 4 秒的 fMP4 fragment；Demo 去除分段索引后按顺序拼接多组 `moof`/`mdat`，形成一个含多个内部 fragment 的逻辑 HLS 媒体对象，以便 hls.js 在对象下载完成前解析并 append 完整 fragment。采用 hls.js 公共 `fLoader`；播放列表由 Demo 服务提供且不含 `#EXT-X-KEY`，并显式设置 `progressive: true`。自定义 `fLoader` 通过 `fetch()` 的 `ReadableStream` 读取密文，把 Worker 解密后的连续明文记录逐条通过 `onProgress` 交给 hls.js；成功终止时不得把已通过 `onProgress` 交付的数据再经 `onSuccess` 重复交付。初始化段按普通明文 fragment 处理。首阶段不实现 hls.js fork、Service Worker、Worker 内 MSE、HEVC、ABR、多音轨/字幕、生产密钥服务或移动设备支持。
**Demo phase-one implementation is fixed:** Implement only H.264 VOD in the current stable desktop Chrome, with one video track, one rendition, one logical media segment, and a clear fMP4 init segment. Trim eight seconds from the input start and encode 8-bit H.264 as 480p `yuv420p` at a target bitrate of 500 kbit/s, with no audio. The encoder generates fMP4 fragments of about four seconds; the Demo removes per-segment indexes and concatenates the ordered `moof`/`mdat` pairs into one logical HLS media object containing multiple internal fragments, so hls.js can parse and append complete fragments before the object finishes downloading. Use hls.js's public `fLoader`; serve the playlist from the Demo server without `#EXT-X-KEY`, and explicitly set `progressive: true`. The custom `fLoader` reads ciphertext through `fetch()`'s `ReadableStream` and forwards each contiguous clear record from the decryption Worker to hls.js through `onProgress`; on successful completion it must not deliver data already sent through `onProgress` a second time through `onSuccess`. Handle the init segment as an ordinary clear fragment. Phase one does not implement an hls.js fork, Service Worker, Worker-owned MSE, HEVC, ABR, alternate audio/subtitles, production key service, or mobile-device support.

**Demo 专用记录格式（不得用于生产）：**`contentId` 固定为小写 ASCII UUID；每条记录的明文上限固定为 65,536 字节，记录按序号从 0 连续编号，末条可短于上限。二进制格式固定为 `sequence:uint32be || counter:16 bytes || ciphertextLength:uint32be || ciphertext[ciphertextLength] || tag:32 bytes`，其中 `ciphertextLength` 必须等于本条明文字节数。每次 Demo 启动为该内容用密码学随机数生成器产生一个 128 位大端 `baseCounter` 并写入 sidecar；序号为 `n` 的记录 counter 固定为 `baseCounter + n * 4096`，计算不得溢出 128 位。每条记录使用独立 AES-128-CTR 调用，Web Crypto 的 `length` 固定为 128。测试 AES key 字节固定为 `00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f`，HMAC key 字节固定为 `00` 至 `1f` 的顺序 32 字节；本机专用 `GET /demo-key/{contentId}` 返回 UTF-8 JSON `{"aesCtrKey":"<base64>","hmacKey":"<base64>"}`，响应设置 `Cache-Control: no-store`。认证标签为 HMAC-SHA-256，输入精确为 UTF-8 字节串 `php-ffmpeg-hls-ctr-demo-v1\n`、UTF-8 `contentId`、一个 `0x00` 字节、该记录完整 header 和 ciphertext 的串接；使用 Web Crypto `SubtleCrypto.verify()` 验证标签，成功后才执行解密并释放记录明文。Demo 固定使用已知测试密钥，因此不提供内容保密或密钥保护保证。
**Demo-only record format (never use in production):** Fix `contentId` as a lowercase ASCII UUID; limit each record's plaintext to 65,536 bytes and number records contiguously from zero, with the final record allowed to be shorter. Fix the binary format as `sequence:uint32be || counter:16 bytes || ciphertextLength:uint32be || ciphertext[ciphertextLength] || tag:32 bytes`, where `ciphertextLength` must equal the plaintext byte length. At each Demo startup, generate a 128-bit big-endian `baseCounter` for the content with a cryptographically secure random generator and write it to the sidecar; the counter for record number `n` is exactly `baseCounter + n * 4096`, and this calculation must not overflow 128 bits. Decrypt each record with a separate AES-128-CTR Web Crypto call using `length` 128. Fix the test AES key bytes as `00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f` and the HMAC key bytes as the ordered 32 bytes from `00` through `1f`. The localhost-only `GET /demo-key/{contentId}` returns UTF-8 JSON `{"aesCtrKey":"<base64>","hmacKey":"<base64>"}` with `Cache-Control: no-store`. The authentication tag is HMAC-SHA-256 over the exact concatenation of the UTF-8 bytes of `php-ffmpeg-hls-ctr-demo-v1\n`, UTF-8 `contentId`, one `0x00` byte, the complete record header, and ciphertext. Verify it with Web Crypto `SubtleCrypto.verify()`; decrypt and release record plaintext only after verification succeeds. The Demo uses known test keys and provides no content confidentiality or key-protection guarantee.

**Demo 输入、清单及请求行为：**Docker 启动命令使用必需参数 `SAMPLE_FILE` 显式指定只读样片文件并将它挂载为 `/input/source.mp4`；样片缺失或不可读时立即失败，不得悄悄使用仓库内视频或下载样片。启动时在 `output/` 生成明文基线、加密 fragment、sidecar JSON 和播放列表；sidecar JSON 使用 UTF-8，schema 固定包含整数 `schemaVersion: 1`、小写 UUID `contentId`、相对 URL `segmentUri`、相对 URL `keyUri`、整数 `recordSize: 65536`、Base64 `baseCounter`，以及按序排列的每条记录 `sequence/counter/ciphertextLength/tagLength: 32`。播放列表仅引用实验播放器能读取的媒体 URI，不声明 `#EXT-X-KEY` 或其他 HLS 标准加密。HTTP 服务需提供 `GET`、`HEAD`、单一 `bytes=start-end` Range 的精确 `206`、正确的 `Content-Range`、基于完整对象 SHA-256 的稳定强 ETag 和可配置限速；不支持的多 Range 请求返回 `416`。同一对象的 Range 响应必须保持同一 ETag。Demo 页面提供播放、停止、限速、断开后按记录边界续传和篡改记录按钮；所有测试密钥、输入和输出均限于本机 Demo 容器。
**Demo inputs, manifest, and request behavior:** The Docker launch command requires `SAMPLE_FILE` to explicitly identify a read-only sample file mounted at `/input/source.mp4`; fail immediately if it is missing or unreadable, without silently using a repository video or downloading one. On startup, generate a clear baseline, encrypted fragment, sidecar JSON, and playlist under `output/`. The UTF-8 sidecar schema is fixed to include integer `schemaVersion: 1`, lowercase UUID `contentId`, relative-URL `segmentUri`, relative-URL `keyUri`, integer `recordSize: 65536`, Base64 `baseCounter`, and an ordered entry for each record with `sequence/counter/ciphertextLength/tagLength: 32`. The playlist references only media URIs understood by the experimental player and declares no `#EXT-X-KEY` or other standard HLS encryption. The HTTP server must implement `GET`, `HEAD`, exact `206` for a single `bytes=start-end` Range, a correct `Content-Range`, a stable strong ETag based on the complete object's SHA-256, and configurable throttling; return `416` for unsupported multiple ranges. Range responses for the same object must preserve the same ETag. The Demo page provides play, stop, throttle, disconnect-and-resume at a record boundary, and tamper-record controls; all test keys, inputs, and outputs stay within the localhost Demo container.

**Demo 完成判据：**在 README 中给出从空 Docker 构建到播放的单一复制命令流程；记录浏览器名称/版本、Docker 镜像摘要、hls.js 版本、样片 SHA-256、首个密文响应完成时间、首个解码帧时间和完整 fragment 下载完成时间。必须证明解密后 fragment SHA-256 与明文基线一致，首个解码帧早于完整 fragment 下载完成，限速及中断续传后可播放，篡改任一记录时该记录及后续数据不进入 MSE，且 `src/`、`tests/`、根 Composer/Docker 配置没有 Demo 改动。任一条件失败都记录复现步骤和日志，不能宣称 Demo 通过；通过只代表本机 Demo 所列浏览器/环境可行，不代表生产加密安全、CDN 兼容或移动端支持。
**Demo completion criteria:** Provide one copyable sequence in the README from a clean Docker build to playback; record browser name/version, Docker image digest, hls.js version, sample SHA-256, completion time of the first ciphertext response, time of the first decoded frame, and completion time of the full fragment download. Prove that the decrypted fragment SHA-256 matches the clear baseline, the first decoded frame precedes completion of the full fragment download, playback recovers after throttling and interrupted-transfer resume, and tampering with any record prevents that record and subsequent data from entering MSE. Also prove that no Demo changes were made to `src/`, `tests/`, or root Composer/Docker configuration. Record reproduction steps and logs for every failed criterion and do not claim a pass if any criterion fails; a pass demonstrates feasibility only in the listed local Demo browser/environment, not production cryptographic security, CDN compatibility, or mobile support.

**实验步骤：**
**Experiment steps:**

1. 在 Docker 中生成 5–10 秒 H.264 和 HEVC fMP4 样片，保存明文 init/分片基线并记录 codec string、时间戳和分片边界。
1. In Docker, generate 5–10 second H.264 and HEVC fMP4 samples, preserve clear init/segment baselines, and record codec strings, timestamps, and segment boundaries.
2. 用隔离实验加密器对每个媒体分片完整字节执行 AES-CTR，生成每内容/分片唯一 IV/counter 并写入 sidecar；init 暂时保持明文。解密后做哈希比较，确认字节与原分片一致。
2. Use an isolated experimental encryptor to AES-CTR encrypt each complete media segment, generate a unique IV/counter per content/segment, and record it in the sidecar; keep init clear for now. Hash-compare decrypted output with the original segment to confirm byte equality.
3. 做最小 Web 播放器：通过 HTTPS 测试授权端点取得测试 Key；Worker 以 `ReadableStream` 渐进读取、按加密记录增量解密/校验并分批交付；主线程先 append init，再在片段未下载完时 append media 前缀。用首批可解码帧是否早于完整分片下载完成作为流式判据。先测 H.264，再测 HEVC，以分离解密和 HEVC 解码问题。
3. Build a minimal web player: obtain a test Key through an HTTPS authorization endpoint; have the Worker progressively read with `ReadableStream`, incrementally decrypt/verify crypto records, and deliver small batches; append init first, then media prefixes before the segment download completes. Use whether the first decodable frame arrives before the full segment download completes as the streaming criterion. Test H.264 first, then HEVC, to separate decryption from HEVC decoding issues.
4. 对 Chrome/Edge、Firefox、macOS Safari、iOS Safari、Android Chrome 记录版本、MSE 能力、`isTypeSupported`/Media Capabilities、HEVC profile、实际播放/seek/网络中断恢复。HEVC 不支持应记录为编码能力限制，不归因为解密失败。
4. For Chrome/Edge, Firefox, macOS Safari, iOS Safari, and Android Chrome, record versions, MSE capability, `isTypeSupported`/Media Capabilities, HEVC profile, and actual playback/seeking/network-interruption recovery. HEVC absence is a codec limitation, not a decryption failure.
5. 比较 A) Dedicated Worker 流式解密 + 主线程 MSE（基线）；B) 在 hls.js 上通过公开 loader/事件扩展点复用 ABR、重试和 buffer（优先考察的复用路线，需证明能渐进处理密文）；C) 修改 hls.js 内部解密/调度或维护 fork；D) Worker 内 MSE/Handle（优化候选）；E) Service Worker 拦截并返回明文（探索项）。记录各路线代码改动范围、首帧时间、峰值内存、主线程长任务、seek/续传和 Key 过期行为。
5. Compare A) Dedicated Worker streaming decryption + main-thread MSE (baseline); B) reuse hls.js ABR/retries/buffering through public loader/event extension points (preferred reuse investigation, but prove progressive ciphertext handling); C) modify hls.js internal decryption/scheduling or maintain a fork; D) Worker-owned MSE/Handle (optimization candidate); E) Service Worker interception returning clear bytes (exploratory). Record code-change scope, time to first frame, peak memory, main-thread long tasks, seek/resume, and Key-expiry behavior.
6. 在可控 HTTP/CDN 测试环境中，对分离对象和拼接对象的精确 fragment byte-range 分别测试完整下载、限速、丢包/断连、Range resume、206/200 回退、416、过期 ETag、缓存命中/未命中、跨域预检与 token 过期；验证重试后仍能按密码记录顺序增量送入有效明文，MSE parser 最终得到完整且顺序正确的 fragment。
6. In a controllable HTTP/CDN test environment, test separate objects and exact fragment byte-ranges under complete download, throttling, packet loss/disconnection, Range resume, 206/200 fallback, 416, stale ETag, cache hit/miss, cross-origin preflight, and token expiry; verify that retries still deliver valid clear bytes incrementally in crypto-record order and that the MSE parser ultimately receives a complete, correctly ordered fragment.
7. 为 H.264 与 HEVC 制作至少三个码率档，使用相同 segment duration 和编码关键帧边界；在受限带宽/延迟网络下记录首帧时间、重缓冲次数、码率切换成功率、下载速度估算误差、每片大小/峰值码率、解密时间、内存峰值和是否回退至 H.264。比较 2、4、6 秒 segment；若尝试 CMAF chunk/LL-HLS partial segments，作为独立模式测试，不能把不完整加密分片直接暴露给播放器。
7. Create at least three bitrate renditions for H.264 and HEVC, using the same segment duration and aligned keyframe boundaries; under constrained bandwidth/latency, record time to first frame, rebuffer count, successful rendition switches, throughput-estimation error, segment size/peak bitrate, decryption time, peak memory, and H.264 fallback behavior. Compare 2-, 4-, and 6-second segments; test CMAF chunks/LL-HLS partial segments as a separate mode and do not expose incomplete encrypted segments directly to the player.

**通过标准与预期：**必须证明首个可解码帧可在完整分片下载前呈现；Worker 内存不随整片大小无界增长；乱序、丢失、重复、篡改加密记录不得导致错误明文进入 MSE；限速/断连时能暂停、续传并恢复播放。至少一个明确列出的桌面浏览器通过播放器播放 H.264；HEVC 仅在该浏览器实际支持 HEVC MSE 时判定。解密数据须与原片一致，错误 Key/IV、401/403、超时、seek、重复请求均有确定行为。最有希望的首选是评估 hls.js 的渐进加载/MSE/ABR 管线并接入自定义认证 CTR 解密；若公开扩展点不足，再在“维护 hls.js fork”和“自建 Dedicated Worker + MSE 播放器”之间比较。Service Worker 仅作可选网络/缓存层。iOS/Android 原生 HLS 播放器不在默认支持范围。
**Pass criteria and expectation:** Prove that the first decodable frame is presented before the complete segment has downloaded; Worker memory must not grow unbounded with full-segment size; reordering, loss, duplication, or tampering of crypto records must never release incorrect plaintext to MSE; throttling/disconnection must pause, resume, and recover playback. At least one explicitly listed desktop browser must play H.264; count HEVC only if that browser actually supports HEVC MSE. Decrypted bytes must match the source, and wrong Key/IV, 401/403, timeout, seeking, and duplicate requests must have defined behavior. The leading candidate is to evaluate hls.js's progressive loading/MSE/ABR pipeline with a custom authenticated-CTR decryption stage; if public extension points are insufficient, compare maintaining an hls.js fork with building a Dedicated Worker + MSE player. Use Service Worker only as an optional network/cache layer. Native iOS/Android HLS players are outside the default support scope.

**弱网/CDN 验收：**Range 恢复必须按实体标签/对象版本校验，避免把不同版本的响应拼成一个分片；MSE 可以收到同一媒体 fragment 的连续明文前缀，但 parser 最终必须获得完整、顺序正确的 fragment，不能混入缺口、重复或乱序数据。每个变体边界必须时间对齐且从可独立解码点开始；受限网络下 ABR 可降档且不持续重缓冲。测试必须覆盖 CDN 对密文缓存、Key 响应不缓存、CORS、Range、鉴权 token 和 URL 过期的实际行为。只有这些结果通过后，才可宣称该模式具备所测 CDN/弱网环境的断点恢复能力。
**Poor-network/CDN acceptance:** Range resume must validate the entity tag/object version to avoid combining responses from different object versions. MSE may receive contiguous clear prefixes of the same media fragment, but the parser must ultimately receive a complete, correctly ordered fragment with no gaps, duplicates, or reordered bytes. Each rendition boundary must be time-aligned and start at an independently decodable point; under constrained networks ABR must step down without persistent rebuffering. Tests must cover actual CDN behavior for ciphertext caching, no caching of Key responses, CORS, Range, authorization tokens, and URL expiry. Claim resumability only for the tested CDN/poor-network environments after these checks pass.

参考资料： [Service Worker Fetch 拦截](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/fetch_event)、[Dedicated Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)、[Fetch 流式读取](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch)、[Web Crypto 解密](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/decrypt)、[MSE](https://www.w3.org/TR/media-source-2/)、[ISOBMFF MSE 字节流格式](https://www.w3.org/TR/mse-byte-stream-format-isobmff/)、[HTTP Range 语义 RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)、[HLS 2nd Edition draft-22](https://datatracker.ietf.org/doc/draft-pantos-hls-rfc8216bis/)、[Apple HLS Authoring Specification](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices/)、[Apple CMAF + HLS](https://developer.apple.com/documentation/http-live-streaming/about-the-common-media-application-format-with-http-live-streaming-hls)、[hls.js 播放器/特性](https://github.com/video-dev/hls.js)、[hls.js 设计与组件](https://github.com/video-dev/hls.js/blob/master/docs/design.md)、[hls.js Custom Loader API](https://github.com/video-dev/hls.js/blob/master/docs/API.md)、[hls.js AES 实现](https://github.com/video-dev/hls.js/blob/master/src/crypt/aes-crypto.ts)、[hls.js 关于 AES-256-CTR 非 RFC 方法的讨论](https://github.com/video-dev/hls.js/discussions/5854)、[Shaka Player 插件文档](https://github.com/shaka-project/shaka-player/blob/main/docs/tutorials/plugins.md)。
References: [Service Worker fetch interception](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/fetch_event), [Dedicated Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers), [Fetch streaming](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch), [Web Crypto decryption](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/decrypt), [MSE](https://www.w3.org/TR/media-source-2/), [ISOBMFF MSE byte-stream format](https://www.w3.org/TR/mse-byte-stream-format-isobmff/), [HTTP Range semantics RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html), [HLS 2nd Edition draft-22](https://datatracker.ietf.org/doc/draft-pantos-hls-rfc8216bis/), [Apple HLS Authoring Specification](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices/), [Apple CMAF + HLS](https://developer.apple.com/documentation/http-live-streaming/about-the-common-media-application-format-with-http-live-streaming-hls), [hls.js player/features](https://github.com/video-dev/hls.js), [hls.js design/components](https://github.com/video-dev/hls.js/blob/master/docs/design.md), [hls.js Custom Loader API](https://github.com/video-dev/hls.js/blob/master/docs/API.md), [hls.js AES implementation](https://github.com/video-dev/hls.js/blob/master/src/crypt/aes-crypto.ts), [hls.js discussion of AES-256-CTR as a non-RFC method](https://github.com/video-dev/hls.js/discussions/5854), and [Shaka Player plugin docs](https://github.com/shaka-project/shaka-player/blob/main/docs/tutorials/plugins.md).
References: [Service Worker fetch interception](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/fetch_event), [Dedicated Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers), [Fetch streaming](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch), [Web Crypto decryption](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/decrypt), [MSE](https://www.w3.org/TR/media-source-2/), [ISOBMFF MSE byte-stream format](https://www.w3.org/TR/mse-byte-stream-format-isobmff/), [HTTP Range semantics RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html), [HLS 2nd Edition draft-22](https://datatracker.ietf.org/doc/html/draft-pantos-hls-rfc8216bis-22), [Apple HLS Authoring Specification](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices/), [Apple CMAF + HLS](https://developer.apple.com/documentation/http-live-streaming/about-the-common-media-application-format-with-http-live-streaming-hls), [hls.js player/features](https://github.com/video-dev/hls.js), [hls.js FetchLoader](https://github.com/video-dev/hls.js/blob/master/src/utils/fetch-loader.ts), [hls.js stream controller](https://github.com/video-dev/hls.js/blob/master/src/controller/stream-controller.ts), [hls.js transmuxer/decrypter](https://github.com/video-dev/hls.js/blob/master/src/demux/transmuxer.ts), [hls.js buffer controller](https://github.com/video-dev/hls.js/blob/master/src/controller/buffer-controller.ts), [hls.js Custom Loader API](https://github.com/video-dev/hls.js/blob/master/docs/API.md), [hls.js AES implementation](https://github.com/video-dev/hls.js/blob/master/src/crypt/aes-crypto.ts), [hls.js discussion of AES-256-CTR as a non-RFC method](https://github.com/video-dev/hls.js/discussions/5854), and [Shaka Player plugin docs](https://github.com/shaka-project/shaka-player/blob/main/docs/tutorials/plugins.md).

**源码图记录：**已在 `/Users/macbookpro/Devs/projects/lib/hls.js` 克隆 hls.js，当前 HEAD 为 `7ab7b12eefe9ef3908b3a03270e0ab610680ee84`；通过 `graphify extract --code-only --no-cluster` 建立本地图 `/Users/macbookpro/Devs/projects/lib/hls.js/graphify-out/graph.json`（3,768 个节点、11,920 条边）。Graphify 的结构图突出 `Hls`、`Fragment`、`BaseStreamController`、`BufferController` 等枢纽；随后沿上述调用链人工核对源码。Graphify 输出留在该独立 checkout，不属于本 PHP-FFMpeg 仓库。
**Source graph record:** hls.js was cloned to `/Users/macbookpro/Devs/projects/lib/hls.js`, currently at HEAD `7ab7b12eefe9ef3908b3a03270e0ab610680ee84`; `graphify extract --code-only --no-cluster` produced a local graph at `/Users/macbookpro/Devs/projects/lib/hls.js/graphify-out/graph.json` (3,768 nodes, 11,920 edges). Graphify highlighted `Hls`, `Fragment`, `BaseStreamController`, and `BufferController` as hubs; the call path above was then checked manually against the source. Graphify output remains in the separate checkout and is not part of this PHP-FFMpeg repository.

按 TV-0 → TV-1 → TV-2 → TV-3 → TV-4 → TV-5 → TV-6 → TV-8 → TV-9 顺序执行；TV-7 等维护者确认目标播放器后再运行。
Execute TV-0 → TV-1 → TV-2 → TV-3 → TV-4 → TV-5 → TV-6 → TV-8 → TV-9 in order; run TV-7 only after maintainers select target players.

在 FFmpeg 9 主基线上运行短样片命令；对具有明确旧版风险的最小用例，再在默认 Debian FFmpeg 服务复跑并记录版本差异。
Run short-sample commands on the FFmpeg 9 primary baseline; rerun the smallest cases with known older-version risks in the default Debian FFmpeg service and record version differences.

每项编码结果至少由退出码、播放列表/文件路径检查和 FFprobe 结果三部分交叉验证；播放器结果另行记录，不替代前述检查。
Cross-check each encode result using at least its exit code, playlist/file-path checks, and FFprobe results; record player results separately without using them as substitutes for these checks.

实验需要同时覆盖负向路径；预检的纯配置错误应在 FFmpeg 启动前返回，工具能力未知应返回带原因的未知结果。
Experiments must cover negative paths; configuration-only preflight errors should return before FFmpeg starts, while unknown tool capability should return an unknown result with a reason.

交付验证报告后，评审者据证据更新主 HLS SDD，并决定是否进入 API/实现设计；不以“所有命令都成功”作为批准规格的唯一标准。
After delivering the validation report, reviewers use the evidence to update the main HLS SDD and decide whether to proceed to API/implementation design; “all commands succeeded” is not the sole criterion for approving the specification.

### 预计工时与交付物
### Estimated effort and deliverables

TV-0 预计 0.25 个工程日，TV-1 预计 0.25 个工程日（可复用已完成的 FFmpeg 9 样片结果），TV-2 预计 0.5 个工程日，TV-3 预计 0.5 个工程日。
TV-0 is estimated at 0.25 engineer-days, TV-1 at 0.25 engineer-days (reusing the completed FFmpeg 9 sample results), TV-2 at 0.5 engineer-days, and TV-3 at 0.5 engineer-days.

TV-4 预计 1 个工程日，TV-5 预计 0.5 个工程日，TV-6 预计 0.5–1 个工程日；TV-0 至 TV-6 合计预计 3–5 个工程日。
TV-4 is estimated at 1 engineer-day, TV-5 at 0.5 engineer-days, and TV-6 at 0.5–1 engineer-days; TV-0 through TV-6 are estimated to take 3–5 engineer-days in total.

TV-7 在目标设备和播放器可用时预计额外需要 1–3 个工程日；若需要获取设备、测试账号或密钥服务权限，等待时间不计入工程日。
TV-7 is estimated to require an additional 1–3 engineer-days when target devices and players are available; waiting for devices, test accounts, or key-service access is excluded from engineer-day estimates.

TV-9 预计需要 2–4 个工程日完成 Docker 样片、流式记录格式、认证解密、弱网/CDN 模拟和桌面浏览器最小播放器验证；加入 iOS/Android 浏览器设备矩阵后另需 1–3 个工程日，设备与浏览器版本准备时间不计入。
TV-9 is estimated at 2–4 engineer-days for Docker samples, streaming record format, authenticated decryption, poor-network/CDN simulation, and a minimal desktop-browser player; adding iOS/Android browser-device coverage is estimated to require another 1–3 engineer-days, excluding device and browser-version setup time.

以上是计划估算，不是完成承诺；密钥 URL 鉴权、轮换故障恢复、字幕加密或播放器差异若需要额外适配，必须先记录发现，再单独估算。
These are planning estimates, not completion commitments; if key-URL authentication, rotation recovery, subtitle encryption, or player differences require additional adaptation, record the findings first and estimate that work separately.

最终交付物是一份双语验证记录，包含支持矩阵、复现命令和产物索引、失败与未知项、候选设计调整，以及需要维护者拍板的决策清单。
The final deliverable is a bilingual validation report containing the support matrix, reproduction commands and artifact index, failed and unknown cases, candidate design changes, and a list of decisions requiring maintainer approval.

## 9. 风险与回滚
## 9. Risks and rollback

第三方静态 FFmpeg 构建和不同架构构建选项可能改变实验结果；报告必须记录准确构建标识，并把“版本差异”和“构建能力差异”分开说明。
Third-party static FFmpeg builds and architecture-specific build options may change results; reports must record the exact build identifier and distinguish version differences from build-capability differences.

H.265/TS、fMP4 和 AES-128 的工具级成功不证明指定播放器兼容；未测试的目标组合保持未知，不纳入承诺范围。
Tool-level success for H.265/TS, fMP4, and AES-128 does not prove compatibility with a specific player; untested target combinations remain unknown and are excluded from commitments.

轮换实验可能产生使用不同密钥的连续分片；必须保留 K1/K2 与分片边界映射，失败时仅删除本次隔离目录，不触及已有样片或仓库文件。
Rotation experiments may produce adjacent segments encrypted with different keys; retain the K1/K2-to-segment-boundary mapping, and on failure remove only the current isolated directory without touching existing samples or repository files.

BtbN 的 GPL 静态构建仅作为当前本地技术验证工具；任何向外发布镜像或二进制的计划都需单独评估许可与分发要求。
BtbN's GPL static build is only a local technical-validation tool in this plan; any intention to distribute images or binaries externally requires a separate review of licensing and distribution requirements.

若第三方构建不可用，可改用另一可固定版本、架构覆盖相当且构建信息可审计的预编译渠道；不得因此默默改用未记录的浮动 `latest`。
If the third-party build becomes unavailable, use another prebuilt source with a pinnable version, comparable architecture coverage, and auditable build information; do not silently switch to an unrecorded floating `latest`.

## 10. 待决问题
## 10. Open questions

- [ ] 首期播放器验证应覆盖哪些播放器/设备/操作系统组合？负责人：项目维护者；进入 TV-7 前决定。
- [ ] Which player/device/operating-system combinations should first-release player validation cover? Owner: project maintainer; decide before TV-7.
- [ ] 产品要求“加密必不可少”时，是否要求 WebVTT 字幕内容也加密？本轮确认 FFmpeg 原生 HLS muxer 输出的 WebVTT 分片为明文；负责人：项目维护者，需决定增加独立加密路径或阻止明文字幕输出。
- [ ] When the product requires encryption, must WebVTT subtitle content also be encrypted? This run confirmed that WebVTT segments from the native FFmpeg HLS muxer are cleartext; the project maintainer must decide whether to add a separate encryption path or block cleartext subtitle output.
- [ ] VOD 首期是否必须支持动态密钥轮换，还是静态单密钥满足首期？负责人：项目维护者；依据 TV-4 复杂度和部署边界决定。
- [ ] Must first-release VOD support dynamic key rotation, or is a static single key sufficient? Owner: project maintainer; decide based on TV-4 complexity and deployment boundaries.
- [ ] URL 密钥是仅用作播放器可访问的 key URI，还是也必须作为 FFmpeg 获取密钥材料的来源？负责人：项目维护者；依据 TV-4 安全性和可行性决定。
- [ ] Is a URL key only a player-accessible key URI, or must it also provide key material to FFmpeg? Owner: project maintainer; decide based on TV-4 security and feasibility.
- [ ] fMP4 与 H.265 的首期支持边界是什么；若目标播放器不支持某组合，预检应阻断、警告还是标记未知？负责人：项目维护者；依据 TV-3/TV-7 决定。
- [ ] What are the first-release support boundaries for fMP4 and H.265; if a target player does not support a combination, should preflight block, warn, or report unknown? Owner: project maintainer; decide based on TV-3/TV-7.
- [ ] 是否采用 Shaka Packager 作为 Docker 化的 CBCS HLS 打包后端；生产环境通过哪种受保护的密钥服务/provider 取得 key、KID 和 FairPlay 信令？负责人：项目维护者；依据 TV-8 决定。
- [ ] Should Shaka Packager be adopted as the Dockerized CBCS HLS packaging backend, and which protected key service/provider will supply keys, KIDs, and FairPlay signaling in production? Owner: project maintainer; decide based on TV-8.
- [ ] 是否接受“自定义 Web 播放器 + AES-CTR 流式/记录式加密”作为无 DRM 的 Web 输出模式，以及其不默认支持 iOS/Android 原生 HLS 播放器的边界？负责人：项目维护者；依据 TV-9 实验和目标播放器矩阵决定。
- [ ] Is a custom web player with streaming/record-based AES-CTR encryption acceptable as a no-DRM web output mode, including the limitation that native iOS/Android HLS players are not supported by default? Owner: project maintainer; decide based on TV-9 and the target-player matrix.
- [ ] 多目标输出是否要求全部成功后原子发布，还是允许返回部分成功及产物清单？负责人：项目维护者；依据 TV-5 失败实验决定。
- [ ] Must multi-target output publish atomically only after all targets succeed, or may it return partial success and an artifact manifest? Owner: project maintainer; decide based on TV-5 failure experiments.
- [ ] M3U8 JSON 是否要求保留未知标签和原始顺序，还是可以定义受限字段模式？负责人：项目维护者；依据 TV-6 解析试验决定。
- [ ] Must M3U8 JSON preserve unknown tags and original order, or may it define a restricted field model? Owner: project maintainer; decide based on TV-6 parser experiments.

## 11. 实施记录
## 11. Implementation notes

本轮 TV-0、TV-2、TV-3、TV-4 已取得所述工具级结论；TV-1 部分复用既有结果，TV-5 仅验证 CLI 滤镜顺序和独立目录，TV-6 的 JSON/预检实现和 TV-7 播放器验证仍未完成，因此本 SDD 保持 `Implementing`。
This run obtained the stated tool-level findings for TV-0, TV-2, TV-3, and TV-4; TV-1 partially reuses earlier results, TV-5 only validates CLI filter ordering and separate directories, and TV-6 JSON/preflight implementation and TV-7 player testing remain incomplete, so this SDD remains `Implementing`.

TV-9 第一阶段隔离 Demo 已完成 Docker 构建和桌面浏览器验证；应用代码、Docker 配置、操作说明及忽略的输出目录位于 [`experiments/hls-ctr-demo/`](../../experiments/hls-ctr-demo/README.md)。浏览器流式验证使用 Node `24.21.0`、npm `11.19.0`、基础镜像索引摘要 `sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`、FFmpeg `n9.0.2-14-gebafaee10a-20260928` 和 hls.js `1.7.3` 构建的镜像，镜像 ID 为 `sha256:e8430b61eae082416a601b5ae1a8803613903626812138bab2e62382206096e0`；npm 构建阶段及独立锁文件审计均报告 `0 vulnerabilities`。样片为 8 秒、H.264 High、854×480、yuv420p；该次明文分片 547,810 字节，密文分片 548,314 字节，包含 9 个认证记录和 2 个 `moof`。在隔离 Chromium 浏览器中将下载限速为 128 KiB/s，并在第一个认证记录后中断连接：播放器以 Range 续传，约 2.20 秒出现首个解码帧，约 4.32 秒才完成整片下载；明文 SHA-256 与基准一致，播放未报告 `bufferStalledError`，篡改记录的认证检查被拒绝。归档报告和该次运行数据位于忽略目录的 `output/ctr-stream-session-report.json`；当前重建镜像 ID 为 `sha256:9d43442a70131a81f5317be7184773b1bf3eba86a75477ea3bf507c0acbfeee4`。
The isolated first-phase TV-9 Demo has completed its Docker build and desktop-browser validation; its application code, Docker configuration, instructions, and ignored output directory are under [`experiments/hls-ctr-demo/`](../../experiments/hls-ctr-demo/README.md). The streaming browser run used an image built with Node `24.21.0`, npm `11.19.0`, base-image index digest `sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`, FFmpeg `n9.0.2-14-gebafaee10a-20260928`, and hls.js `1.7.3`; its image ID was `sha256:e8430b61eae082416a601b5ae1a8803613903626812138bab2e62382206096e0`. Both the npm build-stage audit and separate lockfile audit reported `0 vulnerabilities`. The sample was 8 seconds of H.264 High at 854×480, yuv420p; that run's clear fragment was 547,810 bytes, its encrypted fragment was 548,314 bytes, and it contained 9 authenticated records and 2 `moof` boxes. In isolated Chromium throttled to 128 KiB/s, the connection was interrupted after the first authenticated record: the player resumed with Range, decoded its first frame at about 2.20 seconds, and completed the full fragment download at about 4.32 seconds. The cleartext SHA-256 matched the baseline, playback reported no `bufferStalledError`, and authentication rejected a tampered record. The archived report and run data are in the ignored `output/ctr-stream-session-report.json`; the currently rebuilt image ID is `sha256:9d43442a70131a81f5317be7184773b1bf3eba86a75477ea3bf507c0acbfeee4`.

已借用 tools_vue 的 RustFS 临时 bucket 验证最终密文对象的 Range 行为：`bytes=65592-131183` 返回 HTTP `206`、`Content-Range: bytes 65592-131183/548314` 和 65,592 字节响应体；响应体与本地产物相同偏移的字节逐字节一致。验证后已删除本轮创建的临时 bucket。此项只验证 RustFS S3 兼容端点的字节范围读取，不代表浏览器经 CDN、真实公网链路或真实 RustFS 部署的端到端验证。
The final encrypted object was tested through a temporary bucket in tools_vue's RustFS: `bytes=65592-131183` returned HTTP `206`, `Content-Range: bytes 65592-131183/548314`, and a 65,592-byte body; every byte matched the same range of the local artifact. The temporary bucket created for this run was deleted afterward. This verifies byte-range reads through the RustFS S3-compatible endpoint only; it is not an end-to-end test through a browser, CDN, public network, or production RustFS deployment.

首轮播放器验证只覆盖隔离 Chromium 与单个 H.264 480p 样片；下文记录的追加实验分别验证了本机 HEVC 能力边界，以及未加密 H.264 多档清单的手动切档。仍未覆盖 iOS/Android、CDN 缓存语义、生产密钥服务、密钥轮换或真实高丢包公网网络；CTR 加密多档与自动 ABR 也未完成验证。本 SDD 继续保持 `Implementing`。
The first player run covered only isolated Chromium and a single H.264 480p sample; the follow-up experiments below separately checked the local HEVC capability boundary and manual rendition switching for a clear H.264 multi-rendition playlist. iOS/Android, CDN cache semantics, a production key service, key rotation, and a real high-loss public network remain untested; CTR-encrypted multi-rendition playback and automatic ABR are also unverified. This SDD remains `Implementing`.

后续补充验证生成了 FFmpeg 9 H.265 Main、854×480、yuv420p 的 fMP4 HLS 样片；FFprobe 能识别 HEVC 视频流。验证所用 Headless Chromium 的 `MediaSource.isTypeSupported` 对 H.264 `avc1` 返回 `true`，对 HEVC `hvc1` 与 `hev1` 返回 `false`，`canPlayType` 对 `hvc1` 返回空字符串。通过页面尝试播放时，hls.js 报告致命 `bufferAddCodecError`，因此该浏览器环境无法完成 H.265 MSE 播放验证。此结果只界定本次 Linux Chromium 环境，不可外推到支持 HEVC 的操作系统、设备或浏览器。
A follow-up generated an FFmpeg 9 H.265 Main, 854×480, yuv420p fMP4 HLS sample; FFprobe recognized its HEVC video stream. In the Headless Chromium used for this validation, `MediaSource.isTypeSupported` returned `true` for H.264 `avc1` and `false` for HEVC `hvc1` and `hev1`; `canPlayType` returned an empty string for `hvc1`. Attempting playback from the page caused hls.js to report a fatal `bufferAddCodecError`, so H.265 MSE playback could not be validated in this browser environment. This result describes only this Linux Chromium environment and cannot be generalized to operating systems, devices, or browsers with HEVC support.

另生成了 H.264 360p、480p、720p 三档清晰 fMP4 HLS；主播放列表报告三档带宽约为 487 kbit/s、956 kbit/s、1.89 Mbit/s，四个分片的时长在各档均为 2.002 秒，各媒体播放列表含 `EXT-X-INDEPENDENT-SEGMENTS`。hls.js 1.7.3 在 Chromium 中解析出三档，强制切换后依次成功缓冲 level 0、2、1（360p→720p→480p），期间没有致命 hls.js 错误。这验证了清晰 H.264 多档清单和手动 rendition 切换的 MSE 缓冲路径；它不是自动带宽估算/自适应决策测试，也没有将多档输出接入本 Demo 的 CTR sidecar 与自定义 loader。自动 ABR、播放中真实画面分辨率切换，以及 CTR 加密多档仍待验证。
A separate clear H.264 fMP4 HLS set was generated at 360p, 480p, and 720p. The master playlist reports bandwidths of about 487 kbit/s, 956 kbit/s, and 1.89 Mbit/s; all four segments in each rendition are 2.002 seconds long, and each media playlist includes `EXT-X-INDEPENDENT-SEGMENTS`. hls.js 1.7.3 parsed all three levels in Chromium and successfully buffered forced level changes in the order 0, 2, 1 (360p→720p→480p), without a fatal hls.js error. This validates the MSE buffering path for a clear H.264 multi-rendition playlist and manual rendition switching. It does not test automatic bandwidth estimation/adaptation, visible resolution changes during playback, or multi-rendition integration with this Demo's CTR sidecar and custom loader; those remain unverified.

追加自动 ABR 试验保持 hls.js 自动选档开启且未设置手动 level：初始链路限速 `128 KiB/s`，首个分片缓冲后将服务端限速提高至 `5000 KiB/s`。命令行浏览器试验和新增页面内试验均先缓冲 level 1（480p），随后自动切到 level 2（720p）；页面内试验还观察到视频尺寸由 854×480 变为 1280×720，且没有记录 hls.js 错误。单独命令行试验期间曾记录一次非致命 `bufferStalledError`，因此不承诺升档过程始终无停顿。此结果证明模拟带宽提升时的自动升档路径，但未验证低带宽方向的自动降档。限速已恢复为 0；报告见忽略目录 `experiments/hls-ctr-demo/output/auto-abr-report.json`。
An additional automatic-ABR test kept hls.js auto selection enabled and did not set a manual level. The initial link was limited to `128 KiB/s`; after the first segment buffered, the server limit was raised to `5000 KiB/s`. Both the command-line browser run and the new page-driven run first buffered level 1 (480p), then automatically switched to level 2 (720p); the page-driven run also observed the video size change from 854×480 to 1280×720 and recorded no hls.js error. One nonfatal `bufferStalledError` occurred during the separate command-line run, so a stall-free upswitch is not guaranteed. This demonstrates the automatic upswitch path under a simulated bandwidth increase, but does not validate automatic downswitching under lower bandwidth. The limit was restored to 0. The report is in the ignored `experiments/hls-ctr-demo/output/auto-abr-report.json` file.

首页现提供独立的编解码与 ABR 测试页，地址为 `http://localhost:8789/codec-abr`；HTTP 服务就绪后，容器在后台从只读挂载的样片生成三档 H.264 清晰 HLS 和三个 HEVC 清晰 HLS 样片。该页面能显示当前浏览器的 MSE codec 能力、自动播放并按模拟带宽变化切档，也能分别尝试 HEVC 样片；样片生成期间会显示进度，并在全部就绪后启用播放控件。它将 CTR 加密单档播放器与清晰多档兼容性试验分开验证。Playwright npm 依赖保存在 Docker 命名卷 `phpffmpeg-playwright-pkg`，后续临时浏览器容器可复用该依赖而无需重复安装。
The home page now links to a separate codec and ABR test page at `http://localhost:8789/codec-abr`. After the HTTP service is ready, the container generates three clear H.264 renditions and three clear HEVC samples from the read-only mounted video in the background. The page displays the browser's MSE codec capabilities, plays automatically and switches levels as simulated bandwidth changes, and can attempt each HEVC sample; it shows generation progress and enables playback after all fixtures are ready. It keeps clear multi-rendition compatibility tests separate from the single-rendition CTR-encrypted player. The Playwright npm package is stored in the Docker named volume `phpffmpeg-playwright-pkg`, so later temporary browser containers can reuse it without reinstalling it.

根据维护者澄清的目标，现从原始 3840×2160 视频缩放到 1280×720，并生成 CRF 32、30、28 三份 HEVC HLS 样片；每份取前 8 秒，使用 libx265 `ultrafast` 和 yuv420p。FFprobe 对三档均报告 HEVC Main、`hev1`、1280×720、约 8.108 秒；playlist、初始化段和四个媒体分片合计分别为 1,068,015、1,348,696、1,706,812 字节，CRF 越低输出越大。具体 SHA-256 与探测记录见忽略目录 `experiments/hls-ctr-demo/output/hevc-crf-report.json`，播放清单分别为 `hevc-crf-32.m3u8`、`hevc-crf-30.m3u8`、`hevc-crf-28.m3u8`。
Following the maintainer's clarification, the original 3840×2160 video is scaled to 1280×720 to create three HEVC HLS samples at CRF 32, 30, and 28. Each uses the first 8 seconds, libx265 `ultrafast`, and yuv420p. FFprobe reports HEVC Main, `hev1`, 1280×720, and about 8.108 seconds for all three; the playlist, initialization segment, and four media segments total 1,068,015, 1,348,696, and 1,706,812 bytes respectively, increasing as CRF decreases. SHA-256 values and probe records are in the ignored `experiments/hls-ctr-demo/output/hevc-crf-report.json`; the playlists are `hevc-crf-32.m3u8`, `hevc-crf-30.m3u8`, and `hevc-crf-28.m3u8`.

当前 Linux Headless Chromium 的编解码能力结果仍是 HEVC MSE 不支持；在新增的 720p CRF 32 样片上，页面播放尝试仍触发 hls.js 致命 `bufferAddCodecError`。维护者反馈其本机 Chrome 可以播放 HEVC，但该主机环境尚未通过此页面记录 UA、MSE 能力和实际 720p HLS 播放结果；因此主机 Chrome 的播放反馈与容器 Chromium 的限制均保留为各自环境证据，不相互外推。
The Linux Headless Chromium result remains that HEVC MSE is unsupported; attempting the new 720p CRF 32 sample from the page still produced a fatal hls.js `bufferAddCodecError`. The maintainer reports that HEVC plays in their host Chrome, but that host environment has not yet recorded its user agent, MSE capability, and actual 720p HLS playback through this page. The host Chrome report and the container Chromium limitation are therefore kept as environment-specific evidence and are not generalized across environments.

现有样片验证产物保存在仓库外的 `/private/tmp/php-ffmpeg/ffmpeg9`；后续验证必须使用本规格定义的新隔离子目录。
Existing sample-validation artifacts are outside the repository at `/private/tmp/php-ffmpeg/ffmpeg9`; future validation must use new isolated subdirectories defined by this specification.

TV-9 的 HEVC CTR 首轮实验已接入隔离 Demo：首页可选择从 4K 源缩放得到的 720p HEVC Main、yuv420p、CRF 32/30/28 清单；每个清晰初始化段保持明文，每个合并后的媒体分片以 sidecar 描述的 AES-128-CTR 认证记录加密。hls.js 自定义 fragment loader 按网络流读取记录，Dedicated Worker 先验证 HMAC、再解密，并通过 progressive `onProgress` 把明文增量交给 hls.js/MSE；sidecar 保存对应清晰分片的 SHA-256、字节数和 `moof` 数量。
The first HEVC CTR experiment for TV-9 is integrated into the isolated Demo. The home page offers HEVC Main, yuv420p, 720p playlists at CRF 32, 30, and 28, scaled from the 4K source; each clear initialization segment remains unencrypted, while each combined media fragment is encrypted as AES-128-CTR authenticated records described by its sidecar. The hls.js custom fragment loader reads records from the network stream, and a Dedicated Worker verifies each HMAC before decrypting and incrementally passing clear bytes to hls.js/MSE through progressive `onProgress`; each sidecar stores the matching clear-fragment SHA-256, byte count, and `moof` count.

在隔离 Playwright Chromium（HeadlessChrome `153.0.8010.12`，localhost 安全上下文）中，三档分片分别通过 Worker 校验并解密 17、21、26 条记录，明文字节数分别为 1,064,155、1,344,836、1,702,952；计算出的 SHA-256 分别为 `6192d5b70b6756f2c14163ebcd6b6a35738376d6ee3e7fec4ae15a6f20be3cb9`、`92015fd3227b915261dde1a140a4d7aba50c2026888664a06ef8621b93d10636`、`a1440554e3fba3a1897c509824cd16431925559ab7327dd907ad4bc2c5d4c531`，均与 sidecar 基线相同；首条解密记录均早于完整网络响应结束。实际 hls.js 播放尝试也观察到第一条已认证 HEVC 明文记录，但该 Chromium 对 `hev1.1.6.L93.90` 的 `MediaSource.isTypeSupported` 返回不支持，随后报致命 `bufferAddCodecError` 并取消分片请求。因此 CTR 记录、Worker 增量解密和明文一致性已验证；此环境中的 HEVC MSE append 与可见播放未通过，不能记为 HEVC 播放成功。维护者本机 Chrome 的 720p 播放仍待在该页面单独记录。明文 init、私有 sidecar/密钥接口、固定演示密钥均属当前 Demo 限制。
In isolated Playwright Chromium (HeadlessChrome `153.0.8010.12`, using a secure localhost context), the three variants were authenticated and decrypted by the Worker as 17, 21, and 26 records, with clear byte counts of 1,064,155, 1,344,836, and 1,702,952 respectively. Their calculated SHA-256 values are `6192d5b70b6756f2c14163ebcd6b6a35738376d6ee3e7fec4ae15a6f20be3cb9`, `92015fd3227b915261dde1a140a4d7aba50c2026888664a06ef8621b93d10636`, and `a1440554e3fba3a1897c509824cd16431925559ab7327dd907ad4bc2c5d4c531`; all match their sidecar baselines. Each first decrypted record arrived before the full network response ended. The actual hls.js playback attempt also observed the first authenticated clear HEVC record, but this Chromium rejects `hev1.1.6.L93.90` in `MediaSource.isTypeSupported`, then reports fatal `bufferAddCodecError` and cancels the fragment request. CTR records, incremental Worker decryption, and clear-byte integrity are verified; HEVC MSE append and visible playback did not pass in this environment, so this is not a successful HEVC playback result. The maintainer's host Chrome still needs a separate recorded 720p playback attempt on this page. Clear init segments, private sidecar/key endpoints, and fixed demo keys remain Demo limitations.

维护者随后在 macOS Chrome `154.0.0.0`（UA 报告 macOS 10.15.7）通过同一隔离页面播放了 CTR 流。该次运行的解密明文哈希为 `92015fd3227b915261dde1a140a4d7aba50c2026888664a06ef8621b93d10636`，与 HEVC 720p CRF 30 sidecar 的基线一致；hls.js 报告收到 1,346,012 字节，与该变体 1,344,836 字节明文加 21 条记录各 56 字节开销相符。因此该次实际播放的是经 Worker 验证解密的 HEVC CRF 30 分片，不是清晰样片，也不是 H.264 默认样片。首条已认证明文在 0.649 秒交付，首个画面在 2.703 秒呈现，完整密文响应在 10.485 秒结束，证明在该 Chrome 环境中 CTR 解密播放早于整片下载完成。128 KiB/s 限速下约 6.517 秒出现一次非致命 `bufferStalledError`（当时缓冲余量约 0.139 秒）；本次证明播放/解密链路可用，不证明该限速下可无卡顿播放。页面旧版 `demo-environment` 行记录的是固定 H.264 基线统计，不能代表所选流；播放器源码已增加所选清单 URI、明确命名的 H.264 基线字段及实际 sidecar 元数据日志，以避免混淆。

The maintainer then played a CTR stream through the same isolated page in macOS Chrome `154.0.0.0` (the reported user agent identifies macOS 10.15.7). The decrypted cleartext hash was `92015fd3227b915261dde1a140a4d7aba50c2026888664a06ef8621b93d10636`, matching the HEVC 720p CRF 30 sidecar baseline; hls.js reported 1,346,012 received bytes, which matches that variant's 1,344,836 clear bytes plus 56 bytes of framing overhead for each of its 21 records. This identifies the actual stream as the Worker-authenticated and decrypted HEVC CRF 30 sample, rather than a clear sample or the default H.264 sample. The first authenticated clear record was delivered at 0.649 seconds, the first frame appeared at 2.703 seconds, and the full encrypted response completed at 10.485 seconds, demonstrating CTR-decrypted playback before the whole fragment had downloaded in this Chrome environment. At the 128 KiB/s throttle, a nonfatal `bufferStalledError` occurred at about 6.517 seconds with about 0.139 seconds of buffer remaining; this run demonstrates that the playback/decryption path works, but does not demonstrate stall-free playback at that rate. The older page's `demo-environment` line reports fixed H.264 baseline statistics and does not describe the selected stream; the player source now logs the selected playlist URI, explicitly labeled H.264 baseline fields, and the active sidecar metadata to avoid this ambiguity.

该次 `bufferStalledError` 已按样片码率复核：8.108 秒的 HEVC CRF 30 加密分片为 1,346,012 字节，平均需约 162.1 KiB/s 才能以实时速度传输；CRF 32 和 CRF 28 分别约需 128.3 与 205.3 KiB/s。页面限速 128 KiB/s 低于 CRF 30/28 的持续需求（CRF 32 也没有可用余量），因此缓冲到约 3.97 秒后降至 0.136 秒并触发 stall，符合带宽不足而非 CTR 校验失败。播放器默认网络限速已调整为 512 KiB/s，并在界面列出各 CRF 样片的平均需求；建议 256 KiB/s 以上进行 HEVC 连续播放，128 KiB/s 保留为弱网压力测试。

The `bufferStalledError` was checked against the sample bitrates: the 8.108-second encrypted HEVC CRF 30 fragment is 1,346,012 bytes and needs about 162.1 KiB/s on average for real-time transfer; CRF 32 and CRF 28 need about 128.3 and 205.3 KiB/s respectively. The page's 128 KiB/s throttle is below the sustained rate required by CRF 30/28 (and leaves no headroom for CRF 32), so the buffer falling to 0.136 seconds near 3.97 seconds and stalling is consistent with insufficient bandwidth, not CTR authentication failure. The player's default network limit is now 512 KiB/s, and the page displays the average rate required by each CRF sample; 256 KiB/s or more is recommended for continuous HEVC playback, while 128 KiB/s remains available as a weak-network stress test.

为区分“HTTP 仍在收密文”和“hls.js 已解析并向 MSE 追加可播放媒体”，Demo 现记录 `FRAG_PARSING_DATA`、`BUFFER_APPENDING`、`BUFFER_APPENDED`、视频 `waiting/playing` 与按秒缓冲区间；`bufferStalledError` 日志也带有当前播放位置、缓冲区间和余量。重新构建后应先以默认 512 KiB/s 播放确认持续播放，再显式选择 128 KiB/s 复现限速压力；若网络接收字节持续增加而 MSE 缓冲终点不增加，下一步应检查分片边界解析/追加；若缓冲终点增长但播放只在低速时暂停，则是带宽跟不上样片码率。

To distinguish “the HTTP response is still receiving ciphertext” from “hls.js has parsed and appended playable media to MSE,” the Demo now logs `FRAG_PARSING_DATA`, `BUFFER_APPENDING`, `BUFFER_APPENDED`, video `waiting`/`playing`, and buffered ranges once per second; `bufferStalledError` entries also include the current time, buffered ranges, and buffer ahead. After rebuilding, first use the default 512 KiB/s to confirm continuous playback, then explicitly select 128 KiB/s to reproduce the throttle stress case. If received network bytes continue increasing while the MSE buffer end does not, inspect fragment-boundary parsing/appending next; if the buffer end advances while playback pauses only at the lower rate, the network is below the sample's bitrate.

维护者随后提供的 HEVC CRF 32 播放日志显示：一条 1,065,107 字节的加密 HTTP 分片完整下载并通过哈希校验后，MSE 缓冲终点仍只有 4.171 秒；第三次媒体追加时缓冲范围从 3.971 秒回退为 2.069 秒。由此可知，128 KiB/s 限速确实会造成缓冲耗尽，但不是最终只缓冲约一半时长的唯一原因。FFprobe 对挂载的原始 `26.mp4` 报告 76.209 秒；Demo 的 `-t 8` 输出 H.264 8.008 秒、HEVC 8.108 秒，所以源内容不是 4 秒。旧 HEVC 测试清单只有一个 `EXTINF:8.108` 和一个 `.m4s`，这是 Demo 为早期 progressive 实验把四个约 2 秒 fMP4 分片合并所致；`EXT-X-TARGETDURATION:9` 是 HLS 的整数目标时长字段，不是精确总片长，精确时长来自 `EXTINF`。HEVC CTR 输出现已改为四个独立加密媒体分片，每段使用独立 sidecar/contentId，并保留原始约 2 秒 HLS 边界。隔离 Chromium 中对全部 12 个密文片段逐条流式解密后，各自 SHA-256 均与 sidecar 相同；三档清单都包含 4 个分片，`EXTINF` 为 2.002、2.002、2.002、2.102 秒，总计 8.108 秒，`EXT-X-TARGETDURATION:2`。由于此 Linux Chromium 不支持 HEVC MSE，分段后的完整时间线和播放恢复仍需在支持 HEVC MSE 的 macOS Chrome 验证。

The maintainer's subsequent HEVC CRF 32 playback log shows that after one 1,065,107-byte encrypted HTTP fragment finished downloading and passed its hash check, the MSE buffer still ended at 4.171 seconds; on the third media append, the buffered range moved backward from 3.971 to 2.069 seconds. The 128 KiB/s throttle therefore contributes to buffer exhaustion, but does not alone explain why only about half the duration was ultimately buffered. FFprobe reports the mounted source `26.mp4` as 76.209 seconds; the Demo's `-t 8` outputs are 8.008 seconds for H.264 and 8.108 seconds for HEVC, so the source is not four seconds. The former HEVC test playlist had one `EXTINF:8.108` and one `.m4s` because the Demo merged four approximately two-second fMP4 segments for the earlier progressive experiment. `EXT-X-TARGETDURATION:9` is the integer target-duration field in HLS, not the exact total duration; `EXTINF` carries the precise segment duration. HEVC CTR output now has four independently encrypted media segments with a separate sidecar/contentId for each, preserving the original approximately two-second HLS boundaries. In isolated Chromium, all 12 encrypted media segments across the three CRF variants were streamed through Worker decryption and each clear SHA-256 matched its sidecar. Every playlist contains four segments with `EXTINF` values of 2.002, 2.002, 2.002, and 2.102 seconds, totaling 8.108 seconds, and `EXT-X-TARGETDURATION:2`. Since this Linux Chromium does not support HEVC MSE, the full timeline and playback recovery with the segmented output still need validation in macOS Chrome with HEVC MSE support.

维护者随后反馈：HEVC 分段版可播放完整 8 秒，而原 H.264 CTR 版仍只播放约 4 秒。原因是 H.264 的 `demo.m3u8` 仍沿用早期试验格式，将两个约 4 秒 fMP4 分片合并成一个含两个 `moof` 的 `.m4s`；此前 MSE 日志已显示后续 append 未将缓冲时间线延伸到 8 秒。现将 H.264 CTR 清单也改为两个独立加密的约 4 秒媒体分片，各有 sidecar/contentId；保留首段 `encrypted-0.m4s` 名称以兼容篡改认证测试。修改后需再由用户 Chrome 确认 H.264 播放到约 8.008 秒，并验证两个分片各自完成解密和哈希匹配。

The maintainer then reported that the segmented HEVC version plays the full eight seconds while the original H.264 CTR version still plays only about four. The H.264 `demo.m3u8` still used the earlier experimental layout, merging two approximately four-second fMP4 segments into one `.m4s` containing two `moof` boxes; prior MSE logs showed that later appends did not extend the buffered timeline to eight seconds. The H.264 CTR playlist is now also changed to two independently encrypted, approximately four-second media segments, each with its own sidecar/contentId; the first segment retains the name `encrypted-0.m4s` for the tamper-authentication test.

在重打包后的 H.264 CTR 清单上，隔离 Headless Chromium 已分别加载 `encrypted-0.m4s` 与 `encrypted-1.m4s`，两段 Worker 解密哈希分别为 `0ee59d6b3cecc62a154b93376178134f18471e619918f47c471c66ed2ff014f9` 和 `84a10fabf3f91e4b5a3a1f559bb434debbabc1a63cb78acec3e7343022f95609`，均与各自 sidecar 相同；MSE 时间范围最终达到 8.075 秒，`video.ended` 为 `true`。播放位置约 4.05 秒时记录到一次 `bufferStalledError`，但当时日志显示仍有约 4.03 秒已缓冲，事件后约 0.38 秒出现 `video-playing`，最终正常播完。新清单 `demo.m3u8` 包含两个 `EXTINF:4.004` 和 `EXT-X-TARGETDURATION:4`；这验证了原先只到 4 秒的问题来自合并式 fMP4 分片路径，而非 H.264 流本身只有 4 秒。

On the repackaged H.264 CTR playlist, isolated Headless Chromium loaded both `encrypted-0.m4s` and `encrypted-1.m4s`. Their Worker-decrypted hashes were `0ee59d6b3cecc62a154b93376178134f18471e619918f47c471c66ed2ff014f9` and `84a10fabf3f91e4b5a3a1f559bb434debbabc1a63cb78acec3e7343022f95609`; both match their sidecars. The final MSE time range reached 8.075 seconds and `video.ended` was `true`. One `bufferStalledError` was logged near playback time 4.05 seconds, but the log showed about 4.03 seconds already buffered; `video-playing` followed about 0.38 seconds later, and playback reached the end. The new `demo.m3u8` contains two `EXTINF:4.004` entries and `EXT-X-TARGETDURATION:4`. This confirms that the earlier four-second playback limit came from the merged fMP4 segment path, not from the H.264 stream being only four seconds long.

FFmpeg 官方格式文档说明 `hls_key_info_file` 的密钥 URI、密钥文件路径和可选 IV 分行配置，并说明启用 `periodic_rekey` 后会周期检测 key-info 更新；本轮已在固定构建上验证外部更新可切换后续分片密钥。
The official FFmpeg formats documentation describes the key URI, key-file path, and optional IV as separate lines in `hls_key_info_file`, and says `periodic_rekey` periodically checks for key-info updates; this run verified on the pinned build that an external update switches keys for subsequent segments.

参考： [FFmpeg Formats Documentation — HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls-2)。
Reference: [FFmpeg Formats Documentation — HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls-2).

### TV-9 RustFS 直连播放与断点续传验证
### TV-9 RustFS Direct Playback and Resume Validation

2026-10-06，本地借用 tools_vue 项目的 RustFS，在临时隔离 bucket 中存放当前 H.264 CTR Demo 的两个实际加密 fMP4 分片；浏览器直接从 RustFS S3 HTTP 端点读取分片，页面、M3U8、初始化分片、sidecar 和测试密钥仍由 Demo 服务提供。临时 bucket 配置了仅允许读取对象的匿名策略及仅针对本次本地测试 Origin 的 CORS，测试完成后 bucket、对象和临时 sidecar/清单均已删除或还原。
On 2026-10-06, the tools_vue project's RustFS was borrowed for a local test; the two actual encrypted fMP4 segments from the H.264 CTR Demo were stored in an isolated temporary bucket. The browser fetched media segments directly from the RustFS S3 HTTP endpoint, while the Demo service continued to provide the page, M3U8, initialization segment, sidecars, and test keys. The temporary bucket used an anonymous read-only object policy and CORS limited to the local test origin; the bucket, objects, and temporary sidecar/playlist changes were deleted or restored after testing.

在隔离 Playwright Chromium `HeadlessChrome/153.0.8010.12` 中使用 80 ms 网络延迟和 192 KiB/s 下行限速，并在第一个 H.264 密文分片收到并认证首条记录后触发中断。浏览器直接对 RustFS 请求 `Range: bytes=65592-` 和原 ETag 的 `If-Range`；RustFS 返回 `206`、`Content-Range: bytes 65592-234012/234013`，续传部分与已收部分拼接后通过 HMAC 记录验证及 clear-fragment SHA-256 校验。首、次 H.264 分片解密 SHA-256 分别为 `0ee59d6b3cecc62a154b93376178134f18471e619918f47c471c66ed2ff014f9` 和 `84a10fabf3f91e4b5a3a1f559bb434debbabc1a63cb78acec3e7343022f95609`，均匹配 sidecar；MSE 缓冲时长达到 8.075 秒，视频正常 ended。第一帧出现在首段完整下载完成后约 0.05 秒，因此本次验证证明了 RustFS 记录边界续传及完整播放，但未证明首段下载完成前即可开始播放。约 4.09 秒时另记录到一次非致命 `bufferStalledError`，尽管缓冲终点已达 8.075 秒；播放器约 0.4 秒后恢复并正常播完。
In isolated Playwright Chromium `HeadlessChrome/153.0.8010.12`, the test used 80 ms network latency and a 192 KiB/s download limit, then interrupted the first H.264 encrypted segment after its first record had arrived and authenticated. The browser requested `Range: bytes=65592-` from RustFS with the original ETag in `If-Range`; RustFS returned `206` and `Content-Range: bytes 65592-234012/234013`. The resumed bytes joined with the first response and passed record HMAC verification and the clear-fragment SHA-256 check. The decrypted hashes for the first and second H.264 segments were `0ee59d6b3cecc62a154b93376178134f18471e619918f47c471c66ed2ff014f9` and `84a10fabf3f91e4b5a3a1f559bb434debbabc1a63cb78acec3e7343022f95609`; both matched their sidecars. MSE buffered 8.075 seconds and the video ended normally. The first frame appeared about 0.05 seconds after the first segment finished downloading, so this run proves RustFS record-boundary resume and full playback, but does not prove playback starts before the first segment finishes downloading. A nonfatal `bufferStalledError` was also logged near 4.09 seconds even though the buffer already extended to 8.075 seconds; playback recovered about 0.4 seconds later and ended normally.

RustFS 另通过了带有效单范围的 `206`、后缀 Range 的 `206` 和越界 Range 的 `416` 检查；但对故意提供的过期 `If-Range` 值，RustFS 仍返回 `206`，而不是 HTTP Range 语义要求的完整 `200` 响应。因此播放器必须继续比对恢复响应的 ETag，并拒绝与原实体不同的分片；当前逻辑会失败关闭，但不会自动从字节 0 重启该片段。当前证据证明本地 RustFS 直连的 H.264 CTR 浏览器播放及同一实体的记录边界续传可用，尚未验证生产 RustFS 配置、CDN 行为、真实公网丢包及移动端播放。
RustFS also passed checks for a valid single-range `206`, a suffix-range `206`, and an out-of-bounds `416`; however, when deliberately given a stale `If-Range` value, RustFS still returned `206` instead of the full `200` response required by HTTP range semantics. The player must therefore keep comparing the ETag on resumed responses and reject a segment whose entity differs from the original; the current logic fails closed but does not automatically restart that segment from byte zero. This evidence validates local direct-from-RustFS H.264 CTR browser playback and record-boundary resume for the same entity; production RustFS configuration, CDN behavior, real public-network packet loss, and mobile playback remain untested.

进一步将浏览器下行限速到 `64 KiB/s` 并使用相同的 RustFS 直连分片：Worker 在播放请求开始后约 2.134 秒收到并认证第一条明文记录，第一段密文到约 4.676 秒才全部下载完成，首个解码帧在约 4.714 秒出现，视频仍正常播放至 8.075 秒结束。这证明记录级解密在该链路上能持续跟进网络，但 H.264 当前每段约 4 秒的 `moof`/`mdat` 布局下，MSE 直到整段下载完才收到媒体追加；本次没有证明可以在当前 HLS 分片下载完成前开始播放。第二段下载期间在约 3.936 秒发生一次非致命缓冲停顿，缓冲余量约 0.135 秒；第二段下载并追加后恢复播放。该 64 KiB/s 用例只能证明恢复并播完，不代表全程无卡顿。
The browser download was then throttled to `64 KiB/s` while fetching the same RustFS-backed segments: the Worker received and authenticated the first clear record about 2.134 seconds after playback started, the first encrypted segment finished downloading at about 4.676 seconds, and the first decoded frame appeared at about 4.714 seconds. Playback still reached the end at 8.075 seconds. This proves record-level decryption can keep up with network delivery in this path, but with the current H.264 segments of about four seconds each and their `moof`/`mdat` layout, MSE received the media append only after the whole segment had downloaded; this run does not prove playback can start before the current HLS segment is complete. During the second-segment download, a nonfatal stall occurred near 3.936 seconds with about 0.135 seconds of buffer remaining; playback resumed after the second segment was downloaded and appended. The 64 KiB/s case proves recovery and completion, not uninterrupted playback.

另通过浏览器端实际改变对象版本来验证 ETag 保护：先以旧 ETag 下载并认证首条记录，在播放器发起 `Range: bytes=65592-` 前将 RustFS 中对象内容替换为同长度的新版本；RustFS 对带旧 `If-Range` 的续传仍返回 `206` 和新 ETag。播放器检测到响应 ETag 与原 ETag 不同，记录 `Range resume response did not match the original object and record boundary` 并拒绝继续拼接；因此在对象被替换的竞态下，当前实现可证明不会把两个版本的密文混合解密，但会失败并且不会自动从头重试。该检查通过后，包含仅在测试 bucket 范围内临时开放的写权限之 bucket 已删除。
The ETag guard was also exercised from the browser by changing the object version: after downloading and authenticating the first record with the old ETag, the RustFS object was replaced with a same-length new version before the player issued `Range: bytes=65592-`. RustFS still returned `206` for the resume request with the old `If-Range`, but supplied the new ETag. The player detected that the response ETag differed from the original, logged `Range resume response did not match the original object and record boundary`, and refused to concatenate further bytes. This proves the current implementation will not decrypt a mixture of two object versions during an overwrite race, but it will fail and will not automatically restart from byte zero. The bucket, whose temporary write permission was scoped to the test bucket, was deleted after this check.

### TV-9 渐进解密到 MSE 原型验证（2026-10-06）
### TV-9 Progressive Decryption-to-MSE Prototype Validation (2026-10-06)

为保留渐进实验前的可复核基线，已分别归档 Demo 源码和当时生成的 output：`experiments/checkpoints/hls-ctr-demo-20261006-pre-progressive.tar.gz` 与 `experiments/checkpoints/hls-ctr-demo-output-20261006-pre-progressive.tar.gz`；新的渐进原型位于独立目录 `experiments/hls-ctr-progressive-demo/`，通过 Docker 暴露在端口 `8790`，不会覆盖基线端口 `8789` 的 Demo。
To preserve a reviewable baseline before progressive work, the Demo source and then-current generated output were archived separately as `experiments/checkpoints/hls-ctr-demo-20261006-pre-progressive.tar.gz` and `experiments/checkpoints/hls-ctr-demo-output-20261006-pre-progressive.tar.gz`; the new progressive prototype lives in the isolated `experiments/hls-ctr-progressive-demo/` directory and uses Docker port `8790`, leaving the baseline Demo on port `8789` untouched.

输入样本 `/Users/macbookpro/Devs/samples/26.mp4` 的 SHA-256 为 `aede768d644abe0d4252181b7186bb531578f84063a142277f0d3fd9d1def289`；顶层 MP4 box 顺序为 `ftyp`, `moov`, `uuid`, `mdat`，`moov` 位于偏移 24，`mdat` 位于偏移 40865，满足 fast-start（moov-before-mdat）要求。原型在 Docker 内拒绝不满足该条件的输入，并将 8 秒输入转码为 854×480 H.264/yuv420p，中间 MP4 显式使用 `-movflags +faststart` 后再验证其 box 顺序。
The input sample `/Users/macbookpro/Devs/samples/26.mp4` has SHA-256 `aede768d644abe0d4252181b7186bb531578f84063a142277f0d3fd9d1def289`; its top-level MP4 boxes are `ftyp`, `moov`, `uuid`, `mdat`, with `moov` at offset 24 and `mdat` at offset 40865, so it meets the fast-start (moov-before-mdat) requirement. The prototype rejects inputs that fail this check, transcodes an eight-second clip to 854×480 H.264/yuv420p in Docker, applies `-movflags +faststart` to the intermediate MP4, and verifies its box order before further packaging.

随后生成独立 821 字节 init segment 和一个 HLS 媒体对象；该对象由 16 组约 0.5 秒的完整 `moof`/`mdat` 组成，尾部 `mfra` index 被移除，Playlist 的 `EXTINF` 为 `8.008` 秒。媒体对象以固定实验 AES-CTR/HMAC 格式拆成 9 条不超过 64 KiB 的认证记录；Dedicated Worker 必须先通过每条记录的 HMAC 验证才输出明文，主线程只把完整、连续的 `moof`/`mdat` 对追加给 MSE，并等待每次 `updateend` 后再继续处理后续媒体数据。
The package then contains a separate 821-byte init segment and one HLS media object composed of 16 complete `moof`/`mdat` pairs of about 0.5 seconds each; the trailing `mfra` index is removed, and the playlist `EXTINF` is `8.008` seconds. The media object is encrypted into nine authenticated records of at most 64 KiB using the fixed experimental AES-CTR/HMAC format. A Dedicated Worker must verify each record's HMAC before releasing clear bytes; the main thread appends only complete, contiguous `moof`/`mdat` pairs to MSE and waits for each `updateend` before processing more media.

隔离 Chromium `HeadlessChrome/153.0.8010.12`、64 KiB/s 下行限速用例中，首个解码帧约 `1.59` 秒出现、`playing` 事件约 `2.32` 秒出现，而密文对象约 `8.91` 秒才下载完；MSE 通过 16 次媒体追加达到 `8.075` 秒缓冲并正常 ended。视频过程中有一次 `waiting`，符合实测网络速率低于样本平均编码速率的预期；这证明弱网下仍可在密文完整下载前开始播放并逐步接收/追加，不能据此声称 64 KiB/s 下全程无卡顿。128 KiB/s 用例中，首个解码帧约 `0.75` 秒出现、`playing` 事件约 `1.23` 秒出现，密文下载约 `4.50` 秒完成；全部 16 次追加达到 `8.075` 秒，视频正常 ended。该次仍记录到一次短暂 `waiting`（播放位置约 `2.72` 秒，缓冲终点约 `6.57` 秒），随后恢复；因此只确认能够播放、完整追加并结束，暂不宣称绝对无停顿。两组中 Worker 解密后的 SHA-256 都与 sidecar 基准一致。
In isolated Chromium `HeadlessChrome/153.0.8010.12` throttled to 64 KiB/s, the first decoded frame appeared at about `1.59` seconds and the `playing` event at about `2.32` seconds, while the encrypted object did not finish downloading until about `8.91` seconds; 16 MSE media appends grew the buffer to `8.075` seconds and playback ended normally. One `waiting` event occurred, as expected because the measured network rate is below the sample's average encoded bitrate; this proves playback can begin before the ciphertext is fully downloaded and continue to append progressively, but it does not establish stall-free playback at 64 KiB/s. At 128 KiB/s, the first decoded frame appeared at about `0.75` seconds, the `playing` event at about `1.23` seconds, and the encrypted download finished at about `4.50` seconds; all 16 appends reached `8.075` seconds and playback ended normally. This run still recorded one brief `waiting` event (playback position about `2.72` seconds, buffer end about `6.57` seconds) and then recovered; therefore the result confirms playback, complete appending, and completion, but does not claim absolute stall-free playback. In both runs, the Worker-decrypted SHA-256 matched the sidecar baseline.

另一个对照实验将同一批多 `moof` 数据经 hls.js `progressive: true` 和公开 `fLoader` 逐步推入其管线：它确实在密文下载结束前产出首帧，但 SourceBuffer 随后被设置为 `timestampOffset=-1.001`, `-2.002` 等负偏移，追加内容重叠，缓冲时间线停在约 `1.068` 秒；早前将多个较大 `moof` 合并追加的对照也只达到约 `2.069` 秒。直接 MSE 对照逐个追加同一媒体对象的 16 组完整 `moof`/`mdat`，则缓冲正确达到 `8.075` 秒。因此实验确认“hls.js 有渐进回调”不等于该单 HLS fragment 多 `moof` 布局能正确工作；当前可验证的渐进路线是隔离的 Dedicated Worker + 自有 MSE append/backpressure 调度。hls.js 的此集成需要另行适配或改为 HLS partial segments 后重测。
A comparison run fed the same multi-`moof` payload progressively through hls.js `progressive: true` and its public `fLoader` hook. It did produce a frame before download completion, but later SourceBuffer appends received negative `timestampOffset` values such as `-1.001` and `-2.002`, causing overlapping media and leaving the buffer timeline near `1.068` seconds; an earlier comparison that grouped larger `moof` batches reached only about `2.069` seconds. Direct MSE appends of the same media object's 16 complete `moof`/`mdat` pairs correctly buffered to `8.075` seconds. This demonstrates that the existence of hls.js progressive callbacks alone does not make this multi-`moof` single-fragment layout work correctly; the presently verified progressive route is the isolated Dedicated Worker with custom MSE append/backpressure scheduling. This hls.js integration needs separate adaptation or an HLS partial-segment design followed by further validation.

该直接 MSE 原型目前仅覆盖 H.264 无音频、单个本地测试 HLS 媒体对象与固定测试密钥；尚未实现 Range/If-Range 续传、网络失败重试、seek、ABR、多音轨/字幕、HEVC 播放、密钥授权服务或生产安全设计。64 KiB/s 与 128 KiB/s 验证证明的是本地容器内指定 Chromium 的流式读取、记录认证/解密和增量 MSE append 行为；并未验证 RustFS/CDN 与此新播放器的联动，也未完成 Safari/iOS/Android 或 H.265 的渐进播放兼容性测试。
The direct MSE prototype currently covers only silent H.264, one local test HLS media object, and fixed test keys; it does not yet implement Range/If-Range resume, network-failure retry, seeking, ABR, alternate audio/subtitles, HEVC playback, a key-authorization service, or production security design. The 64 and 128 KiB/s runs establish progressive fetch, record authentication/decryption, and incremental MSE append only in the specified local Chromium container; they do not validate integration of this new player with RustFS/CDN or progressive H.265 playback on Safari/iOS/Android.

### TV-10 HEVC、Range 续传、seek 与 ABR 验证（2026-10-06）
### TV-10 HEVC, Range Resume, Seeking, and ABR Validation (2026-10-06)

验证使用 Docker 中独立的 FFmpeg/Node Demo（宿主端口 `8790`）和隔离的 macOS Chrome `154.0.8037.98` 有界面会话；Playwright 镜像仅提供浏览器二进制，因此自动化脚本通过 Chrome DevTools Protocol 驱动该会话。复跑入口为 `experiments/hls-ctr-progressive-demo/run-capability-validation.mjs`，最终结构化结果保存在 `experiments/hls-ctr-progressive-demo/capability-validation-report.json`。脚本复用一个标签页，并在退出时关闭该标签页。
Validation used the isolated Docker FFmpeg/Node Demo on host port `8790` and a dedicated headed macOS Chrome `154.0.8037.98` session; the Playwright image supplies browser binaries only, so the runner drives that session through Chrome DevTools Protocol. Rerun with `experiments/hls-ctr-progressive-demo/run-capability-validation.mjs`; the final structured results are saved in `experiments/hls-ctr-progressive-demo/capability-validation-report.json`. The runner reuses one tab and closes it on exit.

该 Chrome 会话对 `hev1.1.6.L93.B0` 与 `hvc1.1.6.L93.B0` 的 `MediaSource.isTypeSupported` 均返回 true，`canPlayType(hvc1)` 返回 `probably`。HLS.js 播放器读取 1280×720 HEVC CRF 32 CTR 清单后，四个独立加密 `.m4s` 都通过 Dedicated Worker 的记录 HMAC 验证和 AES-CTR 解密，四个明文 SHA-256 均匹配各自 sidecar；MSE 缓冲范围达到约 `0.067–8.075` 秒，视频以 `ended` 结束。首个解码帧约在播放请求后 `0.130` 秒呈现。清晰 HEVC 720p 对照也播放至结束；两种 HEVC HLS 路径都记录了一次非致命的初始 `bufferSeekOverHole` 时间线修正。
For this Chrome session, `MediaSource.isTypeSupported` returned true for both `hev1.1.6.L93.B0` and `hvc1.1.6.L93.B0`, and `canPlayType(hvc1)` returned `probably`. The HLS.js player loaded the 1280×720 HEVC CRF 32 CTR playlist; all four separately encrypted `.m4s` segments passed Dedicated Worker record HMAC verification and AES-CTR decryption, and each clear SHA-256 matched its sidecar. MSE buffered approximately `0.067–8.075` seconds and playback ended normally. The first decoded frame appeared about `0.130` seconds after the playback request. The clear HEVC 720p comparison also ended normally; both HEVC HLS paths recorded one nonfatal initial `bufferSeekOverHole` timeline correction.

该播放首先暴露了解析器不接受合法 `styp` box 的问题；放行后又暴露同一分片中的 `sidx` box。隔离播放器现将分片前缀 `styp`/`sidx` 与完整 `moof`/`mdat` 一起交给 MSE；复测后 720p HEVC CTR 四段均追加成功并正常结束。这个兼容修正在实验目录 `experiments/hls-ctr-progressive-demo/public/player.mjs`，仍需在 Safari/iOS、Android 与其他浏览器复核。
Playback first exposed that the fragment parser rejected the valid `styp` box, then exposed the `sidx` box in the same segment. The isolated player now passes the `styp`/`sidx` segment prefix to MSE together with each complete `moof`/`mdat`; after this compatibility fix, all four 720p HEVC CTR segments appended and playback ended normally. This compatibility fix lives in `experiments/hls-ctr-progressive-demo/public/player.mjs` and still needs verification in Safari/iOS, Android, and other browsers.

Range 续传通过播放器的“下一条记录后中断”操作端到端验证：首次响应在第一条完整认证记录后取消，恢复偏移为字节 `65592`，请求带原对象 ETag；恢复后播放器验证 206 响应、`Content-Range` 起点、总长度和 ETag，后续记录解密完成，最终明文 SHA-256 与基线一致。独立浏览器请求也得到 `206 bytes 0-65591/561353`，再请求 `bytes=65592-` 得到 `206 bytes 65592-561352/561353`；拼接的 `561353` 字节与一次完整 GET 逐字节相同。故意发送过期 `If-Range` 时服务器按 HTTP 行为返回完整 `200`，没有错误地把不同对象的字节拼接进来。
Range resume was verified end to end with the player's “interrupt after next record” control: the first response was cancelled after one complete authenticated record at byte offset `65592`, and the retry carried the original object ETag. The player validated the resumed 206 response, `Content-Range` start, total size, and ETag; the remaining records decrypted successfully, and the final clear SHA-256 matched its baseline. An independent browser request also received `206 bytes 0-65591/561353`, followed by `206 bytes 65592-561352/561353`; the concatenated `561353` bytes matched a full GET byte for byte. An intentionally stale `If-Range` returned the full `200` representation, preventing bytes from different object versions from being combined.

这项续传结果证明对象响应续接和 CTR/HMAC 记录恢复正确，不代表该单个 H.264 HLS 分片在 hls.js 的播放时间线已修复；该原型中一个 HLS 分片包含 16 个 `moof`/`mdat`，此前记录的 timestampOffset 问题仍适用。
This resume result confirms correct object-response continuation and CTR/HMAC record recovery; it does not mean the hls.js playback timeline for this single H.264 HLS fragment is fixed. This prototype places 16 `moof`/`mdat` pairs in one HLS fragment, so the previously recorded `timestampOffset` issue still applies.

Seek 在 Dedicated Worker + 自有 MSE 页面上验证：完整的 H.264 缓冲区为约 `0.067–8.075` 秒；播放到结尾后，将 `currentTime` 移到 `3.2` 秒，`play()` 成功，`playing` 事件确认恢复，播放头随后前进至约 `3.52` 秒。结果证明已缓冲时间范围内可以 seek 并恢复播放；播放器仍没有时间戳到认证记录/HTTP byte range 的索引，因此跳到尚未下载的区域并立即按需 Range 获取尚未验证。
Seeking was tested in the Dedicated Worker + custom MSE page: the complete H.264 buffer covered approximately `0.067–8.075` seconds. After playback ended, `currentTime` was moved to `3.2` seconds; `play()` succeeded, a `playing` event confirmed resumption, and the playhead advanced to about `3.52` seconds. This confirms seeking and resumed playback inside already buffered media. The player still has no timestamp-to-authenticated-record/HTTP-byte-range index, so seeking to media that has not been downloaded and fetching it on demand with Range remains unverified.

ABR 使用 hls.js `1.7.3`、三个时间对齐的 H.264 fMP4 rendition（360p、480p、720p）验证。64 KiB/s 下自动模式选择 360p，连续追加四个约 2 秒分片并播放到 `8.075` 秒结束。128 KiB/s 用例中自动模式选择 480p，之后手动切到 720p 并成功追加该 rendition 分片；该较高速 rendition 超出 128 KiB/s 的持续预算，不能据此声称播放无卡顿。加密多码率验证见 TV-11。
ABR was tested with hls.js `1.7.3` and three time-aligned H.264 fMP4 renditions (360p, 480p, and 720p). At 64 KiB/s, automatic selection chose 360p, appended all four approximately two-second segments, and played through `8.075` seconds to completion. In the 128 KiB/s run, automatic mode selected 480p; a manual switch to 720p then fetched and appended that rendition's segment. The higher rendition exceeds the sustained 128 KiB/s budget, so this does not establish stall-free playback. Encrypted multi-rendition validation is recorded in TV-11.

Docker 内 Linux HeadlessChrome `154` 对 HEVC MSE 能力探测返回 false，并报 `bufferAddCodecError`；同一机器上的有界面 macOS Chrome 返回 true，且完成上述 HEVC CTR 播放。因此 Headless 结果不能代替宿主 Chrome 的能力结论。当前证据仅适用于本机隔离 Demo 与这组 Chrome/FFmpeg 样本，不等同于 RustFS/CDN 上的 Range 行为、Safari/iOS、Android、生产网络或 DRM 结论。
Linux HeadlessChrome `154` inside Docker reported no HEVC MSE support and produced `bufferAddCodecError`; headed macOS Chrome on the same host reported support and completed the HEVC CTR playback above. Therefore, the headless result does not represent the host Chrome capability. Current evidence applies only to the isolated local Demo and these Chrome/FFmpeg fixtures; it does not establish Range behavior on RustFS/CDNs, Safari/iOS, Android, production networks, or DRM behavior.

### TV-11 加密多码率 HLS ABR 验证（2026-10-06）
### TV-11 Encrypted Multi-Rendition HLS ABR Validation (2026-10-06)

在隔离目录 `experiments/hls-ctr-progressive-demo/` 内，Docker FFmpeg 从同一 fast-start 输入生成 H.264 360p、480p、720p 三档、时间对齐的 fMP4 HLS rendition；每个媒体分片独立使用 AES-CTR 记录格式加密，并生成独立 sidecar、contentId 和密钥标识。主播放列表提供三档 rendition，初始化段保持明文；这仍是固定演示密钥的本地实验，不代表生产密钥管理。
In the isolated `experiments/hls-ctr-progressive-demo/` directory, Docker FFmpeg generated time-aligned H.264 360p, 480p, and 720p fMP4 HLS renditions from the same fast-start input; each media segment was encrypted independently with the AES-CTR record format and received its own sidecar, contentId, and key identifier. The master playlist exposes all three renditions, while initialization segments remain clear; this is still a local experiment with fixed demo keys, not production key management.

在有界面 macOS Chrome `154.0.8037.98` 中通过 hls.js `1.7.3` 播放加密主清单，初始服务器限速为 64 KiB/s；首个 360p 分片下载后提高至 512 KiB/s，以观察自动 ABR 升档。测试因视频 `ended=true` 结束，播放头和连续 MSE 缓冲范围均达到约 `8.075` 秒，无 HLS 错误。
The encrypted master playlist was played through hls.js `1.7.3` in headed macOS Chrome `154.0.8037.98`. The server started at 64 KiB/s and was raised to 512 KiB/s after the first 360p segment to observe automatic ABR up-switching. The test completed with `video.ended=true`; both the playhead and continuous MSE buffered range reached approximately `8.075` seconds, with no HLS errors.

事件记录显示自动 ABR 从 360p（640×360）切换到 720p（1280×720）：序号 0、1 使用加密 360p 分片，序号 2、3 使用加密 720p 分片，切换期间 HLS 媒体序号连续。四个分片各自的 Worker HMAC 验证、CTR 解密及明文 SHA-256 比对全部通过；SHA-256 为 `4b26eac8e240004b354c532567a2c28238a409b6d602a038caae6f9bbc86eff4`、`c66baa54ede67950983114ddbd84ac7cde0d88accbd5811094f833136eb1ab6f`、`3d6f64276c2fd5dd9530d6293c61dc2fd0cc26da5e0e4df25c04acb5a951ec92`、`2dd5385440b01e9622939c9937881d767381bc474de446049142eeecfa26fb10`，每项都与所属 sidecar 基线相同。因此本轮验证覆盖了加密流中的自动 rendition 切换、分片独立 sidecar/密钥解析、认证解密和完整播放。
The event log shows automatic ABR switching from 360p (640×360) to 720p (1280×720): encrypted 360p segments were used for sequence numbers 0 and 1, followed by encrypted 720p segments for sequence numbers 2 and 3, with the HLS media sequence remaining continuous across the switch. Worker HMAC verification, CTR decryption, and clear SHA-256 comparison passed for all four segments. Their hashes were `4b26eac8e240004b354c532567a2c28238a409b6d602a038caae6f9bbc86eff4`, `c66baa54ede67950983114ddbd84ac7cde0d88accbd5811094f833136eb1ab6f`, and `3d6f64276c2fd5dd9530d6293c61dc2fd0cc26da5e0e4df25c04acb5a951ec92`, and `2dd5385440b01e9622939c9937881d767381bc474de446049142eeecfa26fb10`; each matched its sidecar baseline. This run therefore covers automatic rendition switching in the encrypted stream, per-segment sidecar/key resolution, authenticated decryption, and full playback.

本次实际播放未选中已发布的 480p rendition；已验证自动 ABR 在本网络变化下从 360p 直接升至 720p，但尚不能声称已验证每个码率级别之间的逐对切换、自动降档策略、抖动网络稳定性或弱网无卡顿。验证范围限于本地 Docker 服务和 macOS Chrome，不涵盖 RustFS/CDN、Safari/iOS、Android 或生产密钥服务。结构化浏览器记录保存在 `experiments/hls-ctr-progressive-demo/capability-validation-report.json`；测试 runner 复用单个标签页并在退出时将其关闭。
The 480p rendition was available in the master playlist but was not selected during this playback. The test demonstrates automatic up-switching directly from 360p to 720p under this network change; it does not establish pairwise switching between every rendition, automatic down-switch behavior, stability under fluctuating networks, or stall-free playback on weak networks. The scope is limited to the local Docker service and macOS Chrome, and does not cover RustFS/CDN, Safari/iOS, Android, or a production key service. Structured browser results are saved in `experiments/hls-ctr-progressive-demo/capability-validation-report.json`; the runner reuses one tab and closes it on exit.
