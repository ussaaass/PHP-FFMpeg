# SDD：HLS 编排 API 使用方式与参数模型
# SDD: HLS orchestration API usage and parameter model

> 状态：Review
> Status: Review
> 创建日期：2026-10-04
> Created: 2026-10-04
> 负责人：项目维护者
> Owner: Project maintainers
> 关联 SDD：[HLS 输出与输入支持](SDD-20261003-hls-support.md)、[HLS 技术验证计划](SDD-20261004-hls-technical-validation.md)
> Related SDD: [HLS output and input support](SDD-20261003-hls-support.md), [HLS technical validation plan](SDD-20261004-hls-technical-validation.md)

## 1. 背景
## 1. Background

HLS 需求已经超出给单个视频格式追加几个 FFmpeg 参数的范围；调用方需要声明多个素材、有序处理步骤、多个轨道和输出目标，并能在执行前检查组合是否可行。
The HLS requirements go beyond adding a few FFmpeg options to a single video format; callers need to declare multiple assets, ordered processing steps, renditions, and output targets, and check combinations before execution.

技术验证表明 FFmpeg 9 可生成多码率 TS、独立音频和 WebVTT 字幕播放列表，并可在外部轮换者更新 key-info 后轮换 AES-128 密钥；但本项目目标配置要求 HEVC 使用 fMP4，因此 FFmpeg 原生 HLS muxer 的 AES-128+TS 能力不能满足加密 HEVC 需求。原生 muxer 拒绝 AES-128 加密 fMP4；HLS 规格定义了 fMP4 sample 加密方式，但项目仍需验证并集成相应打包后端。WebVTT 字幕分片也不会随音视频自动加密。
Technical validation shows that FFmpeg 9 can generate multi-rendition TS, separate audio and WebVTT subtitle playlists, and rotate AES-128 keys after an external rotator updates key-info; however, this project's target profile requires fMP4 for HEVC, so the native HLS muxer's AES-128+TS capability cannot meet encrypted HEVC needs. The native muxer rejects AES-128 encrypted fMP4; although HLS defines fMP4 sample-encryption methods, the project still needs to validate and integrate a compatible packaging backend. WebVTT subtitle segments are not automatically encrypted with the audio/video.

本 SDD 建议公开 API 的使用方式、参数分组、验证入口和 Docker 调用边界；它是供评审的设计，不代表 API 已实现。
This SDD proposes the public API usage pattern, parameter groups, verification entry point, and Docker invocation boundary; it is a design for review and does not mean the API has been implemented.

## 2. 目标与非目标
## 2. Goals and non-goals

- 用一个可复用的编排计划表达输入素材、处理步骤和 HLS 输出，并通过显式执行器运行。
- Express input assets, processing steps, and HLS outputs in one reusable orchestration plan and run it through an explicit executor.
- 参数按用途分组并具有类型，调用方不必自己拼接 `-var_stream_map`、滤镜字符串或 HLS muxer 参数。
- Group parameters by purpose and give them types so callers do not need to assemble `-var_stream_map`, filter strings, or HLS muxer options themselves.
- 支持执行前可选预检；静态检查与可选的样片编码/解码检查分别报告。
- Support optional preflight before execution; report static checks separately from optional sample encode/decode checks.
- 保持既有 `open()->save()` 工作流可用，并把复杂 HLS 编排作为独立 API 增量提供。
- Keep the existing `open()->save()` workflow available and add complex HLS orchestration through a separate API.
- 首期只讨论本地 VOD 输出、Docker 内执行和 FFmpeg 原生 HLS muxer 能力；直播、云存储和 DRM 系统不在本设计范围内。
- The first delivery discusses only local VOD output, execution inside Docker, and native FFmpeg HLS muxer capabilities; live streaming, cloud storage, and DRM systems are out of scope.

## 3. 建议的调用模型
## 3. Recommended calling model

调用方创建不可变或构建完成后不可变的 `WorkflowPlan`，计划包含带唯一 ID 的输入、显式有序步骤和一个或多个输出目标。
The caller creates an immutable, or immutable-after-construction, `WorkflowPlan` containing uniquely identified inputs, explicitly ordered steps, and one or more output targets.

调用方将计划交给 `WorkflowRunner`；可以先调用 `verify()` 获取报告，再调用 `execute()` 执行；也可以直接执行，此时执行器仍必须先运行阻断性静态验证。
The caller passes the plan to `WorkflowRunner`; it may call `verify()` first to obtain a report and then `execute()`, or call `execute()` directly, in which case the runner must still perform blocking static validation first.

建议 API 形状如下；类名仅用于说明职责，评审通过前不视为最终命名。
The following API shape is illustrative; class names describe responsibilities and are not final before design approval.

### 调用参数的常量与类型规则
### Constants and type rules for API arguments

调用方可选择的固定类别必须通过库提供的类型化常量对象/值对象表达，不要求调用方手写字符串；例如 playlist mode、segment container、codec、encryption profile、verify group、severity、key purpose、输入类型和滤镜方向。
Closed choices exposed to callers must use library-provided typed constant/value objects instead of caller-written strings; examples include playlist mode, segment container, codec, encryption profile, verify group, severity, key purpose, input type, and filter direction.

项目最低 PHP 版本为 8.0，设计不得依赖 PHP 8.1 原生 enum 才能工作；采用私有构造器的 final value classes、具名静态工厂和类型化参数，并在边界拒绝未知类别值。若未来最低 PHP 版本提升，可再考虑原生 enum。
The minimum PHP version is 8.0, so the design must not depend on PHP 8.1 native enums; use final value classes with private constructors, named static factories, and typed parameters, rejecting unknown category values at boundaries. Native enums may be considered if the minimum PHP version is raised later.

示例命名如 `PlaylistMode::master()`、`SegmentContainer::fmp4()`、`VideoCodec::h264()`、`EncryptionProfile::ctrHmacV1()`、`VerifyGroup::encryption()` 和 `Rotation::clockwise()` 返回各自类型的值，不是要求用户传入这些名称对应的字符串。
Illustrative factories such as `PlaylistMode::master()`, `SegmentContainer::fmp4()`, `VideoCodec::h264()`, `EncryptionProfile::ctrHmacV1()`, `VerifyGroup::encryption()`, and `Rotation::clockwise()` return values of their respective types; callers do not pass the strings represented by these names.

路径、URL、用户定义的视频/输入/rendition ID、`keyId`、`keyUri`、文件名模板、语言标签、显示名称、HTTP header/token 和数值仍是运行时数据；应优先用 `ContainerPath`、`InputId`、`VideoAssetId`、`RenditionId`、`KeyId`、`KeyUri`、`LanguageTag`、`Timecode`、`Duration`、`Bitrate` 等值对象校验语义，而非伪装成有限常量。
Paths, URLs, caller-defined video/input/rendition IDs, `keyId`, `keyUri`, filename templates, language tags, display names, HTTP headers/tokens, and numbers remain runtime data; validate their meaning with value objects such as `ContainerPath`, `InputId`, `VideoAssetId`, `RenditionId`, `KeyId`, `KeyUri`, `LanguageTag`, `Timecode`, `Duration`, and `Bitrate` instead of pretending they are closed constants.

原始 FFmpeg 参数/滤镜文本只能通过名称明确的高级逃生舱 API 显式启用；常规流程不接受任意 codec/filter/muxer option 字符串，也不能把自由字符串入口作为主要使用示例。
Raw FFmpeg arguments/filter text may only be supplied through a clearly named advanced escape-hatch API that requires explicit opt-in; normal workflows do not accept arbitrary codec/filter/muxer-option strings, and free-form string entry points must not appear as the primary usage example.

```php
$videoId = InputId::named('video');
$audioId = InputId::named('audio-en');
$subtitleId = InputId::named('sub-en');

$plan = WorkflowPlan::create()
    ->input($videoId, VideoInput::fromPath(ContainerPath::from('/workspace/media/source.mp4')))
    ->input($audioId, AudioInput::fromPath(ContainerPath::from('/workspace/media/english.m4a')))
    ->input($subtitleId, SubtitleInput::fromPath(ContainerPath::from('/workspace/media/english.srt')))
    ->step(SelectStreams::from($videoId)->video(StreamIndex::video(0)))
    ->step(Trim::from($videoId)->between(Timecode::seconds(10), Timecode::seconds(70)))
    ->step(Transpose::fromPrevious()->clockwise())
    ->step(Crop::fromPrevious()->centered(1280, 720))
    ->output(HlsOutput::master(ContainerPath::from('/workspace/out/movie'))
        ->playlistMode(PlaylistMode::master())
        ->segmentContainer(SegmentContainer::fmp4())
        ->encryption(EncryptionProfile::ctrHmacV1()));

$report = $runner->verify($plan, VerifyOptions::staticChecks());
if ($report->hasBlockingErrors()) {
    // Show findings; do not start FFmpeg.
}

$result = $runner->execute($plan);
```

这个示例表达的是对象职责和参数分组；固定类别由具名类型工厂构造，路径和用户 ID 等动态值经值对象验证。字幕、音频、变体、加密和输出细项应由配置对象组合补齐，不能依赖未定义的全局默认值。
This example shows object responsibilities and parameter grouping; closed choices are constructed through named typed factories, while runtime values such as paths and caller IDs are validated by value objects. Subtitle, audio, rendition, encryption, and output details should be supplied through configuration objects rather than undefined global defaults.

## 4. 参数分组
## 4. Parameter groups

### 输入素材
### Input assets

每个输入具有唯一 ID 和明确类型，例如 `VideoInput`、`AudioInput`、`SubtitleInput` 或 `KeyMaterialSource`；后续步骤和轨道通过 ID 引用输入，不使用数组位置作为隐式身份。
Each input has a unique ID and explicit type, such as `VideoInput`, `AudioInput`, `SubtitleInput`, or `KeyMaterialSource`; later steps and renditions reference inputs by ID instead of relying on array position as an implicit identity.

媒体输入应明确表达路径或 URL、流选择、协议选项和探测选项；同一输入级选项必须一致地传给 FFprobe 与 FFmpeg。
Media inputs should explicitly express path or URL, stream selection, protocol options, and probe options; the same input-level options must be applied consistently to FFprobe and FFmpeg.

密钥材料不属于媒体输入流，不得进入普通输入探测或媒体步骤图；它必须使用专用秘密来源类型。
Key material is not a media input stream and must not enter ordinary input probing or the media-step graph; it must use a dedicated secret-source type.

### 有序处理步骤
### Ordered processing steps

步骤以有序列表声明，并显式引用输入或前一步结果；首期步骤类型至少包括流选择、裁剪、旋转/转置、裁切画面、缩放/转码和音频编码/处理。
Steps are declared in an ordered list and explicitly reference an input or previous result; first-release step types include stream selection, trimming, rotation/transpose, crop, scaling/transcoding, and audio encoding/processing.

常用步骤使用类型化参数对象，例如时间码、角度、裁切矩形、目标分辨率、帧率和编码参数；不要求调用方编写 FFmpeg filter graph。
Common steps use typed parameter objects such as timecodes, angle, crop rectangle, target resolution, frame rate, and codec settings; callers are not required to write an FFmpeg filter graph.

高级扩展可提供受限的原始 FFmpeg 参数入口，但必须显式 opt-in、进行参数安全转义，并将结果标记为无法由预检完整推断；它不能取代常规结构化配置。
An advanced extension may provide a restricted raw FFmpeg option entry point, but it must require explicit opt-in, safely escape arguments, and mark findings that preflight cannot fully infer; it cannot replace normal structured configuration.

### HLS 输出目标
### HLS output targets

每个 `HlsOutput` 独立声明容器内目的目录、播放列表模式、播放列表文件名、分片类型（MPEG-TS 或 fMP4）、分片目录/命名模板、分片时长、编码配置、轨道映射和是否生成 M3U8 JSON sidecar；同一计划可有多个输出目标。
Each `HlsOutput` independently declares its in-container destination directory, playlist mode, playlist filename, segment type (MPEG-TS or fMP4), segment directory/name template, segment duration, encoding settings, rendition mapping, and whether to generate an M3U8 JSON sidecar; one plan may contain multiple output targets.

播放列表模式使用 PHP 8.0 兼容的 `PlaylistMode::master()` 或 `PlaylistMode::media()` 类型化值；`Master` 包含变体和媒体组，`Media` 必须指定单一输出轨道，不可把媒体清单伪装成主清单。JSON sidecar 必须从最终 M3U8 解析生成，保留条目顺序、标签、属性和 URI，且不替代原始清单。
Playlist mode uses PHP 8.0-compatible typed values such as `PlaylistMode::master()` or `PlaylistMode::media()`; `Master` contains variants and media groups, while `Media` must identify one output rendition and must not be presented as a master playlist. A JSON sidecar must be parsed from the final M3U8, preserve entry order, tags, attributes, and URIs, and never replace the original playlist.

每个视频变体是单独对象，包含稳定 ID、目标宽高/分辨率策略、视频编码器、码率、帧率/GOP 策略及输出命名；库负责生成 FFmpeg 内部变体映射。
Each video rendition is an object containing a stable ID, target dimensions/resolution policy, video encoder, bitrate, frame-rate/GOP policy, and output naming; the library generates FFmpeg's internal variant mapping.

独立音频轨对象包含来源输入 ID、流索引、语言、显示名称、默认/自动选择标志、声道和音频编码参数；独立字幕对象包含来源输入 ID、语言、显示名称、默认/自动选择标志和目标字幕格式。
Separate audio rendition objects contain source input ID, stream index, language, display name, default/autoselect flags, channels, and audio encoding settings; separate subtitle objects contain source input ID, language, display name, default/autoselect flags, and target subtitle format.

因为 FFmpeg 9 对音频 `name` 映射的实际清单输出与预期不符，执行结果必须校验最终 `EXT-X-MEDIA` 字段；若采用清单后处理，必须保证 URI、属性转义和组引用一致，并通过独立验证。
Because FFmpeg 9's actual playlist output did not match the expected audio `name` mapping, execution results must validate final `EXT-X-MEDIA` fields; if playlist post-processing is used, it must preserve URI, attribute escaping, and group references and be independently validated.

### 加密与密钥
### Encryption and keys

加密配置必须分开表达类型化 `EncryptionProfile`、密钥材料来源、播放器可访问的 `KeyUri`、IV 策略和 profile 专属密钥策略；材料来源可以是受保护文件或凭据由专用 provider 管理的 URL。调用方不得传入算法、加密模式或轮换策略的自由字符串。
Encryption configuration must separately express a typed `EncryptionProfile`, key-material source, player-accessible `KeyUri`, IV policy, and profile-specific key policy; material may come from a protected file or a URL whose credentials are managed by a dedicated provider. Callers must not supply free-form strings for algorithms, encryption modes, or rotation policies.

播放器 `keyUri` 是写入 M3U8 的客户端取钥地址，材料来源 URL 是 FFmpeg/执行器读取密钥字节的位置；两者即使由同一服务提供，也必须是不同字段。
The player `keyUri` is the client key-retrieval address written into M3U8, while the material-source URL is where FFmpeg/the runner reads key bytes; they must remain separate fields even when one service provides both.

首期使用 FFmpeg 原生 HLS muxer 时，`AES-128` 与 `MPEG-TS` 仅是 H.264 的已验证加密组合；HEVC+MPEG-TS 必须由静态预检阻断。原生路径的 AES-128 + fMP4 也应阻断。由于 HEVC 目标输出必须为 fMP4，首期加密 HEVC 需要单独设计并验证符合目标 HLS profile 的 sample-encryption/`cbcs` 打包后端；不能把 HLS 规格定义了该能力误当成本项目现有 FFmpeg 路径已经支持。
With the native FFmpeg HLS muxer in the first release, `AES-128` with `MPEG-TS` is a verified encrypted combination for H.264 only; static preflight must block HEVC plus MPEG-TS. The native path must also block AES-128 plus fMP4. Since target HEVC output must be fMP4, encrypted HEVC in the first release requires a separately designed and validated sample-encryption/`cbcs` packaging backend that meets the target HLS profile; the fact that HLS defines this capability does not mean this project's current FFmpeg path supports it.

对 HEVC + fMP4 + HLS，首选候选加密方法为 `SampleAesCbcs`：Apple authoring 规范针对 Apple 设备明确禁止 `SAMPLE-AES-CTR`，并要求 FairPlay 使用 `SAMPLE-AES`；RFC 8216 将 fMP4 HLS sample encryption 对应到 `cbcs`。此选择针对该目标 profile，不代表已证明其跨浏览器兼容性最广；兼容性证据和链接记录在 HLS 主 SDD 中。
For HEVC + fMP4 + HLS, the preferred candidate encryption method is `SampleAesCbcs`: Apple's authoring specification explicitly disallows `SAMPLE-AES-CTR` on Apple devices and requires `SAMPLE-AES` for FairPlay; RFC 8216 maps fMP4 HLS sample encryption to `cbcs`. This choice is for that target profile and does not claim proven broadest cross-browser compatibility; the compatibility evidence and links are recorded in the main HLS SDD.

API 应允许一个 CBCS 加密媒体分片集合附带多 DRM 信令（首期候选为 FairPlay + Widevine），使 iOS 与符合条件的 Android 客户端有机会共用同一份分片存储；播放器 key/license URI、DRM system signaling 和加密媒体字节必须作为不同数据建模。该模式属于待验证能力，必须确认 Shaka 输出清单不会泄露 raw key，并分别通过 Apple FairPlay 与 Android Media3/ExoPlayer 客户端测试后才能承诺。
The API should allow one CBCS-encrypted media-fragment set to carry multi-DRM signaling (FairPlay + Widevine as the first candidate), allowing iOS and eligible Android clients to potentially share one stored fragment set; player key/license URIs, DRM-system signaling, and encrypted media bytes must be modeled separately. This remains unvalidated and must not be promised until Shaka output is confirmed not to expose raw keys and playback is tested with Apple FairPlay and Android Media3/ExoPlayer clients separately.

技术验证优先评估 Docker 化的 Shaka Packager 适配器：FFmpeg 负责转码并生成对齐的中间 MP4，打包器负责 fMP4 分片、HLS 清单和 CBCS 加密；API 应把 `transcode` 与 `package/encrypt` 建模为可观察的执行阶段。该方案仍是待 TV-8 验证的候选，不视为已支持。
Technical validation should first evaluate a Dockerized Shaka Packager adapter: FFmpeg transcodes and creates aligned intermediate MP4 files, while the packager creates fMP4 fragments, HLS playlists, and CBCS encryption; the API should model `transcode` and `package/encrypt` as observable execution stages. This remains a candidate pending TV-8 validation and is not yet supported.

加密配置必须以不同类型表达 `Aes128Segment`、`SampleAesCbcs`、自定义 `CtrHmacV1` 等不同语义；不能只用一个 AES-128 布尔值或自由字符串代表 TS 整段加密、fMP4 sample 加密和 DRM/许可证集成。
Encryption configuration must use distinct types for semantics such as `Aes128Segment`, `SampleAesCbcs`, and custom `CtrHmacV1`; one AES-128 boolean or free-form string must not stand for TS whole-segment encryption, fMP4 sample encryption, and DRM/license integration.

FFmpeg 的 `periodic_rekey` 只负责响应外部 key-info 更新；动态密钥的生成、版本 URI 发布、原子更新和旧密钥保留属于外部 `KeyProvider`/轮换协调者职责，API 不应暗示 FFmpeg 会自动完成密钥生命周期。
FFmpeg's `periodic_rekey` only responds to external key-info updates; generating keys, publishing versioned URIs, atomic updates, and retaining old keys belong to an external `KeyProvider`/rotation coordinator, and the API must not imply that FFmpeg handles the key lifecycle automatically.

CTR/HMAC V1 首期采用每个视频资产一个恒定 `keyId`/主密钥，不进行周期性轮换；用 `RotationPolicy::none()` 显式表达该选择。其他加密 profile 的轮换策略属于各自 profile 的设计，不得沿用 CTR/HMAC V1 的假设。
The first CTR/HMAC V1 release uses one stable `keyId`/master key per video asset and does not rotate periodically; express this explicitly with `RotationPolicy::none()`. Rotation policies for other encryption profiles belong to their respective designs and must not be inferred from CTR/HMAC V1.

技术验证发现 WebVTT 未加密，因此若产品要求字幕内容也保密，首期预检必须拒绝“必加密”配置下的明文 WebVTT，直到增加受支持的字幕加密/封装路径；不得把视频加密状态显示为整个输出集合均已加密。
Technical validation found that WebVTT remains cleartext, so if the product requires subtitle confidentiality, first-release preflight must reject clear WebVTT under a mandatory-encryption policy until a supported subtitle encryption/packaging path is added; video encryption must not be reported as encryption of the complete output set.

### 可选预检
### Optional preflight

`verify()` 接受由 `VerifyGroup::toolCapabilities()`、`VerifyGroup::inputsAndStreams()`、`VerifyGroup::steps()`、`VerifyGroup::renditions()`、`VerifyGroup::encryption()`、`VerifyGroup::pathsAndNames()` 和 `VerifyGroup::targetProfile()` 构造的检查组值；调用方不传组名字符串。未选择目标播放器时只报告工具级事实，不推断客户端兼容性。
`verify()` accepts check-group values created by factories such as `VerifyGroup::toolCapabilities()`, `VerifyGroup::inputsAndStreams()`, `VerifyGroup::steps()`, `VerifyGroup::renditions()`, `VerifyGroup::encryption()`, `VerifyGroup::pathsAndNames()`, and `VerifyGroup::targetProfile()`; callers do not pass group-name strings. Without a player profile it reports tool-level facts only and does not infer client compatibility.

调用方可选提供目标播放器配置，但该检查只给出播放兼容性提示，不阻止库生成其他方面有效、合规的 HEVC fMP4 HLS；客户端插件/软件解码器属于调用方播放集成。
Callers may optionally provide a target-player profile, but this check only reports playback compatibility findings and does not prevent the library from generating otherwise valid, compliant HEVC fMP4 HLS; client plugins/software decoders belong to the caller's playback integration.

静态预检检查配置和能力清单而不执行完整转码；可选的 `sampleEncodeDecode` 是单独启用的耗时检查，结果必须与静态结果分开。
Static preflight checks configuration and capability listings without a full transcode; optional `sampleEncodeDecode` is an explicitly enabled time-consuming check and must be reported separately from static findings.

每条 finding 至少包含稳定代码、由 `FindingSeverity::error()` 等类型化值表达的严重级别、输入/步骤/输出定位、原因、证据和建议动作；阻断错误默认阻止执行，warning 的阻断策略由类型化验证策略配置。
Each finding contains at least a stable code, a severity represented by typed values such as `FindingSeverity::error()`, input/step/output location, reason, evidence, and recommended action; blocking errors prevent execution by default, while a typed verification policy configures whether warnings block.

### 执行结果
### Execution result

`execute()` 返回计划 ID、验证报告、实际工具版本、每个输出目标的状态、生成的清单/分片索引、密钥选择摘要（不含秘密）和可诊断错误；成功状态只能在所有必需清单及其引用资源完成校验后返回。
`execute()` returns the plan ID, verification report, actual tool versions, per-target status, generated playlist/segment index, a key-selection summary without secrets, and actionable errors; it reports success only after every required playlist and referenced resource passes validation.

多目标输出应逐个报告状态和产物清单；默认先写入目标暂存目录，在校验成功后发布，避免留下被调用方误认为完整的最终播放列表。
Multi-target output reports status and artifacts per target; by default it writes to target staging directories and publishes after validation, avoiding final playlists that callers could mistake for complete output.

## 5. Docker 使用边界与示例
## 5. Docker usage boundary and example

PHP、Composer、FFmpeg 和 FFprobe 均在 Compose 容器内运行；宿主机只提供项目目录与媒体输入挂载，不要求配置 PHP 或 FFmpeg。
PHP, Composer, FFmpeg, and FFprobe all run inside Compose containers; the host provides only the project directory and mounted media inputs and does not need PHP or FFmpeg configured.

容器内路径是 API 收到的路径；例如宿主机 `./media/source.mp4` 必须挂载到容器可见位置，再将 `/workspace/media/source.mp4` 传给输入对象。
Paths passed to the API are container paths; for example, host `./media/source.mp4` must be mounted at a container-visible location before passing `/workspace/media/source.mp4` to the input object.

建议的调用形式如下，具体 `docker compose` 命令以项目 Compose 文件提供的服务名为准。
The recommended invocation is shown below; use the service name exposed by the project's Compose file.

```sh
docker compose --profile ffmpeg9 run --rm \
  -v "$PWD/media:/workspace/media:ro" \
  -v "$PWD/output:/workspace/output" \
  php-ffmpeg9 php examples/hls-workflow.php
```

Compose 不应把宿主机密钥目录或密钥 URL 凭据写入版本控制；敏感材料应通过受限只读挂载或运行时秘密 provider 提供，并避免打印 Compose 展开的秘密环境变量。
Compose must not put host key directories or key-URL credentials under version control; sensitive material should come from a restricted read-only mount or runtime secret provider, and expanded secret environment variables must not be printed.

Docker 验收要覆盖：输入路径在容器内可见、输出路径可写、PHP 与 FFmpeg 版本可报告、FFmpeg 失败码传回调用方、容器删除后命名输出卷仍按用户选择保留。
Docker acceptance covers input paths visible inside the container, writable output paths, reportable PHP/FFmpeg versions, FFmpeg failure codes returned to the caller, and named output volumes retained after container removal according to user configuration.

## 6. 兼容与错误约定
## 6. Compatibility and error conventions

HLS API 应是新增独立入口，不改变现有常规媒体格式的 `open()->save()` 语义。
The HLS API should be a separate additive entry point and must not change `open()->save()` semantics for existing media formats.

缺失输入、无效流索引、变体冲突、路径覆盖、无效滤镜参数、未支持的编码器/分片组合和缺少 key URI 都应在启动编码前给出定位明确的错误。
Missing inputs, invalid stream indices, rendition conflicts, path collisions, invalid filter parameters, unsupported codec/segment combinations, and missing key URIs should produce clearly located errors before encoding starts.

执行中 FFmpeg 失败时，结果包含退出码和经脱敏的诊断；秘密、密钥字节、带凭据 URL 不得进入普通日志、异常文本、JSON 或 M3U8。
When FFmpeg fails during execution, the result includes its exit code and redacted diagnostics; secrets, key bytes, and credential-bearing URLs must not appear in ordinary logs, exception text, JSON, or M3U8.

FFmpeg 版本和构建能力可能不同；执行器应从实际容器中的工具探测能力，不以宿主机安装情况作为能力依据，也不将未知能力当作支持。
FFmpeg versions and build capabilities may differ; the runner should probe tools inside the actual container, not infer capabilities from host installations, and must not treat unknown capabilities as supported.

## 7. 验收标准
## 7. Acceptance criteria

- [ ] 调用方可以用一个计划对象声明有 ID 的视频、音频、字幕输入、顺序步骤和至少一个 HLS 输出目标。
- [ ] Callers can declare identified video/audio/subtitle inputs, ordered steps, and at least one HLS output target in one plan object.
- [ ] 计划可以选择执行前预检；静态检查默认不会进行完整转码，并返回带级别、位置、证据和建议的 finding。
- [ ] Plans can opt into preflight; static checks do not perform a full transcode by default and return findings with severity, location, evidence, and recommendations.
- [ ] 参数模型明确分离媒体输入、处理步骤、输出清单/轨道、加密策略、密钥材料来源和播放器 key URI。
- [ ] The parameter model clearly separates media inputs, processing steps, output playlists/renditions, encryption policy, key-material source, and player key URI.
- [ ] 所有闭集配置均以 PHP 8.0 兼容的类型化值对象/具名工厂公开，调用方无需手写类别字符串；只有路径、URL、用户 ID、标签等动态数据使用经过校验的值对象。
- [ ] All closed configuration choices are exposed through PHP 8.0-compatible typed value objects/named factories so callers need not write category strings; only runtime data such as paths, URLs, caller IDs, and labels use validated value objects.
- [ ] 原生 FFmpeg 9 路径会阻止 AES-128 + fMP4，并准确报告 WebVTT 明文加密覆盖限制。
- [ ] The native FFmpeg 9 path blocks AES-128 plus fMP4 and accurately reports the cleartext WebVTT encryption-coverage limitation.
- [ ] Docker 示例在容器路径下工作，且宿主机不需 PHP/FFmpeg；执行结果可列出工具版本、各目标状态和全部最终产物。
- [ ] The Docker example works with container paths and requires no host PHP/FFmpeg; execution results list tool versions, per-target statuses, and all final artifacts.
- [ ] 现有 `open()->save()` 使用方式及其非 HLS 输出不因新增 API 改变。
- [ ] Existing `open()->save()` usage and non-HLS outputs remain unchanged by the new API.

## 8. 仍需评审的决定
## 8. Decisions still requiring review

- [ ] 字幕内容是否必须加密；若必须，选择兼容的字幕加密/打包实现，或在找到实现前将明文字幕模式作为不支持场景。
- [ ] Must subtitle content be encrypted; if so, select a compatible subtitle encryption/packaging implementation, or treat cleartext subtitles as unsupported until one is identified.
- [ ] 首期是否将加密 H.264（TS + AES-128）与加密 HEVC（fMP4 + 经验证的 sample-encryption 打包后端）作为两条不同支持路径？HEVC 不得回退到 TS。
- [ ] Should the first release treat encrypted H.264 (TS + AES-128) and encrypted HEVC (fMP4 + a validated sample-encryption packager) as separate supported paths? HEVC must not fall back to TS.
- [x] CTR/HMAC V1 首期每个视频资产使用一个恒定 keyId/主密钥，不做周期轮换；将该策略表达为类型化 `RotationPolicy::none()`。其他加密 profile 的轮换需求另行设计。
- [x] CTR/HMAC V1 uses one stable keyId/master key per video asset in the first release, with no periodic rotation; express this with typed `RotationPolicy::none()`. Rotation requirements for other encryption profiles are designed separately.
- [ ] 多目标失败时默认回滚所有输出，还是保留成功目标并报告部分成功；建议以暂存后发布为默认，并通过失败注入验证。
- [ ] On multi-target failure, should all outputs roll back or should successful targets remain with partial-success reporting; staged publication is recommended by default and should be validated through failure injection.
- [ ] 音频显示名若 FFmpeg muxer 字段不足，是否接受库生成后处理 master playlist。
- [ ] If FFmpeg muxer fields are insufficient for audio display names, is library-side master-playlist post-processing acceptable.

## 9. 参考
## 9. References

技术能力与限制依据本仓库 [HLS 技术验证计划](SDD-20261004-hls-technical-validation.md) 中记录的 FFmpeg 9 Docker 实验；该实验不构成播放器兼容性承诺。
Tool capabilities and limitations are based on the FFmpeg 9 Docker experiments recorded in this repository's [HLS technical validation plan](SDD-20261004-hls-technical-validation.md); those experiments do not constitute player compatibility claims.

FFmpeg HLS key-info 与轮换选项的定义参见 [FFmpeg Formats Documentation — HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls-2)；fMP4 sample 加密要求参见 [RFC 8216 §4.3.2.4](https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.2.4)。
See [FFmpeg Formats Documentation — HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls-2) for FFmpeg HLS key-info and rotation options, and [RFC 8216 §4.3.2.4](https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.2.4) for fMP4 sample-encryption requirements.
