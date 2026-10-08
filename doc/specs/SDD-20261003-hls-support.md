# SDD：HLS 输出与输入支持
# SDD: HLS output and input support

> 状态：Review  
> Status: Review  
> 相关技术验证：[HLS 技术验证计划](SDD-20261004-hls-technical-validation.md)  
> Related technical validation: [HLS technical validation plan](SDD-20261004-hls-technical-validation.md)  
> API 使用设计：[HLS 编排 API 使用方式与参数模型](SDD-20261004-hls-api-usage-design.md)  
> API usage design: [HLS orchestration API usage and parameter model](SDD-20261004-hls-api-usage-design.md)  
> 创建日期：2026-10-03
> Created: 2026-10-03
> 负责人：项目维护者
> Owner: Project maintainers
> 关联 issue / PR：待创建
> Related issue / PR: To be created
> 技术验证计划：[HLS 技术验证计划](SDD-20261004-hls-technical-validation.md)
> Technical validation plan: [HLS technical validation plan](SDD-20261004-hls-technical-validation.md)

## 1. 背景与问题
## 1. Background and problem

当前库没有 HLS 专用格式、播放列表或分片管理 API，也没有 HLS 输入的专属探测配置。
The library currently has no HLS-specific format, playlist, or segment management API, and no dedicated probe configuration for HLS inputs.

使用者只能通过通用附加参数自行拼接 FFmpeg 命令；参数顺序、分片命名、编码关键帧对齐和多码率播放列表都由调用方负责。
Users can only assemble FFmpeg commands through generic additional parameters; callers are responsible for option ordering, segment naming, encoder keyframe alignment, and multi-bitrate playlists.

视频格式可能执行多遍编码，而 HLS 输出包含多个相互关联的文件；当前格式与输出模型没有表达或验证这些约束。
Video formats may run multiple encoding passes, while HLS output consists of multiple related files; the current format and output model does not express or validate these constraints.

## 2. 目标与范围
## 2. Goals and scope

### 目标
### Goals

- 提供明确、可验证的 HLS 视频点播（VOD）输出能力，并管理播放列表及分片输出。
- Provide explicit, verifiable HLS video-on-demand (VOD) output and manage playlist and segment outputs.
- 支持从单个输入同时生成 480p、720p、1080p 视频变体，并生成可供 HLS 播放器自适应切换的主播放列表。
- Support generating 480p, 720p, and 1080p video variants from one input in a single operation, and generate a master playlist that allows HLS players to switch adaptively.
- 支持生成与视频变体分离的音频和字幕媒体轨道，并在主播放列表中正确声明这些轨道及其关联关系。
- Support generating audio and subtitle renditions separate from the video variants, and correctly declare these renditions and their associations in the master playlist.
- 提供可组合的媒体编排过程：调用方声明一个或多个输入素材、按序执行的处理步骤，以及一个或多个输出目标。
- Provide a composable media orchestration workflow: callers declare one or more input assets, an ordered sequence of processing steps, and one or more output targets.
- 输入素材可包括视频、独立音频、字幕，以及本地文件或 URL 形式提供的加密密钥来源。
- Input assets can include video, separate audio, subtitles, and encryption key sources provided as local files or URLs.
- 处理步骤可组合转码、转置/旋转、裁剪及音频处理，并能将处理结果映射到后续输出。
- Processing steps can compose transcoding, transpose/rotation, cropping, and audio processing, and map their results to later outputs.
- 输出目标可分别配置主播放列表或媒体播放列表、多档分辨率、TS 或 fMP4 分片、分片命名、输出位置及可选的结构化 M3U8 JSON。
- Each output target can configure a master or media playlist, multiple resolutions, TS or fMP4 segments, segment naming, output location, and optional structured M3U8 JSON.
- 允许调用方在正式转码前选择性验证本机工具能力、流程配置、封装/编码兼容性、加密配置和输出路径。
- Allow callers to selectively verify local tool capabilities, workflow configuration, muxing/codec compatibility, encryption settings, and output paths before transcoding.
- 所有首期 HLS 输出必须启用与所选分片类型和目标播放器配置兼容的 HLS 加密，并确保各媒体播放列表提供播放器获取密钥所需的密钥 URI。
- All first-delivery HLS output must enable HLS encryption compatible with the selected segment type and target player profile, and ensure each media playlist provides the key URI needed by players to retrieve the key.
- 允许调用方调整或选择输出变体，并管理每个变体的播放列表与分片。
- Allow callers to adjust or select output variants and manage each variant's playlist and segments.
- 为 HLS 输入提供传递给 FFprobe 与 FFmpeg 的输入级选项，以便调用方配置协议和网络行为。
- Provide per-input options for HLS inputs that are passed to FFprobe and FFmpeg so callers can configure protocol and network behavior.
- 保证 HLS 输出使用单遍编码，且编码关键帧与目标分片时长保持兼容。
- Ensure HLS output uses single-pass encoding and that encoder keyframes are compatible with the target segment duration.
- 提供自动化测试，验证生成的播放列表和分片结构，而不只验证命令字符串。
- Provide automated tests that validate generated playlist and segment structure, rather than only validating command strings.

### 不在本次范围
### Out of scope

- 不支持持续运行的直播推流任务、进程停止/重启管理或实时发布服务。
- Continuous live-streaming jobs, process stop/restart management, and live publishing services are out of scope.
- 首期不提供任意脚本执行、循环、条件分支、并行分支或通用 DAG 工作流引擎；处理流程限于受支持的类型化步骤和明确的输入/输出映射。
- The first delivery does not provide arbitrary script execution, loops, conditional branches, parallel branches, or a general DAG workflow engine; processing is limited to supported typed steps with explicit input/output mappings.
- 不负责部署 CDN、HTTP 服务器、存储后端或播放器。
- CDN, HTTP server, storage backend, and player deployment are out of scope.
- 不承诺所有 FFmpeg 构建都支持相同的编码器、协议或 HLS 选项；运行时能力检查方式需在评审中确定。
- The design does not assume that every FFmpeg build supports the same encoders, protocols, or HLS options; the runtime capability-checking approach remains subject to review.
- 库不负责部署密钥服务器、授权服务或 CDN；调用方/部署环境必须提供播放器可访问的密钥 URI 和安全的密钥交付方式。
- The library does not deploy a key server, authorization service, or CDN; the caller/deployment environment must provide a player-accessible key URI and a secure key delivery mechanism.
- 首期是否支持单次 VOD 编排过程中的动态密钥轮换仍待评审；使用静态单密钥的兼容 HLS 加密属于首期必需能力，具体方法按封装和目标播放器配置确定。
- Whether the first delivery supports dynamic key rotation during a single VOD orchestration run remains subject to review; compatible HLS encryption with one static key is required in the first delivery, with the exact method determined by the segment format and target player profile.

## 3. 用户场景
## 3. User scenarios

调用方提供一个本地视频或可访问的输入流，单次调用即可生成 480p、720p、1080p 三种 HLS VOD 变体及统一的主播放列表。
A caller provides one local video or accessible input stream and generates 480p, 720p, and 1080p HLS VOD variants with a shared master playlist in one call.

播放器读取主播放列表后，可根据带宽和播放设备能力在各清晰度变体之间切换。
After reading the master playlist, a player can switch between resolution variants according to bandwidth and playback device capability.

调用方可以选择默认三档清晰度或提供自定义变体集合，并配置目标分片时长与分片格式。
A caller can use the default three resolutions or provide a custom set of variants, and configure target segment duration and segment format.

调用方可为同一组视频变体附加独立音频轨和字幕轨；播放器可在主播放列表中发现并选择可用音频与字幕。
A caller can attach separate audio and subtitle renditions to the same set of video variants; players can discover and select available audio and subtitles from the master playlist.

调用方可配置音频语言、显示名称、默认/自动选择状态，以及字幕语言和显示名称；具体字段由 API 设计确定。
A caller can configure audio language, display name, default/autoselect status, and subtitle language and display name; exact fields are determined by API design.

调用方创建一个 HLS 编排配置，传入源视频、目标变体、音频/字幕轨、分片参数、加密配置和输出目录，再执行该配置生成完整产物。
A caller creates an HLS orchestration configuration, supplies the source video, target variants, audio/subtitle renditions, segment settings, encryption configuration, and output directory, then executes it to generate the complete output set.

调用方可以声明多个输入素材，例如视频文件、独立音频文件、字幕文件和密钥文件/密钥 URL，并通过明确的输入标识在处理步骤中引用它们。
A caller can declare multiple input assets, such as a video file, separate audio file, subtitle file, and key file/key URL, and reference them from processing steps through explicit input identifiers.

调用方通过有序步骤描述处理流程，例如选取音视频流、裁剪时间范围、旋转画面、缩放/转码、处理音频，再将步骤结果映射到 HLS 输出轨道。
A caller describes processing through ordered steps, such as selecting audio/video streams, trimming a time range, rotating the picture, scaling/transcoding, processing audio, and mapping step results to HLS output renditions.

调用方可为输出指定 master playlist 或单个 media playlist 模式、TS 或 fMP4 分片、分片文件名模板、输出目录/URI，并选择是否生成 M3U8 的 JSON 表示。
A caller can select master-playlist or single-media-playlist mode, TS or fMP4 segments, a segment filename template, an output directory/URI, and whether to generate a JSON representation of the M3U8 playlist.

调用方将输入 HLS 清单交给库处理，并能提供 FFprobe 与 FFmpeg 所需的输入级协议或网络选项。
A caller processes an HLS manifest and can provide the per-input protocol or network options required by FFprobe and FFmpeg.

调用方需要多码率输出时，可通过结构化配置声明变体；库生成主播放列表及各变体播放列表和分片。
A caller who needs multiple bitrate outputs can declare variants through structured configuration; the library generates the master playlist and each variant playlist and its segments.

## 4. 需求与预期行为
## 4. Requirements and expected behavior

- **REQ-1：** 提供独立的 HLS 输出格式或等价的公开 API；调用方无需把 HLS muxer 参数作为无结构数组拼接。
- **REQ-1:** Provide a dedicated HLS output format or an equivalent public API; callers must not need to assemble HLS muxer options as an unstructured array.
- **REQ-2：** 首期支持有限时长的 VOD 输出；默认主播放列表模式下，对单个输入的一次操作生成 480p、720p、1080p 三个视频变体、各自有效的媒体播放列表及全部被引用分片；媒体播放列表模式按调用方选择的单一轨道生成。
- **REQ-2:** The first delivery supports finite-duration VOD output; in the default master-playlist mode, one operation on a single input generates 480p, 720p, and 1080p video variants, a valid media playlist for each, and every referenced segment; media-playlist mode generates the single rendition selected by the caller.
- **REQ-2a：** 库必须生成一个主播放列表，正确列出三个变体及播放器所需的带宽/分辨率信息，使符合 HLS 的播放器能够选择变体。
- **REQ-2a:** The library must generate a master playlist that correctly lists all three variants and the bandwidth/resolution metadata needed by players, allowing HLS-compliant players to select a variant.
- **REQ-2b：** 单次操作应复用同一个输入源完成多变体编码，不要求调用方分别打开输入并启动三次互不关联的转码。
- **REQ-2b:** A single operation should use the same input source for the multi-variant encode; callers must not need to open the input separately and start three unrelated transcodes.
- **REQ-2c：** 首期必须支持生成至少一个与视频变体分离的音频媒体轨，并将其作为音频组关联到主播放列表中的视频变体。
- **REQ-2c:** The first delivery must support generating at least one audio rendition separate from the video variants and associating it as an audio group with the video variants in the master playlist.
- **REQ-2d：** 首期必须支持生成至少一个与视频变体分离的字幕媒体轨，并在主播放列表中声明该字幕轨及其语言/名称元数据。
- **REQ-2d:** The first delivery must support generating at least one subtitle rendition separate from the video variants and declaring that subtitle rendition and its language/name metadata in the master playlist.
- **REQ-2e：** 音频组、字幕组和视频变体之间的关联必须符合 HLS 播放列表语义；主播放列表中的 URI 必须指向实际生成的媒体播放列表或资源。
- **REQ-2e:** Associations between audio groups, subtitle groups, and video variants must follow HLS playlist semantics; URIs in the master playlist must point to generated media playlists or resources.
- **REQ-2f：** 调用方应通过一个编排配置描述输入、视频变体、音频/字幕轨、分片设置、加密设置和输出位置，并通过一次执行生成相互关联的产物。
- **REQ-2f:** Callers should describe the input, video variants, audio/subtitle renditions, segment settings, encryption settings, and output location through one orchestration configuration, and generate the related outputs through one execution.
- **REQ-2g：** 编排开始前应验证必需参数、目标路径冲突和输入/输出组合；验证失败时不得启动 FFmpeg。
- **REQ-2g:** Before orchestration starts, validate required parameters, output path collisions, and input/output combinations; do not start FFmpeg when validation fails.
- **REQ-2h：** 编排配置必须支持多个带唯一标识的输入素材，并允许后续步骤引用视频、音频、字幕和密钥来源；本地路径与受支持的 URL 输入都应由适配的输入类型表达。
- **REQ-2h:** The orchestration configuration must support multiple uniquely identified input assets and allow later steps to reference video, audio, subtitle, and key sources; local paths and supported URL inputs must be represented by appropriate input types.
- **REQ-2i：** 处理步骤必须有明确类型、参数和输入/输出映射；首期步骤至少覆盖流选择、时间裁剪、转码/缩放、视频转置/旋转及音频编码/处理。
- **REQ-2i:** Processing steps must have explicit types, parameters, and input/output mappings; the first delivery must cover at least stream selection, time trimming, transcoding/scaling, video transpose/rotation, and audio encoding/processing.
- **REQ-2j：** 步骤按声明顺序执行；库必须在执行前验证步骤引用、参数范围和步骤间媒体类型兼容性，并报告可定位到步骤的错误。
- **REQ-2j:** Steps execute in declared order; before execution, the library must validate step references, parameter ranges, and media-type compatibility between steps, and report errors that identify the relevant step.
- **REQ-2k：** 输出目标必须能单独配置输出位置、播放列表模式、变体、分片类型、分片文件命名模板和媒体轨道映射；一份编排可声明多个输出目标。
- **REQ-2k:** Each output target must independently configure its destination, playlist mode, variants, segment type, segment filename template, and rendition mapping; one orchestration may declare multiple output targets.
- **REQ-2l：** 主播放列表模式必须生成并链接其声明的所有媒体播放列表；媒体播放列表模式只生成所选轨道的媒体播放列表，不得伪装成主播放列表。
- **REQ-2l:** Master-playlist mode must generate and link every declared media playlist; media-playlist mode generates only the selected rendition's media playlist and must not be represented as a master playlist.
- **REQ-2m：** 当调用方启用 JSON 输出时，库必须从最终 M3U8 产物解析并生成结构化 JSON；JSON 必须保留条目顺序、标签、属性和 URI，且不得替代原始 M3U8。
- **REQ-2m:** When callers enable JSON output, the library must parse the final M3U8 artifact and generate structured JSON; the JSON must preserve entry order, tags, attributes, and URIs, and must not replace the original M3U8.
- **REQ-2o：** 调用方可以在执行编排前选择性运行预检，并选择要执行的检查组；预检不应默认执行完整转码。
- **REQ-2o:** Callers can optionally run preflight verification before executing orchestration and select which check groups to run; preflight must not perform a full transcode by default.
- **REQ-2p：** 预检至少应能检查 FFmpeg/FFprobe 版本与所需 muxer、编码器、滤镜、协议能力，输入流和步骤映射，分辨率/码率/分片配置，输出路径与命名冲突，以及加密密钥配置。
- **REQ-2p:** Preflight must be able to check FFmpeg/FFprobe versions and required muxer, encoder, filter, and protocol capabilities; input stream and step mappings; resolution/bitrate/segment configuration; output path and naming collisions; encryption key configuration; and encryption coverage for every rendition type.
- **REQ-2q：** 当调用方声明目标播放器或兼容性配置时，预检应检查编码器、容器/分片类型、音频/字幕格式与该配置的已知兼容规则。
- **REQ-2q:** When callers declare a target player or compatibility profile, preflight should check codecs, container/segment type, audio/subtitle formats, and known compatibility rules for that profile.
- **REQ-2r：** 预检结果必须区分阻断错误、警告、信息和未知项；只有阻断错误默认阻止执行，警告是否阻止执行由调用方策略控制。
- **REQ-2r:** Preflight results must distinguish blocking errors, warnings, informational findings, and unknowns; only blocking errors prevent execution by default, while callers control whether warnings block execution.
- **REQ-2s：** 预检必须明确区分“本机 FFmpeg 能否生成该输出”和“目标播放器是否能播放该输出”；缺少目标兼容配置时，不得声称已验证通用播放器兼容性。
- **REQ-2s:** Preflight must distinguish whether the local FFmpeg can generate an output from whether a target player can play it; without a target compatibility profile, it must not claim universal player compatibility.
- **REQ-2t：** 可选的样片编码/解码检查必须作为明确选择的耗时检查提供，并与静态预检结果分开报告。
- **REQ-2t:** Optional sample encode/decode checks must be explicit, potentially time-consuming checks and reported separately from static preflight findings.
- **REQ-2u：** 输出目标必须支持配置本地输出路径；远程输出 URI 或存储适配器的支持范围由设计评审确定。
- **REQ-2u:** Output targets must support configurable local paths; support for remote output URIs or storage adapters is subject to design review.
- **REQ-3：** 配置应能表达目标分片时长、分片文件名/目录、播放列表文件名及 MPEG-TS 或 fMP4 分片类型；最终选项名称由设计评审确定。
- **REQ-3:** Configuration should express target segment duration, segment filename/directory, playlist filename, and MPEG-TS or fMP4 segment type; final option names are subject to design review.
- **REQ-4：** HLS VOD 输出默认使用单遍编码；如果调用方设置不兼容的多遍编码，库必须给出明确错误，不能静默生成不完整产物。
- **REQ-4:** HLS VOD output uses single-pass encoding by default; if a caller configures incompatible multi-pass encoding, the library must report a clear error instead of silently producing incomplete artifacts.
- **REQ-5：** 视频关键帧间隔应能与目标分片时长匹配；无法可靠推导时长或帧率时，应要求调用方提供兼容配置或给出可操作错误。
- **REQ-5:** Video keyframe intervals must be configurable to match the target segment duration; when duration or frame rate cannot be derived reliably, require compatible caller configuration or report an actionable error.
- **REQ-6：** 默认变体为 480p、720p、1080p；调用方可显式选择其中部分变体或提供自定义分辨率集合，并分别配置编码参数。
- **REQ-6:** The default variants are 480p, 720p, and 1080p; callers can explicitly select a subset or provide custom resolutions and configure encoding parameters for each variant.
- **REQ-6a：** 对低于目标分辨率的输入，不得放大画面；库应按源尺寸跳过不适用的变体或在启动编码前给出明确策略与错误信息。
- **REQ-6a:** The library must not upscale input below a target resolution; it should skip inapplicable variants based on source dimensions or provide a clear policy and error before encoding starts.
- **REQ-6b：** 每个变体的编码码率、宽高比处理和带宽元数据必须彼此一致，主播放列表不得声明与实际输出不符的参数。
- **REQ-6b:** Each variant's encoding bitrate, aspect-ratio handling, and bandwidth metadata must be consistent, and the master playlist must not declare values that differ from the actual output.
- **REQ-7：** 输入级选项应同时作用于 FFprobe 探测和 FFmpeg 转码，且不得意外作用于后续输出选项。
- **REQ-7:** Per-input options must apply to both FFprobe probing and FFmpeg transcoding and must not accidentally apply to later output options.
- **REQ-8：** 探测缓存键必须纳入会影响探测结果的输入选项，避免不同选项复用错误缓存。
- **REQ-8:** Probe cache keys must include input options that affect probe results so that different options do not reuse an incorrect cache entry.
- **REQ-8a：** 每个首期 HLS VOD 输出都必须使用与分片类型及目标兼容配置相符的 HLS 加密方法；未配置有效方法、密钥和播放器可访问的密钥 URI 时，编排必须明确失败，不能静默输出未加密内容。
- **REQ-8a:** Every first-delivery HLS VOD output must use an HLS encryption method compatible with its segment type and target profile; orchestration must fail clearly when a valid method, key, and player-accessible key URI are not configured, and must not silently produce unencrypted content.
- **REQ-8b：** 密钥内容不得写入主播放列表、日志、异常消息或普通应用配置；播放列表只包含播放器获取密钥所需的 URI/协议元数据。
- **REQ-8b:** Key material must not be written to the master playlist, logs, exception messages, or ordinary application configuration; playlists contain only the URI/protocol metadata required for players to retrieve keys.
- **REQ-8c：** 加密配置必须区分用于加密的密钥材料来源与写入 M3U8、供播放器获取密钥的 key URI；密钥材料来源可为受保护的本地文件或密钥提供器 URL。
- **REQ-8c:** Encryption configuration must distinguish the source of key material used for encryption from the key URI written to M3U8 for player retrieval; key material may come from a protected local file or a key-provider URL.
- **REQ-8d：** URL 密钥来源必须支持安全传输与必要的请求凭据配置；凭据和密钥字节不得写入日志、异常消息或生成的 JSON/M3U8。
- **REQ-8d:** URL key sources must support secure transport and required request credential configuration; credentials and key bytes must not be written to logs, exception messages, or generated JSON/M3U8.
- **REQ-9：** 文档需提供 Docker 环境下可复制的 VOD 使用示例，并说明 FFmpeg 版本/构建差异及生成文件布局。
- **REQ-9:** Documentation must provide a reproducible VOD example in the Docker environment and explain FFmpeg version/build differences and generated file layout.

### 错误与边界情况
### Errors and edge cases

- 无效分片时长、空变体列表、重复输出路径或不支持的分片类型必须在启动 FFmpeg 前报出可理解的参数错误。
- Invalid segment duration, an empty variant list, duplicate output paths, or an unsupported segment type must produce an understandable argument error before FFmpeg starts.
- 预检无法判断某项兼容性时必须报告“未知”及原因；不得把缺少规则等同于兼容或不兼容。
- When preflight cannot determine a compatibility result, it must report “unknown” with a reason; absence of a rule must not be treated as either compatible or incompatible.
- FFmpeg 失败或中断时，不得将不完整播放列表报告为成功；临时文件及部分产物的清理策略需在实现设计中明确。
- When FFmpeg fails or is interrupted, an incomplete playlist must not be reported as successful; implementation design must define cleanup for temporary files and partial artifacts.
- 路径包含空格或特殊字符时，命令参数及播放列表引用必须保持正确转义。
- Command arguments and playlist references must remain correctly escaped when paths contain spaces or special characters.
- 输入清单的远程协议访问受 FFmpeg 构建、协议白名单和网络环境影响；错误信息应保留底层诊断信息。
- Remote access to input manifests depends on the FFmpeg build, protocol whitelist, and network environment; errors should preserve the underlying diagnostic information.

## 5. API 与兼容性
## 5. API and compatibility

预计新增 HLS 输出配置 API 及输入级探测选项 API；具体类名、构造方式和是否扩展现有 `open()` 签名属于待评审决策。
The design is expected to add an HLS output configuration API and per-input probe options; exact class names, construction pattern, and whether the existing `open()` signature is extended remain review decisions.

现有 `save(FormatInterface $format, $outputPathfile)` 调用方式应保持可用，普通 MP4、WebM 等输出不得改变行为。
The existing `save(FormatInterface $format, $outputPathfile)` call pattern should remain available, and ordinary MP4, WebM, and other outputs must not change behavior.

新增 API 应遵循项目当前 PHP 与 Symfony Process 支持范围，不引入仅用于 HLS 的必需运行时依赖。
New APIs should follow the project's current PHP and Symfony Process support range and must not add a required runtime dependency solely for HLS.

HLS muxer选项依赖 FFmpeg 版本和构建能力；规格不应承诺项目无法检测或验证的编码器与协议能力。
HLS muxer options depend on FFmpeg version and build capabilities; the specification must not promise encoder or protocol capabilities that the project cannot detect or verify.

## 6. 设计方案
## 6. Design

建议将 HLS 作为独立的视频输出格式建模，并将播放列表及其分片视作一个输出集合，而不是单个文件。
The recommended approach is to model HLS as a dedicated video output format and treat its playlist and segments as an output set rather than a single file.

复杂媒体编排建议采用独立的计划对象和执行器：计划以唯一 ID 声明输入素材、以有序且有类型的步骤表达转换、以独立目标对象表达 master/media playlist、变体、轨道、加密和输出位置；调用方通过 `verify()` 选择性预检，再调用 `execute()`。
Complex media orchestration should use a dedicated plan object and runner: the plan declares uniquely identified input assets, expresses transforms as ordered typed steps, and models master/media playlists, renditions, tracks, encryption, and destinations as independent output objects; callers optionally run selected checks through `verify()` before calling `execute()`.

公开参数应使用结构化对象而非要求调用方拼接 `-var_stream_map`、filter graph 或 HLS muxer 参数；容器内路径是 API 路径，PHP、FFmpeg 与 FFprobe 均通过 Docker Compose 执行。
Public parameters should use structured objects instead of requiring callers to assemble `-var_stream_map`, filter graphs, or HLS muxer options; API paths refer to paths inside the container, and PHP, FFmpeg, and FFprobe all run through Docker Compose.

FFmpeg 9 原生 HLS muxer 已验证 AES-128 + MPEG-TS，但明确不支持 AES-128 + fMP4；WebVTT 字幕分片未随加密 TS 音视频加密。因此首期若坚持所有交付轨道必须加密，应阻止该明文 WebVTT 路径或在增加并验证单独加密实现后再开放。
The native FFmpeg 9 HLS muxer has verified AES-128 with MPEG-TS but explicitly does not support AES-128 with fMP4; WebVTT subtitle segments were not encrypted along with encrypted TS audio/video. Therefore, if every delivered rendition must be encrypted in the first release, block this cleartext WebVTT path or enable it only after adding and validating a separate encryption implementation.

这项 FFmpeg 限制不代表 HLS 标准禁止加密 fMP4：RFC 8216 定义 fMP4 HLS 使用 `SAMPLE-AES` 与 Common Encryption `cbcs`。FFmpeg 当前失败的是原生 HLS muxer 的 AES-128 整段加密路径；后续技术设计应把 TS 整段加密与 fMP4 sample 加密分成不同后端/加密模式，并验证 fMP4 的媒体 sample、初始化片段和 M3U8 密钥信令。
This FFmpeg limitation does not mean that the HLS standard forbids encrypted fMP4: RFC 8216 defines fMP4 HLS encryption using `SAMPLE-AES` and Common Encryption `cbcs`. The current failure is in the native HLS muxer's AES-128 whole-segment path; future technical design should separate TS whole-segment encryption from fMP4 sample encryption into distinct backends/methods and validate media samples, initialization sections, and M3U8 key signaling.

编排由三个可独立验证的层次组成：输入素材声明、类型化处理步骤和输出目标；输出目标再包含 HLS 播放列表、媒体轨道、编码变体、加密和分片设置。
The orchestration has three independently verifiable layers: input asset declarations, typed processing steps, and output targets; each output target contains HLS playlist, rendition, encoding variant, encryption, and segment settings.

处理步骤应是受支持的类型化操作，不应直接暴露任意 shell 字符串；步骤图需能验证输入输出引用并提供稳定的执行顺序。
Processing steps should be supported typed operations rather than arbitrary shell strings; the workflow must validate input/output references and provide a stable execution order.

配置模型建议允许一份流程将输入映射到多个输出目标；是否合并 FFmpeg filter graph 以减少重复解码属于性能优化，不应成为正确性前提或首期验收阻断项。
The configuration model should allow one workflow to map inputs to multiple output targets; combining FFmpeg filter graphs to reduce repeated decoding is a performance optimization and must not be a correctness prerequisite or first-delivery acceptance blocker.

首期流程采用线性、有序的类型化步骤，并允许步骤结果映射到多个输出目标；未来若需要条件、循环、并行分支或汇合，再独立设计 DAG 工作流。
The first delivery uses linear, ordered typed steps and allows step results to map to multiple output targets; conditional, looping, parallel, or joining branches should be designed separately if a DAG workflow is needed later.

本库的首要目标是尽可能生成符合配置与标准的输出，不要求每个浏览器原生解码 HEVC；调用方可以集成客户端插件/软件解码回退。产物生成/加密正确性与特定播放器的播放兼容性分别报告，不因浏览器缺少原生 HEVC 解码而阻止生成合规的 HEVC fMP4 HLS。
The library's primary goal is to generate outputs that meet the requested configuration and standards as broadly as its tools allow; it does not require every browser to decode HEVC natively, and callers may integrate client plugins or software-decoding fallbacks. Report artifact generation/encryption correctness separately from playback compatibility in a specific player, and do not block compliant HEVC fMP4 HLS generation merely because a browser lacks native HEVC decoding.

本项目以 Apple 的 HEVC HLS authoring profile 为目标：HEVC/H.265 必须封装为 fMP4（通常是初始化段加 `.m4s` 媒体片段）；H.264 可使用 MPEG-TS 或 fMP4。FFmpeg 能生成并探测 HEVC+TS 只证明工具链层面可产出，不满足本项目的 HLS 输出要求。[Apple WWDC 2017 HLS 说明](https://devstreaming-cdn.apple.com/videos/wwdc/2017/504op4c3001w2f222/504/504_advances_in_http_live_streaming.pdf?dl=1) 明确指出 HEVC 必须使用 fMP4，而 H.264 可使用 TS 或 fMP4。
This project targets Apple's HEVC HLS authoring profile: HEVC/H.265 must be packaged as fMP4 (typically an initialization section plus `.m4s` media fragments); H.264 may use MPEG-TS or fMP4. FFmpeg generation and probing of HEVC+TS only proves toolchain-level output and does not meet this project's HLS output requirement. [Apple's 2017 WWDC HLS presentation](https://devstreaming-cdn.apple.com/videos/wwdc/2017/504op4c3001w2f222/504/504_advances_in_http_live_streaming.pdf?dl=1) explicitly says HEVC must use fMP4, while H.264 may use TS or fMP4.

预检建议提供可选择的检查集，例如本机工具能力、输入与步骤、目标编码/分片兼容性、加密、路径与产物布局；每项结果附带依据、严重级别和是否阻断执行。
Preflight should offer selectable check sets, such as local tool capabilities, inputs and steps, target codec/segment compatibility, encryption, and paths/output layout; each finding should include its basis, severity, and whether it blocks execution.

HEVC/H.265 输出必须选择 fMP4；HEVC + MPEG-TS 应由预检阻断。本规则遵循 Apple HEVC HLS authoring profile；同时，本库应尽可能支持其他已验证的合规 HLS 输出组合，而不把某一浏览器的解码能力当作输出生成门槛。
HEVC/H.265 output must use fMP4, and preflight should block HEVC plus MPEG-TS. This follows Apple's HEVC HLS authoring profile; the library should also support other validated, compliant HLS output combinations where possible, without making one browser's decoding capability a gate on output generation.

加密兼容性证据目前支持将 CBCS 作为本项目 HEVC + fMP4 + HLS 的首选候选，尤其是 Apple/FairPlay 目标；证据不足以声称 CBCS 是跨所有浏览器、DRM 和设备的“最广泛”方案。Apple HLS authoring specification 要求 HEVC 使用 fMP4，建议视频/音频保护遵循 FairPlay；启用 FairPlay 时要求 `METHOD=SAMPLE-AES` 与 `KEYFORMAT="com.apple.streamingkeydelivery"`，并明确规定 Apple 设备不得使用 `SAMPLE-AES-CTR`。RFC 8216 规定 fMP4 HLS sample 加密使用 Common Encryption `cbcs`。Shaka Packager 文档提供 FairPlay + `cbcs` 的打包示例。以上构成选择 CBCS 的标准和实现证据，但不是全浏览器兼容性测试结果。
Current encryption-compatibility evidence supports CBCS as the preferred candidate for this project's HEVC + fMP4 + HLS output, especially for Apple/FairPlay targets; it does not establish CBCS as the “broadest” option across all browsers, DRM systems, and devices. Apple's HLS authoring specification requires fMP4 for HEVC and recommends FairPlay for video/audio protection; when FairPlay is used, it requires `METHOD=SAMPLE-AES` and `KEYFORMAT="com.apple.streamingkeydelivery"`, and explicitly prohibits `SAMPLE-AES-CTR` on Apple devices. RFC 8216 specifies Common Encryption `cbcs` for fMP4 HLS sample encryption. Shaka Packager documents a FairPlay + `cbcs` packaging example. This is standards and implementation evidence for choosing CBCS, not a cross-browser compatibility test result.

Shaka Player 文档将 HLS `SAMPLE-AES-CTR`（identity）支持限定于支持 ClearKey 的浏览器，并说明 ClearKey 仅适合调试、不提供实际内容安全；同一文档列出 FairPlay HLS 支持路径。故本项目不得把 CTR identity 作为生产密钥保护的通用替代，也不得仅凭 CBCS 规范/打包支持推断任意浏览器可播。
Shaka Player documentation limits HLS `SAMPLE-AES-CTR` (identity) support to browsers with ClearKey support and states that ClearKey is for debugging and does not provide real content security; the same documentation lists the FairPlay HLS playback path. Therefore, this project must not treat CTR identity as a general production-key-protection substitute, or infer that arbitrary browsers can play CBCS solely because the format is standardized and packager-supported.

Android 证据补充：AndroidX Media3/ExoPlayer 官方 HLS 支持表明确支持 FMP4/CMAF；其 DRM 表明确列出 Widevine `cbcs` 自 Android 7.1/API 25 起支持 DASH 与 HLS（HLS 限 fMP4），而 Widevine `cenc` 自 Android 4.4/API 19 起支持 HLS fMP4。该表中的 `AES-128` 是整分片加密并标记为支持；`Sample AES-128` 则标记为不支持。这里的“不支持”不能泛化为 Android 不支持加密 fMP4，因为同一官方表明确支持 Widevine `cbcs` + HLS fMP4；必须区分 HLS AES-128、HLS Sample AES 与 CENC/Widevine CBCS DRM。
Android evidence: the official AndroidX Media3/ExoPlayer HLS support table lists FMP4/CMAF as supported; its DRM table lists Widevine `cbcs` for DASH and HLS (HLS fMP4 only) from Android 7.1/API 25, and Widevine `cenc` for HLS fMP4 from Android 4.4/API 19. In the HLS table, `AES-128` means whole-segment encryption and is marked supported, while `Sample AES-128` is marked unsupported. That “unsupported” entry must not be generalized to mean Android cannot play encrypted fMP4, because the same official tables explicitly support Widevine `cbcs` + HLS fMP4; HLS AES-128, HLS Sample AES, and CENC/Widevine CBCS DRM must be distinguished.

Android 的最低 API 版本是平台/MediaDrm 能力下限，不代表所有 Android 设备均具备对应 HEVC 解码器、Widevine 安全级别或许可证策略。Android 官方格式表列出 HEVC 的 Android 5.0+ 平台格式支持，但具体编码 profile/level、设备解码器和安全级别仍需查询/实测。上述 Media3 结论适用于 Android 应用内的 ExoPlayer；不能直接推断 Chrome 等浏览器里的 Shaka Player、MSE/EME 路径也具有相同支持范围。
Android's minimum API levels are platform/MediaDrm capability floors; they do not mean every Android device has the required HEVC decoder, Widevine security level, or license policy. Android's official format table lists platform HEVC support from Android 5.0, but supported codec profiles/levels, device decoders, and security levels still require querying or testing. The Media3 findings apply to ExoPlayer inside Android apps and cannot be directly generalized to Shaka Player through MSE/EME in browsers such as Chrome.

Android 参考： [Media3 HLS 支持表](https://developer.android.com/media/media3/exoplayer/hls)、[Media3 DRM 格式/最低版本表](https://developer.android.com/media/media3/exoplayer/drm)、[Android 支持的媒体格式](https://developer.android.com/media/platform/supported-formats)、[MediaCodec.CryptoInfo 的 CENC scheme 说明](https://developer.android.com/reference/android/media/MediaCodec.CryptoInfo)。
Android references: [Media3 HLS support table](https://developer.android.com/media/media3/exoplayer/hls), [Media3 DRM formats/minimum-version table](https://developer.android.com/media/media3/exoplayer/drm), [Android supported media formats](https://developer.android.com/media/platform/supported-formats), and [CENC scheme details in MediaCodec.CryptoInfo](https://developer.android.com/reference/android/media/MediaCodec.CryptoInfo).

因此，“保存一份媒体分片供 iOS 与 Android 使用”是可验证的目标候选：以 HEVC fMP4/CMAF 的 CBCS 加密 sample 作为共同媒体数据，清单提供 Apple FairPlay 与 Android Widevine 各自可识别的 DRM 信令，并由各自许可证服务授权。Apple authoring profile 指定 FairPlay 的 `SAMPLE-AES`/`com.apple.streamingkeydelivery` 信令；Media3 支持 Widevine CBCS HLS fMP4；Shaka Packager 支持多 DRM 信令与 CBCS。能否由当前 Shaka 版本正确生成单一 HLS 清单/同一组分片，并在目标 iOS 与 Android 设备解密播放，仍必须通过 TV-8 的实测；Android CBCS 的官方最低边界为 API 25，且设备还必须支持对应 HEVC profile/level。
Therefore, “one stored media-fragment set for iOS and Android” is a testable candidate: use HEVC fMP4/CMAF samples encrypted with CBCS as shared media data, signal Apple FairPlay and Android Widevine in forms each client recognizes, and authorize through their respective license services. Apple's authoring profile specifies FairPlay `SAMPLE-AES`/`com.apple.streamingkeydelivery` signaling; Media3 supports Widevine CBCS HLS fMP4; Shaka Packager supports multi-DRM signaling and CBCS. Whether the current Shaka version correctly generates one HLS manifest/shared fragment set that decrypts and plays on the target iOS and Android devices must still be tested in TV-8; the documented Android CBCS minimum is API 25, and devices must also support the relevant HEVC profile/level.

需求边界：维护者已确认“必须加密”，但尚未要求 DRM 授权、许可证服务器或设备级内容保护；不得把二者视为同一需求。若要求 iOS/Android 原生 HLS 播放器解密同一份 HEVC + fMP4 + CBCS 内容，候选集成通常需要 Apple FairPlay 与 Android Widevine，以及各自的密钥/许可证服务。若不引入 DRM，则必须另行验证客户端如何安全取得 CBCS 密钥并解密；Android Media3 将普通 HLS `Sample AES-128` 标为不支持，因此不得承诺默认播放器可直接播放这种无 DRM 方案。可用 Shaka raw key 做本地实验，但 raw key 示例不等于生产 DRM 或安全密钥分发。
Requirement boundary: maintainers have confirmed that encryption is required, but have not required DRM authorization, license servers, or device-level content protection; these must not be treated as the same requirement. If native iOS/Android HLS players must decrypt the same HEVC + fMP4 + CBCS content, the candidate integration typically needs Apple FairPlay and Android Widevine, with their respective key/license services. Without DRM, the client method for securely obtaining CBCS keys and decrypting them must be validated separately; Android Media3 marks ordinary HLS `Sample AES-128` unsupported, so direct playback by default players must not be promised for this no-DRM option. Shaka raw-key examples can be used for local experiments, but a raw-key example is not production DRM or secure key delivery.

DRM 接入流程和费用证据：FairPlay 生产流程由播放器请求 SPC、应用/播放器把 SPC 发送到内容方的 KSM、KSM 验证请求并取得对应内容密钥后返回 CKC，播放器再用 CKC 建立受保护播放会话；生产凭据须经 Apple 审批，且申请方应是面向消费者提供流媒体服务的团队。[Apple FairPlay 文档](https://developer.apple.com/streaming/fps/)；[Apple FairPlay 调试说明](https://developer.apple.com/library/archive/technotes/tn2454/)。Apple 公开页面未列出 FairPlay 单独许可费；Apple Developer Program 标价为每年 99 美元（按地区可能本地定价），这不是 FairPlay 服务报价。[Apple Developer Program 费用](https://developer.apple.com/help/account/membership/program-enrollment)。Widevine 需要签署许可协议，但 Google 声明不收取 Widevine 产品/服务使用费；云端 License Service 对 licensee 不收访问或交易费，但没有 SLA/全天候紧急支持，license request 必须经服务方 proxy 验证并附加业务规则后再提交。[Widevine 官方接入/费用说明](https://developers.google.com/widevine/drm/overview)；[Widevine 云服务 SLA 与第三方选项](https://www.widevine.com/solutions/widevine-providers)。第三方多 DRM/SaaS 服务商可按其商业合同收费；自建 KSM/proxy/license 服务仍有工程、主机、监控和运维成本。
DRM workflow and cost evidence: in the FairPlay production flow, the player requests an SPC, the app/player sends it to the content provider's KSM, the KSM validates the request and obtains the corresponding content key before returning a CKC, and the player uses the CKC to establish a protected playback session; production credentials require Apple's approval, and applicants must provide a streaming service to consumers. [Apple FairPlay documentation](https://developer.apple.com/streaming/fps/); [Apple FairPlay debugging note](https://developer.apple.com/library/archive/technotes/tn2454/). Apple's public page does not list a separate FairPlay license fee; the Apple Developer Program is priced at USD 99 per year (local pricing may vary), which is not a FairPlay service quote. [Apple Developer Program fees](https://developer.apple.com/help/account/membership/program-enrollment). Widevine requires a license agreement, but Google states it charges no fee for Widevine product/service use; its cloud License Service has no access or transaction fees for licensees but has no SLA or 24/7 emergency support, and license requests must pass through the service operator's proxy for validation and business-rule enforcement. [Widevine official access/cost information](https://developers.google.com/widevine/drm/overview); [Widevine cloud service SLA and third-party options](https://www.widevine.com/solutions/widevine-providers). Third-party multi-DRM/SaaS providers may charge under commercial contracts; self-hosted KSM/proxy/license services still incur engineering, hosting, monitoring, and operations costs.

Shaka Packager 负责内容加密和 DRM/HLS 信令，可用 Widevine/CPIX/raw-key 材料生成多 DRM 打包结果；它本身不替项目运营用户授权业务、账户鉴权或 FairPlay KSM，也不等同于托管许可证服务。生产架构必须明确谁生成/保管内容密钥、谁验证用户播放权、谁签发 FairPlay CKC/Widevine license，以及各服务的费用与可用性责任。
Shaka Packager handles content encryption and DRM/HLS signaling and can package multi-DRM outputs from Widevine/CPIX/raw-key materials; it does not itself operate the product's user authorization, account authentication, or FairPlay KSM, and it is not a hosted license service. The production architecture must identify who generates/stores content keys, who verifies user playback entitlement, who issues FairPlay CKCs/Widevine licenses, and who owns the cost and availability responsibilities for each service.

参考： [Apple HLS Authoring Specification](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices/)、[RFC 8216 §4.3.2.4](https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.2.4)、[Shaka Packager CBCS/FairPlay 示例](https://shaka-project.github.io/shaka-packager/html/tutorials/raw_key.html)、[Shaka Player HLS/DRM 支持说明](https://github.com/shaka-project/shaka-player#hls-features)。
References: [Apple HLS Authoring Specification](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices/), [RFC 8216 §4.3.2.4](https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.2.4), [Shaka Packager CBCS/FairPlay example](https://shaka-project.github.io/shaka-packager/html/tutorials/raw_key.html), and [Shaka Player HLS/DRM support](https://github.com/shaka-project/shaka-player#hls-features).

一次编排执行可以运行一个或多个 FFmpeg/FFprobe 任务；任一必需任务失败时，调用方必须收到失败结果，不能将不完整产物报告为成功。
One orchestration execution may run one or more FFmpeg/FFprobe tasks; if any required task fails, callers must receive a failure result and incomplete outputs must not be reported as successful.

加密密钥属于秘密数据；实现应避免将密钥作为可记录的命令行参数，并应限制临时密钥材料的文件权限和保留时间。
Encryption keys are secret data; implementation should avoid exposing keys as loggable command-line arguments and should restrict permissions and retention time for temporary key material.

多变体配置建议以显式的变体对象表达分辨率、码率、视频编码参数及输出路径；默认集合为 480p、720p、1080p，避免依赖调用方维护脆弱的 `var_stream_map` 字符串。
Multi-variant configuration should use explicit variant objects for resolution, bitrate, video encoding options, and output paths; the default set is 480p, 720p, and 1080p, avoiding fragile caller-maintained `var_stream_map` strings.

独立音频和字幕建议使用单独的媒体轨配置对象，并能设置语言、显示名称、默认/自动选择状态及编码/格式选项；主播放列表由库根据这些对象生成媒体组和变体关联。
Separate audio and subtitle renditions should use dedicated rendition configuration objects with language, display name, default/autoselect status, and encoding/format options; the library should generate media groups and variant associations in the master playlist from these objects.

输入选项应通过输入对象或新增的可选参数传入，并由探测和转码共享；选项合并规则及公共 API 形状待评审确定。
Input options should be supplied through an input object or a new optional parameter and shared by probing and transcoding; option-merging rules and public API shape remain subject to review.

编排 API 建议分为可复用的流程配置/计划对象与执行入口；计划对象声明素材、步骤和输出，执行入口负责校验、生成任务计划、运行 FFmpeg/FFprobe 并报告各输出结果。
The orchestration API should use a reusable workflow configuration/plan object and an execution entry point; the plan declares assets, steps, and outputs, while execution validates, builds a task plan, runs FFmpeg/FFprobe, and reports each output result.

首期加密建议以单一静态密钥覆盖一个 VOD 输出目标；加密方法必须与分片类型及目标播放器配置相符，密钥材料从受保护文件或密钥提供器获取，播放器 key URI 单独配置，库不托管密钥服务。
For the first delivery, use one static key per VOD output target; the encryption method must match the segment type and target player profile, key material comes from a protected file or key provider, the player key URI is configured separately, and the library does not host a key service.

对于 FFmpeg HLS muxer 的 AES-128 key-info 机制，key-info 文件包含密钥 URI、密钥文件路径和可选 IV；启用 `periodic_rekey` 后 muxer 会周期检查文件，并在检测到更新后让后续分片使用新密钥、在播放列表写入新的密钥声明。
For the FFmpeg HLS muxer's AES-128 key-info mechanism, the key-info file contains a key URI, key file path, and optional IV; with `periodic_rekey` enabled, the muxer periodically checks the file and, when it detects an update, uses the new key for subsequent segments and writes a new key declaration to the playlist.

动态轮换需要外部密钥管理者在分片边界附近安全生成新密钥，并原子替换密钥文件及 key-info 文件；仅打开一个 FFmpeg 选项并不能完成密钥生成、发布、授权或播放器密钥交付。
Dynamic rotation requires an external key manager to securely create a new key near a segment boundary and atomically replace both the key file and key-info file; enabling an FFmpeg option alone does not generate, publish, authorize, or deliver keys to players.

M3U8 JSON 应是可版本化的结构化旁路产物，而不是简单把文本按行拆分；其模式应能保留主/媒体播放列表标签、属性、分段顺序及 URI，并明确相对 URI 的解析基准。
M3U8 JSON should be a versioned structured sidecar rather than a simple line-by-line split of the text; its schema should preserve master/media playlist tags, attributes, segment order, and URIs, and define the base for resolving relative URIs.

多变体下密钥轮换与各播放列表同步的可靠性需要专项验证，因此本 SDD 将“必须加密”定为首期要求，将“动态轮换”保留为单独待决能力。
Reliable key rotation synchronized across playlists under multiple variants requires dedicated verification, so this SDD makes encryption mandatory for the first delivery and keeps dynamic rotation as a separate open capability.

初始实现可通过命令构建单元测试验证参数顺序，再使用 Docker 内可用的 FFmpeg 做小型真实 HLS 集成验证。
The initial implementation can use command-building unit tests to verify option ordering, followed by a small real HLS integration check with the FFmpeg available in Docker.

## 7. 验收标准
## 7. Acceptance criteria

- [ ] 调用方可通过公开 API 生成可被 FFprobe 读取的 HLS VOD 播放列表及其引用的全部分片。
- [ ] Callers can use the public API to generate an HLS VOD playlist readable by FFprobe and every segment referenced by that playlist.
- [ ] 在默认主播放列表模式下，对符合输入尺寸要求的视频，单次调用会生成 480p、720p、1080p 三个变体、三个媒体播放列表和一个引用全部变体的主播放列表。
- [ ] In the default master-playlist mode, one call on video meeting the input dimension requirements generates 480p, 720p, and 1080p variants, three media playlists, and one master playlist that references every variant.
- [ ] 播放列表中每个变体的分辨率、带宽和 URI 与实际编码文件一致，所有 URI 均指向存在且可探测的输出文件。
- [ ] Each variant's resolution, bandwidth, and URI in the playlists match the encoded files, and every URI points to an existing, probeable output file.
- [ ] 主播放列表声明独立音频组和字幕组，并将其正确关联到适用的视频变体。
- [ ] The master playlist declares separate audio and subtitle groups and correctly associates them with applicable video variants.
- [ ] 音频与字幕媒体轨的播放列表/资源存在且可访问；其语言、名称、默认和自动选择元数据与调用方配置一致。
- [ ] Audio and subtitle rendition playlists/resources exist and are accessible; their language, name, default, and autoselect metadata match caller configuration.
- [ ] 调用方可通过单个编排配置提交输入、全部变体/媒体轨、加密参数及输出路径，并通过一次执行获得完整结果或明确失败。
- [ ] Callers can submit the input, all variants/renditions, encryption parameters, and output paths through one orchestration configuration and receive a complete result or a clear failure from one execution.
- [ ] 编排配置支持视频、独立音频、字幕及本地/URL 密钥来源等多个具名输入，并能校验每个处理步骤的输入输出引用。
- [ ] The orchestration configuration supports multiple named inputs, including video, separate audio, subtitles, and local/URL key sources, and validates input/output references for every processing step.
- [ ] 处理步骤按配置顺序执行，首期覆盖转码/缩放、视频旋转/转置、时间裁剪和音频处理，并对无效步骤提供定位明确的错误。
- [ ] Processing steps execute in configured order; the first delivery covers transcoding/scaling, video rotation/transpose, time trimming, and audio processing, and reports invalid steps with clear locations.
- [ ] 输出可配置主播放列表或媒体播放列表、TS 或 fMP4 分片、分片命名模板和输出位置；主播放列表链接到全部声明的媒体播放列表。
- [ ] Outputs can configure master or media playlist, TS or fMP4 segments, segment filename template, and destination; the master playlist links to every declared media playlist.
- [ ] 启用 M3U8 JSON 后生成独立 JSON 旁路文件，解析结果保留标签、属性、条目顺序和 URI，且与原始 M3U8 一致。
- [ ] When M3U8 JSON is enabled, a separate JSON sidecar is generated; the parsed result preserves tags, attributes, entry order, and URIs and matches the original M3U8.
- [ ] 输出分片均使用与目标配置兼容的 HLS 加密方法；播放器可通过媒体播放列表中的密钥 URI 获取解密密钥，密钥字节不会出现在日志或播放列表中。
- [ ] All output segments use an HLS encryption method compatible with the target profile; players can retrieve decryption keys through the key URI in the media playlists, and key bytes do not appear in logs or playlists.
- [ ] 输入小于某个目标分辨率时，库不会放大该变体，且按照文档规定的跳过或报错策略处理。
- [ ] When the input is smaller than a target resolution, the library does not upscale that variant and follows the documented skip or error policy.
- [ ] 输出选项和输入选项被放置在正确的 FFmpeg/FFprobe 参数位置，且输入选项参与探测缓存键。
- [ ] Output and input options are placed in the correct FFmpeg/FFprobe argument positions, and input options are included in the probe cache key.
- [ ] 不兼容的多遍编码、重复路径和无效 HLS 配置在启动外部进程前被拒绝。
- [ ] Incompatible multi-pass encoding, duplicate paths, and invalid HLS configuration are rejected before starting an external process.
- [ ] 生成的主播放列表能引用所有变体播放列表，且所有引用路径均存在。
- [ ] The generated master playlist references every variant playlist, and every referenced path exists.
- [ ] 失败与中断场景不会返回成功状态，并符合已记录的临时文件与部分产物清理策略。
- [ ] Failure and interruption cases do not return success and follow the documented cleanup policy for temporary files and partial artifacts.
- [ ] 调用方可选择预检检查组；结果区分阻断错误、警告、信息和未知项，并明确说明哪些发现会阻止执行。
- [ ] Callers can select preflight check groups; results distinguish blocking errors, warnings, informational findings, and unknowns, and clearly state which findings prevent execution.
- [ ] 对 H.265/HEVC + MPEG-TS 等组合，预检分别报告 FFmpeg 本机生成能力与所选目标播放器配置的已知兼容性，不作无依据的通用可播承诺。
- [ ] For combinations such as H.265/HEVC with MPEG-TS, preflight reports local FFmpeg generation capability separately from known compatibility with the selected target player profile and makes no unsupported universal-playability claim.
- [ ] 未选择样片检查时，预检不会启动完整转码；选择样片检查时，其耗时和结果与静态检查分开展示。
- [ ] When sample checks are not selected, preflight does not start a full transcode; when selected, their runtime and results are reported separately from static checks.
- [ ] Docker 使用文档包含可复制的 HLS VOD 示例，相关自动化测试在项目支持的 PHPUnit 配置下通过。
- [ ] Docker usage documentation contains a reproducible HLS VOD example, and related automated tests pass with the project's supported PHPUnit configurations.

## 8. 验证计划
## 8. Verification plan

添加单元测试覆盖配置校验、FFmpeg/FFprobe 命令参数顺序、输入选项传播、缓存键和错误映射。
Add unit tests for configuration validation, FFmpeg/FFprobe argument ordering, input option propagation, cache keys, and error mapping.

集成测试必须分别检查视频、音频和字幕媒体播放列表的加密声明及实际分片；不能只检查视频变体播放列表。
Integration tests must inspect encryption declarations and actual segments in video, audio, and subtitle media playlists separately; checking only video variant playlists is insufficient.

在 Docker 环境执行有限时长的 HLS VOD 集成测试，检查播放列表语法、引用文件存在性及分片可探测性。
Run a finite-duration HLS VOD integration test in Docker and check playlist syntax, referenced-file existence, and segment probeability.

对每个预检检查组分别验证成功、警告、阻断错误和未知结果，并确认未选择样片检查时不会启动完整编码。
For each preflight check group, verify success, warning, blocking error, and unknown results, and confirm that a full encode does not start when sample checks are not selected.

使用明确的目标播放器配置测试已知兼容规则，并测试缺少播放器配置时返回警告或未知，而不是错误地报告通用兼容性。
Test known compatibility rules with explicit target player profiles, and verify that missing player profiles produce a warning or unknown result rather than an incorrect claim of universal compatibility.

记录集成验证时使用的 PHP、FFmpeg、FFprobe 和 PHPUnit 版本；若环境缺少所需 muxer/编码器，应明确跳过原因。
Record the PHP, FFmpeg, FFprobe, and PHPUnit versions used for integration verification; if the environment lacks a required muxer or encoder, clearly document the reason for skipping.

## 9. 风险与回滚
## 9. Risks and rollback

多文件输出使部分失败可能留下孤立分片或不完整播放列表；实现需定义临时输出和发布完成策略，并通过失败场景测试验证。
Multi-file output can leave orphaned segments or an incomplete playlist after partial failure; implementation must define temporary output and completion publication behavior and verify it with failure tests.

不同 FFmpeg 构建对 muxer、编码器和协议的支持不同；应通过能力探测或明确的运行时报错降低环境差异影响。
FFmpeg builds differ in muxer, encoder, and protocol support; capability probing or clear runtime errors should reduce the impact of environment differences.

输入、编码器、分片容器、加密方式、字幕格式和播放器的组合数量很大，无法在首期承诺穷举兼容；应限定首期支持矩阵，并让预检对矩阵外组合返回警告或未知。
The combinations of inputs, encoders, segment containers, encryption methods, subtitle formats, and players are too numerous to exhaustively support in the first delivery; define a bounded support matrix and have preflight return a warning or unknown for combinations outside it.

通过密钥 URL 获取密钥会引入网络授权、超时、重试和凭据保密要求；首期 URL 密钥支持范围应受限并明文记录，不能默认接受任意 URL 或把凭据写入 FFmpeg 命令日志。
Retrieving keys from URLs introduces network authorization, timeout, retry, and credential confidentiality requirements; first-delivery URL key support should be constrained and documented, must not accept arbitrary URLs by default, and must not write credentials to FFmpeg command logs.

Docker 中的 FFmpeg 5.1.9 试验显示，`hls_key_info_file` 为音频/视频 TS 播放列表添加 AES-128 密钥声明，但生成的 WebVTT 字幕播放列表没有加密声明；若字幕也必须加密，需额外实现字幕分片加密和播放列表更新，或选择经验证支持该要求的其他封装方案。
A test with Docker FFmpeg 5.1.9 showed that `hls_key_info_file` adds AES-128 key declarations to audio/video TS playlists, while the generated WebVTT subtitle playlist has no encryption declaration; if subtitles must also be encrypted, subtitle segment encryption and playlist updates need additional implementation, or another packaging approach verified to meet the requirement.

Docker 中的 FFmpeg 5.1.9 不识别 `sname` 变体映射参数；调用方指定字幕显示名称时，首期要么限定最低 FFmpeg 版本，要么由库生成/更新主播放列表中的名称元数据。
Docker FFmpeg 5.1.9 does not recognize the `sname` variant-map parameter; for caller-specified subtitle display names, the first delivery must either set a minimum FFmpeg version or have the library generate/update the name metadata in the master playlist.

若新增输出格式影响既有编码命令，可独立移除 HLS API 与相关测试回滚，不应要求迁移既有格式调用。
If the new output format affects existing encoding commands, the HLS API and related tests should be independently removable without requiring migration of existing format calls.

## 10. 待决问题
## 10. Open questions

- [ ] 默认 480p、720p、1080p 各变体的目标视频码率和音频处理策略是什么？负责人：项目维护者。
- [ ] What target video bitrate and audio handling policy should be used for the default 480p, 720p, and 1080p variants? Owner: project maintainer.
- [ ] 当输入尺寸低于一个或多个默认档位时，应跳过这些档位，还是将其视为配置错误？负责人：项目维护者。
- [ ] When the input dimensions are below one or more default tiers, should those tiers be skipped or treated as a configuration error? Owner: project maintainer.
- [ ] 首期字幕输入应支持从源视频映射内嵌字幕、外部字幕文件，还是两者都支持？首期应支持哪些字幕输入和输出格式？负责人：项目维护者。
- [ ] Should the first delivery support embedded subtitles mapped from the source video, external subtitle files, or both? Which subtitle input and output formats should be supported initially? Owner: project maintainer.
- [ ] 首期音频轨应支持从源视频映射音轨、外部音频文件，还是两者都支持？语言元数据缺失时应采用什么默认策略？负责人：项目维护者。
- [ ] Should the first delivery support audio tracks mapped from the source video, external audio files, or both? What default policy should apply when language metadata is missing? Owner: project maintainer.
- [ ] 首期密钥材料应由调用方以受保护文件还是密钥提供器接口传入？密钥 URI 与密钥文件的部署责任如何约定？负责人：项目维护者。
- [ ] Should the caller provide first-delivery key material through a protected file or key-provider interface? How should deployment responsibilities for the key URI and key file be defined? Owner: project maintainer.
- [ ] 首期是否要求 VOD 生成过程中动态轮换密钥？若要求，应由本库集成轮换回调，还是由外部密钥管理器更新 FFmpeg 使用的 key-info 文件？负责人：项目维护者。
- [ ] Must keys rotate dynamically during VOD generation in the first delivery? If so, should the library integrate a rotation callback, or should an external key manager update the key-info file used by FFmpeg? Owner: project maintainer.
- [ ] URL 输入/输出首期支持哪些协议和存储后端？密钥 URL 是否必须支持 HTTP(S) 鉴权、超时和重试配置？负责人：项目维护者。
- [ ] Which URL input/output protocols and storage backends should be supported initially? Must key URLs support HTTP(S) authentication, timeout, and retry configuration? Owner: project maintainer.
- [ ] 首期已建议采用严格有序步骤列表；是否确认将分支、循环和汇合/DAG 延后到后续阶段？负责人：项目维护者。
- [ ] The first delivery is proposed to use a strictly ordered step list; should branches, loops, joins, and DAG support be deferred to a later phase? Owner: project maintainer.
- [ ] 目标播放器兼容性应提供哪些内置配置，是否允许调用方传入自定义兼容规则？负责人：项目维护者。
- [ ] Which built-in target player profiles should be provided, and should callers be allowed to supply custom compatibility rules? Owner: project maintainer.
- [ ] 预检默认采用只报告、警告阻断还是严格失败策略？哪些检查需要调用方显式选择？负责人：项目维护者。
- [ ] Should preflight default to report-only, warning-blocking, or strict-failure behavior? Which checks must callers select explicitly? Owner: project maintainer.
- [ ] M3U8 JSON 的字段模式、版本策略和相对 URI 解析规则是什么？负责人：项目维护者。
- [ ] What are the field schema, versioning policy, and relative-URI resolution rules for M3U8 JSON? Owner: project maintainer.
- [ ] 输出到多个目录/目标时，成功发布是否需要临时目录加原子切换，还是允许逐项生成并返回部分成功结果？负责人：项目维护者。
- [ ] When writing to multiple directories/targets, should successful publication use a staging directory and atomic switch, or may outputs be generated individually with partial-success results? Owner: project maintainer.
- [ ] 首期是否同时支持 MPEG-TS 与 fMP4 分片？默认分片格式应为何？负责人：项目维护者。
- [ ] Should the first delivery support both MPEG-TS and fMP4 segments? What should the default segment format be? Owner: project maintainer.
- [ ] “加密必不可少”是否要求 WebVTT 字幕分片也必须加密？若是，是否接受由库额外加密字幕分片并更新字幕播放列表？负责人：项目维护者。
- [ ] Does “encryption is essential” require WebVTT subtitle segments to be encrypted as well? If so, should the library additionally encrypt subtitle segments and update their playlists? Owner: project maintainer.
- [ ] 各分片类型首期支持哪些 HLS 加密方法和播放器配置？是否以 TS + AES-128 作为基础组合，并将 fMP4 的兼容加密方法单独定义？负责人：项目维护者。
- [ ] Which HLS encryption methods and player profiles should be supported for each segment type initially? Should TS with AES-128 be the baseline, with a separate compatible encryption method defined for fMP4? Owner: project maintainer.
- [ ] 首期最低支持的 FFmpeg 版本是什么？字幕显示名称是否由 FFmpeg 负责，还是由库补写主播放列表？负责人：项目维护者。
- [ ] What is the minimum FFmpeg version for the first delivery? Should FFmpeg provide subtitle display names, or should the library write them into the master playlist? Owner: project maintainer.
- [ ] 输入选项应采用 `open()` 可选参数、输入配置对象，还是独立的 HLS 输入 API？负责人：项目维护者。
- [ ] Should input options use an optional `open()` parameter, an input configuration object, or a dedicated HLS input API? Owner: project maintainer.

## 11. 实施记录
## 11. Implementation notes

本规格根据当前代码审视创建；当前仓库没有 HLS 专用输出格式、输入探测选项或 HLS 自动化测试。
This specification was created from a review of the current code; the repository currently has no HLS-specific output format, input probe options, or HLS automated tests.

使用 Docker 中的 FFmpeg 5.1.9 对 `/Users/macbookpro/Devs/samples/26.mp4` 做了只读输入试验，并将 8 秒样片和所有产物放在仓库之外的 `/private/tmp/php-ffmpeg`。
A read-only input trial used Docker FFmpeg 5.1.9 with `/Users/macbookpro/Devs/samples/26.mp4`; the 8-second clip and all generated artifacts were kept outside the repository in `/private/tmp/php-ffmpeg`.

后续 HLS 功能验证应使用 FFmpeg 官方最新稳定版；截至 2026-10-03，该版本为 9.0.2。FFmpeg 5.1.9 的结果仅作为旧版本参考，不能据此确定新版行为或首期最低支持版本。
Future HLS feature verification should use the latest stable FFmpeg release; as of 2026-10-03, that release is 9.0.2. Results from FFmpeg 5.1.9 are legacy reference only and do not establish newer behavior or the minimum version for the first delivery.

Docker 开发镜像目前通过 Debian Bookworm 软件源安装 FFmpeg，因此实际提供的版本受该发行版软件包约束；后续验证需提供独立的最新 FFmpeg 测试环境，并记录 FFmpeg 与 FFprobe 的准确版本及构建能力。
The Docker development image currently installs FFmpeg from Debian Bookworm repositories, so its version is constrained by that distribution; future verification must provide a separate latest-FFmpeg test environment and record the exact FFmpeg and FFprobe versions and build capabilities.

已为 Docker 开发环境增加可选的 `php-ffmpeg9` 构建目标：它下载 BtbN 发布的 FFmpeg 9.0.2 GPL 静态预编译包，支持 `amd64` 与 `arm64`，默认 `php` 服务仍使用 Debian 软件包版本。首次构建需下载约 120–145 MiB，不需要从源码编译；FFmpeg 与 FFprobe 版本检查命令见 `doc/DOCKER.md`。
An optional `php-ffmpeg9` build target has been added to the Docker development environment. It downloads BtbN's FFmpeg 9.0.2 GPL static prebuilt package for `amd64` or `arm64`, while the default `php` service continues to use the Debian package version. The first build downloads about 120–145 MiB and does not compile from source; see `doc/DOCKER.md` for FFmpeg and FFprobe version-check commands.

已在当前 ARM64 Docker 环境成功构建该镜像；容器中的 FFmpeg 与 FFprobe 均报告 `n9.0.2-14-gebafaee10a-20260928`，且 `libx264` 与 `libx265` 编码器可用。
The image built successfully in the current ARM64 Docker environment; both FFmpeg and FFprobe in the container report `n9.0.2-14-gebafaee10a-20260928`, and the `libx264` and `libx265` encoders are available.

随后在该容器中运行 PHPUnit：554 个测试、1132 条断言，4 个错误、10 个跳过；4 个错误都来自 `AdvancedMedia` 将第三方构建版本字符串 `n9.0.2-14-gebafaee10a-20260928` 直接传给 `version_compare()`，从而把现代滤镜误判为版本不兼容。该结果表明 PHP-FFMpeg 当前版本探测/比较逻辑与此类 FFmpeg 9 构建字符串不兼容。
PHPUnit was then run in this container: 554 tests and 1,132 assertions, with 4 errors and 10 skipped tests. All 4 errors came from `AdvancedMedia` passing the third-party build version string `n9.0.2-14-gebafaee10a-20260928` directly to `version_compare()`, which incorrectly classified modern filters as incompatible. This shows that the current PHP-FFMpeg version detection/comparison logic is incompatible with this style of FFmpeg 9 build string.

版本比较问题已修复：`FFMpegDriver::getVersion()` 保留完整构建版本供诊断，新增的 `getVersionNumber()` 提取数值版本，滤镜兼容性判断和对应功能测试改为使用规范化版本；新增回归用例覆盖带 `n` 前缀的上游构建标识与 Debian 包后缀。
The version comparison issue has been fixed: `FFMpegDriver::getVersion()` retains the complete build version for diagnostics, while the new `getVersionNumber()` extracts the numeric version. Filter compatibility checks and their functional test now use the normalized version; regression cases cover the `n`-prefixed upstream build identifier and Debian package suffix.

修复后，FFmpeg 9 Docker 环境中的 PHPUnit 全量结果为 556 个测试、1142 条断言、9 个跳过，全部通过。
After the fix, the full PHPUnit run in the FFmpeg 9 Docker environment passed: 556 tests, 1,142 assertions, and 9 skipped.

同一修复在默认 Debian FFmpeg Docker 环境也通过全量 PHPUnit：556 个测试、1188 条断言、9 个跳过。
The full PHPUnit suite also passed with the default Debian FFmpeg Docker environment after the same fix: 556 tests, 1,188 assertions, and 9 skipped.

从 `/Users/macbookpro/Devs/samples/26.mp4` 截取的 8 秒样片，在 FFmpeg 9 中成功生成加密的 H.264 HLS 主播放列表和 480p、720p、1080p 三档媒体播放列表；FFprobe 解密读取三个变体后分别识别出 854×480、1280×720 和 1920×1080。另一次 H.265 MPEG-TS + AES-128 试验虽能生成并被 FFprobe 探测，但不符合本项目的 Apple HEVC HLS authoring profile，结果应记为目标兼容性失败；该配置必须改用 fMP4。试验产物保存在仓库外的 `/private/tmp/php-ffmpeg/ffmpeg9`。
An 8-second clip cut from `/Users/macbookpro/Devs/samples/26.mp4` successfully produced an encrypted H.264 HLS master playlist and 480p, 720p, and 1080p media playlists in FFmpeg 9. FFprobe decrypted and read the three variants, identifying 854×480, 1280×720, and 1920×1080 respectively. A separate H.265 MPEG-TS plus AES-128 trial generated artifacts and was probeable, but failed compatibility with this project's Apple HEVC HLS authoring profile; this configuration must use fMP4. Test artifacts are outside the repository at `/private/tmp/php-ffmpeg/ffmpeg9`.

源视频为 3840×2160、H.264、约 29.97 fps、76.21 秒，只有视频轨；因此独立音频和字幕试验使用了额外生成的测试音频与 WebVTT 字幕输入。
The source video is 3840×2160 H.264 at about 29.97 fps and 76.21 seconds long, with a video stream only; separate-audio and subtitle trials therefore used additional generated test audio and WebVTT subtitle inputs.

FFmpeg 5.1.9 成功生成了 480p、720p、1080p 的 HLS MPEG-TS 变体及主播放列表，并使用 AES-128 加密视频分片；FFprobe 在允许本地 `.key` 扩展名后成功读取了加密媒体播放列表。
FFmpeg 5.1.9 successfully generated 480p, 720p, and 1080p HLS MPEG-TS variants and a master playlist, and encrypted the video segments with AES-128; FFprobe read the encrypted media playlist after local `.key` extensions were allowed.

FFmpeg 5.1.9 也成功生成了独立 AAC 音频组和 WebVTT 字幕组；但字幕分片未带加密声明，且 `sname` 参数不受该版本支持，相关限制已记录在风险和待决项中。
FFmpeg 5.1.9 also successfully generated a separate AAC audio group and WebVTT subtitle group; however, subtitle segments had no encryption declaration, and the version did not support the `sname` parameter. These limitations are recorded in the risks and open questions.

FFprobe 默认拒绝通过本地清单读取扩展名为 `.key` 的密钥资源；测试必须显式允许所需扩展名，生产预检不应因此无条件放开所有协议或文件类型。
FFprobe rejects local `.key` resources referenced by a playlist by default; tests must explicitly allow the required extension, and production preflight must not respond by unconditionally allowing all protocols or file types.

使用 libx265 将短样片编码为 H.265 并封装为 HLS MPEG-TS 后，FFprobe 能识别 HEVC 视频流；这只是工具链探测结果。按本项目目标配置，此输出不合规，必须使用 fMP4，不能将其描述为 HLS HEVC 支持已验证。
A short sample encoded with libx265 as H.265 and packaged as HLS MPEG-TS was recognized by FFprobe as HEVC; this is only a toolchain probing result. Under this project's target profile the output is nonconforming and must use fMP4, so it cannot be described as validated HLS HEVC support.

项目维护者已确认独立音频和字幕属于需求范围，已纳入首期需求；具体字幕/音频来源及媒体格式仍待评审确定。
The project maintainer confirmed that separate audio and subtitles are in scope; they are included in the first-delivery requirements, while their exact sources and media formats remain subject to review.

项目维护者确认 HLS 加密是必需能力；本规格已将兼容所选分片类型和目标配置的加密设为首期强制要求，具体加密方法与动态密钥轮换机制仍待评审决定。
The project maintainer confirmed that HLS encryption is required; this specification makes encryption compatible with the selected segment type and target profile mandatory for the first delivery, while the exact encryption method and dynamic key rotation remain subject to review.

实现与验证结果将在需求和设计评审完成后补充。
Implementation and verification results will be added after requirements and design review.
