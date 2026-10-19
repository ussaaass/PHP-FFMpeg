# SDD：CTR-HLS V2 无 Sidecar 播放与对象 URI 契约
# SDD: CTR-HLS V2 Sidecar-Free Playback and Object URI Contract

> 状态：Implementing；V2 设计与格式已批准；T0–T6 已完成；T7 本地 Docker Chromium 验收通过但 RustFS/CDN 与真机验收未完成；T8 尚有文档和验收项待核销；V1 明确不兼容且不支持。
> Status: Implementing; the V2 design and format are approved; T0–T6 are complete; local Docker Chromium acceptance for T7 passed, while RustFS/CDN and physical-device acceptance remain incomplete; T8 still has documentation and acceptance items to close; V1 is explicitly unsupported and incompatible.
> 创建日期：2026-10-20
> Created: 2026-10-20
> 负责人：项目维护者
> Owner: Project maintainers
> 关联格式：[CTR-HMAC 媒体记录格式 V2](CTR-HMAC-RECORD-FORMAT-V2.md)
> Related format: [CTR-HMAC Media Record Format V2](CTR-HMAC-RECORD-FORMAT-V2.md)
> 前置设计：[CTR-HMAC 媒体记录格式 V1](CTR-HMAC-RECORD-FORMAT-V1.md)、[CTR-HLS 加密与播放器 SDD](SDD-20261006-hls-ctr-encryption-and-player.md)
> Prior designs: [CTR-HMAC Media Record Format V1](CTR-HMAC-RECORD-FORMAT-V1.md), [CTR-HLS encryption and player SDD](SDD-20261006-hls-ctr-encryption-and-player.md)

## 1. 背景与问题
## 1. Background and problem

当前 CTR-HMAC V1 要求每个密文分片旁边存在 JSON sidecar；sidecar 保存 `contentId`、记录表、对象长度、Key 标识和播放 Key URI。
CTR-HMAC V1 currently requires a JSON sidecar next to every encrypted segment; the sidecar stores the `contentId`, record list, object length, key identifier, and playback key URI.

当前浏览器 loader 对每个分片追加 `.json` 并发起 HTTP 请求，再逐片调用 KeyProvider；这增加请求数，并使密文对象无法独立解析和续传。
The current browser loader appends `.json` to every segment URL and makes an HTTP request, then calls the KeyProvider for every segment; this increases request count and prevents the ciphertext object from being parsed and resumed independently.

播放器需要在加载 master playlist 前取得本次视频播放所需的 Key；所有 rendition 和分片在同一播放会话内复用该视频级主密钥。
The player must obtain the key for the video before loading the master playlist; all renditions and segments reuse that video-level master key during the playback session.

本设计将协议升级为 V2；V1 格式和文档保持冻结，不得把 V2 字节流误解析为 V1。
This design upgrades the protocol to V2; the V1 format and document remain frozen, and V2 byte streams must never be misparsed as V1.

V1 的逐片 JSON sidecar 是重大设计缺陷；它仅保留为历史记录，维护中的打包器和播放器不得生成或读取 V1。
The per-segment JSON sidecar in V1 is a major design defect; V1 is retained only as a historical record, and maintained packagers and players must neither emit nor read V1.

已有 V1 内容不提供自动迁移或兼容播放；需要从原始媒体重新打包为 V2。
Existing V1 content receives no automatic migration or compatible playback; it must be repackaged as V2 from the original media.

## 2. 目标与范围
## 2. Goals and scope

### 目标
### Goals

- **GOAL-1：** 播放器只依赖播放信息、master/media playlist、分片 URI 和 V2 密文对象完成取钥、记录解析、认证、解密与 Range 续传；播放中不请求逐片 sidecar 或等价元数据端点。
- **GOAL-1:** The player uses only playback information, master/media playlists, segment URIs, and V2 ciphertext objects for key retrieval, record parsing, authentication, decryption, and Range resumption; it makes no per-segment sidecar or equivalent metadata request during playback.

- **GOAL-2：** 每个视频播放会话通过播放时提供的 Key URI 获取一次原打包主密钥，并在加载 master playlist 前完成。
- **GOAL-2:** Each video playback session retrieves the original packaging master key once through the Key URI supplied at playback time, before loading the master playlist.

- **GOAL-3：** PHP 加密端与浏览器 Worker 使用同一 V2 格式；对象身份和每条记录的 counter 均可从密文对象本身解析。
- **GOAL-3:** The PHP encryptor and browser Worker use the same V2 format; object identity and each record's counter are parseable from the ciphertext object itself.

- **GOAL-4：** 支持 playlist 为具体对象 URI 动态添加短期签名；分片及其 Range/续传请求保留同一 URI 上的有效授权。
- **GOAL-4:** Support dynamically adding short-lived signatures to concrete object URIs in playlists; segment and Range/resume requests retain valid authorization on the same URI.

- **GOAL-5：** 定义稳定、无算法标记的对象路径契约；路径只定位对象，不代替签名授权。
- **GOAL-5:** Define a stable object-path contract without an algorithm marker; the path locates an object and does not replace signature authorization.

### 不在本次范围
### Out of scope

- 本次不接入 `zb_base`、数据库、完整 VOD API、生产 OSS/RustFS 上传、图片处理或上传编排。
- This work does not integrate `zb_base`, databases, a complete VOD API, production OSS/RustFS uploads, image processing, or upload orchestration.

- 本次不实现 DRM、FairPlay、Widevine、密钥轮换、生产密钥管理服务或密钥授权策略；应用仍负责资产与 Key 的映射及访问授权。
- This work does not implement DRM, FairPlay, Widevine, key rotation, a production key-management service, or key-authorization policy; the application remains responsible for mapping assets to keys and authorizing access.

- 本次不改变 FFmpeg 上游 HLS muxer，不宣称 V2 是 RFC 8216 标准加密格式。
- This work does not modify FFmpeg's upstream HLS muxer and does not claim that V2 is an RFC 8216 standard encryption format.

- 首期 V2 仅覆盖有限时长的 VOD fMP4 HLS；不覆盖 Live、事件型 playlist、低延迟 HLS、增量发布或 playlist 中途追加分片。
- The first V2 release covers finite-duration VOD fMP4 HLS only; it does not cover Live, Event playlists, Low-Latency HLS, incremental publication, or appending segments to a playlist after playback begins.

- 本次不改变 V1 历史记录中的字节布局；维护中的代码不得读取或生成 V1，也不自动迁移已有 V1 密文对象。
- This work does not change the byte layout recorded in the V1 historical specification; maintained code must neither read nor emit V1, and existing V1 ciphertext objects are not migrated automatically.

## 3. 用户场景
## 3. User scenarios

- **SCENARIO-1：** 应用为某视频准备播放信息，其中包含调用方提供的 `assetId`、非秘密 `keyId`、Key URI、master playlist URI 和发布版本标识；播放器收到该信息后先取 Key，再开始加载 playlist。
- **SCENARIO-1:** The application prepares playback information containing the caller-supplied `assetId`, non-secret `keyId`, Key URI, master-playlist URI, and publication version identifier; after receiving it, the player retrieves the key before loading the playlist.

- **SCENARIO-2：** 播放器通过 master playlist 在多个 rendition 间切换；所有分片使用同一视频级主密钥，但每个密文对象通过独立 `contentId` 派生不同 AES/HMAC 子密钥。
- **SCENARIO-2:** The player switches between renditions through the master playlist; all segments use the same video-level master key, while each ciphertext object derives distinct AES/HMAC subkeys from its own `contentId`.

- **SCENARIO-3：** 分片 GET 在一条认证记录中途断开；播放器丢弃未完成记录，从最后一条完整认证记录后的对象 byte offset 发送 Range 和 `If-Range`。
- **SCENARIO-3:** A segment GET is interrupted in the middle of an authenticated record; the player discards the incomplete record and sends Range and `If-Range` from the object byte offset after the last complete authenticated record.

- **SCENARIO-4：** 应用重新打包同一视频并提供新的 `versionId`；新对象使用新的 `contentId`，旧版本 URI 不被覆盖或与新版本 Range 拼接。
- **SCENARIO-4:** The application repackages the same video and supplies a new `versionId`; new objects use new `contentId` values, and old-version URIs are neither overwritten nor combined with new-version Range responses.

## 4. 需求与预期行为
## 4. Requirements and expected behavior

### 4.1 播放信息与 Key URI
### 4.1 Playback information and Key URI

- **REQ-KEY-1：** 播放器入口接收应用在播放时提供的结构化 `PlaybackInfo`；其必需字段为 `assetId`、`keyId`、`keyUri`、`masterPlaylistUri`、`versionId` 和 V2 profile。
- **REQ-KEY-1:** The player entry point accepts structured `PlaybackInfo` supplied by the application at playback time; required fields are `assetId`, `keyId`, `keyUri`, `masterPlaylistUri`, `versionId`, and the V2 profile.

- **REQ-KEY-2：** `assetId`、`keyId`、`versionId` 和播放 URI 均由调用方提供；SDK 不创建资产/Key 映射，不生成应用级资产 ID 或发布版本 ID。
- **REQ-KEY-2:** The caller supplies `assetId`, `keyId`, `versionId`, and playback URIs; the SDK does not create the asset-to-key mapping or generate application-level asset or publication-version IDs.

- **REQ-KEY-3：** 播放器必须在加载 master playlist 前使用本次 `PlaybackInfo.keyUri` 获取主密钥；成功后同一个播放器实例对所有 rendition、分片、seek 和 ABR 切换复用该密钥，不得逐片请求 Key。
- **REQ-KEY-3:** Before loading the master playlist, the player must retrieve the master key through the current `PlaybackInfo.keyUri`; after success, the player instance reuses that key for all renditions, segments, seeks, and ABR switches and must not request a key per segment.

- **REQ-KEY-4：** Key URI 是应用的取 Key 接口地址，不是密钥本身；Key 字节不得放在 URL path/query、playlist、对象路径、日志或错误信息中。
- **REQ-KEY-4:** The Key URI is the application's key-retrieval endpoint, not the key itself; key bytes must not appear in URL paths/queries, playlists, object paths, logs, or error messages.

- **REQ-KEY-5：** Key URI 支持两种响应：`application/octet-stream` 的正文直接包含恰好 32 字节主密钥；或 `application/json` 返回 `{"key":"<hex>"}`，其中 `key` 是 PHP `bin2hex()` 形式的 64 个小写十六进制字符。两种方式得到的字节必须与打包时主密钥逐字节相同；不得接受 Base64、裸字符串或按内容猜测编码。
- **REQ-KEY-5:** The Key URI supports two response forms: an `application/octet-stream` body containing exactly the 32-byte master key, or `application/json` containing `{"key":"<hex>"}`, where `key` is 64 lowercase hexadecimal characters in PHP `bin2hex()` form. The resulting bytes must match the packaging master key byte for byte; Base64, bare strings, and content-sniffed encodings are rejected.

- **REQ-KEY-5a：** 播放器必须按响应 `Content-Type` 的 media type（忽略大小写及可选参数）选择唯一解析方式；缺失或不支持的 media type、非法 JSON、非 64 位小写 Hex、缺少 `key` 字段或解码后长度不符时，必须在加载 master playlist 前失败。
- **REQ-KEY-5a:** The player must select exactly one parser based on the response `Content-Type`; a mismatched, missing, or unsupported `Content-Type`, invalid JSON, anything other than 64 lowercase hexadecimal characters, a missing `key` field, or an incorrect decoded length must fail before loading the master playlist.

- **REQ-KEY-6：** 浏览器 Key 请求必须通过可配置请求选项携带应用所需的 cookie/header；认证方式由宿主应用控制，SDK 不硬编码 Token、Cookie 或应用账户逻辑。
- **REQ-KEY-6:** The browser key request must carry application-required cookies/headers through configurable request options; the host application controls authentication, and the SDK does not hardcode tokens, cookies, or account logic.

解析 `Content-Type` 时 media type 大小写不敏感，并忽略可选参数（例如 `charset=utf-8`）。
When parsing `Content-Type`, the media type is case-insensitive and optional parameters (such as `charset=utf-8`) are ignored.

- **REQ-KEY-7：** 错误 Key 长度、Key URI 请求拒绝/超时/取消、`keyId` 缺失或播放信息不完整时必须在加载 master playlist 前失败；不得匿名重试、使用演示 Key 或回退到明文。
- **REQ-KEY-7:** An incorrect key length, denied/timed-out/cancelled Key URI request, missing `keyId`, or incomplete playback information must fail before loading the master playlist; the player must not retry anonymously, use a demo key, or fall back to clear media.

- **REQ-KEY-8：** Key URI 只接受 HTTP `200`；其他状态码（包括 `206`、`204`、`401` 和 `403`）均在 master playlist 请求前失败。JSON 根值必须是对象且 `key` 必须是字符串；额外字段允许但不参与取 Key 或 `keyId` 校验。
- **REQ-KEY-8:** The Key URI accepts only HTTP `200`; all other status codes (including `206`, `204`, `401`, and `403`) fail before the master-playlist request. The JSON root must be an object and `key` must be a string; additional fields are allowed but are ignored for key retrieval and `keyId` validation.

### 4.2 对象路径与 URI
### 4.2 Object path and URI

- **REQ-URI-1：** 未签名对象路径格式为 `/media/{assetIdHex}/{keyId}/{shortEdgePixels}/{versionId}/{md5Prefix}-{sequence5}.m4s`；`assetIdHex` 是 `assetId` 的 8 字节无符号大端值的小写十六进制形式（16 字符），`keyId` 与 `shortEdgePixels` 使用无前导零的规范十进制，`sequence5` 固定为五位补零十进制。
- **REQ-URI-1:** The unsigned object path format is `/media/{assetIdHex}/{keyId}/{shortEdgePixels}/{versionId}/{md5Prefix}-{sequence5}.m4s`; `assetIdHex` is the lowercase hexadecimal form (16 characters) of the 8-byte unsigned big-endian `assetId`, `keyId` and `shortEdgePixels` use canonical decimal without leading zeroes, and `sequence5` is fixed-width five-digit zero-padded decimal.

- **REQ-URI-2：** `assetId`、数字 `keyId`、`shortEdgePixels` 与 `versionId` 是调用方提供的非密钥标识；数字字段按本 SDD 的固定形式序列化，`versionId` 必须作为单一路径段安全编码或拒绝路径分隔符/路径穿越，不得把 Key 字节放入路径。
- **REQ-URI-2:** `assetId`, numeric `keyId`, `shortEdgePixels`, and `versionId` are caller-supplied non-secret identifiers; numeric fields use the canonical forms defined here, while `versionId` must be safely encoded as one path segment or rejected if it contains separators/path traversal; key bytes must never appear in paths.

- **REQ-URI-3：** `sequence` 是 rendition 内从 0 开始的 HLS 分片序号，范围为 `0–65535`；文件名固定输出为五位十进制并左侧补零。`md5Prefix` 是 UTF-8 字节串 `{assetIdDecimal}-{shortEdgePixels}-{sequence}` 的 MD5 小写十六进制结果前 3 个字符，哈希输入中的数字均使用规范十进制表示。
- **REQ-URI-3:** `sequence` is the zero-based HLS segment sequence within a rendition, ranging from `0–65535`; filenames always use five-digit decimal with leading zeroes. `md5Prefix` is the first 3 lowercase hexadecimal characters of the MD5 digest of UTF-8 `{assetIdDecimal}-{shortEdgePixels}-{sequence}`, with all numeric values in the hash input using canonical decimal form.

- **REQ-URI-4：** 文件扩展名固定为 `.m4s`，路径和文件名不得出现 `ctr`、`encrypted` 等算法或加密状态标记；加密 profile 由播放信息和播放器配置识别。
- **REQ-URI-4:** The file extension is `.m4s`; paths and filenames must not contain algorithm or encryption-state markers such as `ctr` or `encrypted`; the playback information and player configuration identify the encryption profile.

- **REQ-URI-5：** MD5 前缀仅用于文件命名，不用于对象认证、密钥派生、签名、保密或授权；具体对象授权必须由 URI 签名或宿主应用的等效请求授权提供。
- **REQ-URI-5:** The MD5 prefix is only for filename construction and is not used for object authentication, key derivation, signing, confidentiality, or authorization; authorization for a concrete object must be provided by URI signing or equivalent host-application request authorization.

- **REQ-URI-6：** 每个密文对象 URI 必须包含具体 `assetId`、数字 `keyId`、短边像素值、调用方提供的不可变 `versionId` 和分片序号；同一路径不得覆盖不同发布版本的对象。
- **REQ-URI-6:** Each ciphertext object URI must contain the concrete `assetId`, numeric `keyId`, short-edge pixel value, caller-supplied immutable `versionId`, and segment sequence; an object from another publication version must never overwrite the same path.

- **REQ-URI-7：** 动态 playlist 可以为每个分片 URI 加入短期签名；hls.js 与自定义 loader 必须保留签名 query 参数，Range/续传请求必须使用同一个完整 URI 和仍有效的授权。
- **REQ-URI-7:** A dynamically assembled playlist may add a short-lived signature to each segment URI; hls.js and the custom loader must preserve signature query parameters, and Range/resume requests must use the same complete URI with still-valid authorization.

- **REQ-URI-8：** 签名必须授权到具体对象 URI 和发布版本，不得把主密钥或其编码形式作为 URL 凭证；签名不得被错误日志或验收报告泄漏。
- **REQ-URI-8:** A signature must authorize a concrete object URI and publication version; the master key or any encoding of it must not be used as a URL credential, and signatures must not leak into error logs or acceptance reports.

- **REQ-URI-9：** rendition 内分片序号超过 `65535` 时必须明确失败，不得扩展位宽、截断或覆盖既有对象；16 位字段最多表示 65,536 个分片，按每片 5 秒计算约为 327,680 秒（约 3.79 天），足以覆盖 50,000 秒目标。
- **REQ-URI-9:** A segment sequence above `65535` within a rendition must fail explicitly; the 16-bit field represents at most 65,536 segments, or about 327,680 seconds (about 3.79 days) at 5 seconds per segment, which covers the 50,000-second target.

- **REQ-URI-10：** 签名有效期由宿主应用/API 的签发策略和 CDN/对象服务验证配置决定，SDK 不规定固定时长；部署方应按播放与 Range 重试策略配置有效期。若授权在续传前过期，客户端必须明确失败，不得拼接未经授权或不同版本的响应。
- **REQ-URI-10:** Signature validity is determined by the host application/API issuance policy and CDN/object-service validation configuration; the SDK does not prescribe a fixed duration, and the deployer should configure validity for its playback and Range-retry policy. If authorization expires before resumption, the client must fail explicitly and must not combine unauthorized or different-version responses.

### 4.2.1 HLS playlist 约束
### 4.2.1 HLS playlist constraints

CTR 插件不解析或改写 HLS playlist；playlist、master playlist、音轨/字幕组织、ABR 与标签语义由 hls.js 处理。插件接收播放器交付的媒体对象请求，对 V2 密文对象执行流式读取、认证和解密，再按 hls.js loader 契约交付明文；未加密资源按既有 loader 流程处理。
The CTR plugin does not parse or rewrite HLS playlists; hls.js handles playlists, master playlists, audio/subtitle organization, ABR, and tag semantics. The plugin receives media-object requests from the player, streams, authenticates, and decrypts V2 ciphertext objects, then returns clear bytes through the hls.js loader contract; unencrypted resources follow the existing loader flow.

本节的 playlist 要求只约束本仓库的 PHP 打包器所生成/改写的 VOD playlist，不构成 CTR 插件对所有 HLS 标签或媒体类型的重新定义。
Playlist requirements in this section constrain only VOD playlists generated or rewritten by this repository's PHP packager; they do not redefine which HLS tags or media types the CTR plugin supports.

- **REQ-PLAYLIST-1：** 输入和输出必须是有限 VOD playlist；媒体 playlist 必须具有固定分片顺序和 `EXT-X-ENDLIST`，打包完成后不得再改变该 `versionId` 下的对象或 playlist 内容。
- **REQ-PLAYLIST-1:** Input and output must be finite VOD playlists; media playlists must have a fixed segment order and `EXT-X-ENDLIST`, and objects or playlist contents under a `versionId` must not change after packaging completes.

- **REQ-PLAYLIST-2：** V2 是自定义播放器格式，不是 RFC 8216 的 HLS 加密标记；V2 playlist 不得添加 `EXT-X-KEY` 或将密文对象声明为 `AES-128`/`SAMPLE-AES`。播放器只能经自定义 loader/Worker 对 V2 对象解密后，把明文媒体单元交给 hls.js/MSE。
- **REQ-PLAYLIST-2:** V2 is a custom-player format, not an RFC 8216 HLS encryption declaration; a V2 playlist must not add `EXT-X-KEY` or declare ciphertext objects as `AES-128`/`SAMPLE-AES`. The player must decrypt V2 objects through its custom loader/Worker before passing clear media units to hls.js/MSE.

- **REQ-PLAYLIST-3：** 打包器仅改写被加密媒体分片的 URI；必须保留 rendition 结构、codec/resolution/bandwidth 声明、`EXTINF`、分片顺序、`EXT-X-MAP` 和 `EXT-X-ENDLIST` 语义。动态签名由宿主应用/API 添加，不得把签名写回加密产物或打包报告。
- **REQ-PLAYLIST-3:** The packager rewrites only URIs of encrypted media segments; it must preserve rendition structure, codec/resolution/bandwidth declarations, `EXTINF`, segment order, and the semantics of `EXT-X-MAP` and `EXT-X-ENDLIST`. The host application/API adds dynamic signatures, which must not be written into encrypted artifacts or packaging reports.

### 4.3 CTR-HMAC V2 密文对象
### 4.3 CTR-HMAC V2 ciphertext object

- **REQ-FMT-1：** V2 使用独立 profile 标识 `phpffmpeg-ctr-hmac-v2`；不兼容格式变化不得复用 V1 profile 名称。
- **REQ-FMT-1:** V2 uses the separate profile identifier `phpffmpeg-ctr-hmac-v2`; incompatible format changes must not reuse the V1 profile name.

- **REQ-FMT-2：** 每个对象以固定 40 字节前导区开始：`0–7` 为 ASCII `PFFHLS2\n`；`8–15` 为无符号 64 位大端 `assetId`；`16–17` 为范围 `0–1023` 的无符号 16 位大端 `keyId`；`18–19` 为范围 `1–65535` 的无符号 16 位大端短边像素值；`20–21` 为范围 `0–65535` 的无符号 16 位大端 HLS 分片序号；`22–23` 必须为零；`24–39` 为 CSPRNG 生成的 16 字节 `contentId`。
- **REQ-FMT-2:** Each object begins with a fixed 40-byte preamble: bytes `0–7` are ASCII `PFFHLS2\n`; `8–15` are the unsigned 64-bit big-endian `assetId`; `16–17` are the unsigned 16-bit big-endian `keyId` in range `0–1023`; `18–19` are the unsigned 16-bit big-endian short-edge pixel value in range `1–65535`; `20–21` are the unsigned 16-bit big-endian HLS segment sequence in range `0–65535`; `22–23` must be zero; and `24–39` are the 16-byte CSPRNG-generated `contentId`.

- **REQ-FMT-13：** 播放器必须在处理记录前检查前导 `assetId` 和 `keyId` 与 PlaybackInfo 完全一致；任一不一致都必须拒绝对象，不得尝试另一 Key 或回退到其他 profile。
- **REQ-FMT-13:** Before processing records, the player must verify that preamble `assetId` and `keyId` exactly match PlaybackInfo; any mismatch must reject the object without trying another Key or falling back to another profile.

- **REQ-FMT-3：** 重新加密或重新打包必须生成新的 `contentId`；失败任务必须删除部分密文，并在重新加密时重新生成 ID，不得从不完整密文继续复用旧 counter。
- **REQ-FMT-3:** Re-encryption or repackaging must generate a new `contentId`; failed jobs must delete partial ciphertext and generate a new ID on re-encryption rather than reusing old counters to continue incomplete ciphertext.

- **REQ-FMT-4：** 每条记录使用 24 字节 header 与 32 字节 HMAC tag：序号为 4 字节无符号大端记录序号，counter 为 16 字节；末 4 字节为 `lengthAndFlags`，最高位表示 `FINAL`，低 31 位表示 1–65,536 字节密文长度。
- **REQ-FMT-4:** Each record uses a 24-byte header and a 32-byte HMAC tag: a 4-byte unsigned big-endian record sequence, a 16-byte counter, and a 4-byte `lengthAndFlags` field whose most significant bit is `FINAL` and whose lower 31 bits contain the 1–65,536-byte ciphertext length.

- **REQ-FMT-5：** 每条记录明文最多 65,536 字节；解析密文长度前必须屏蔽 `lengthAndFlags` 的 `FINAL` 位；记录总长为 `24 + ciphertextLength + 32` 字节；对象记录直接串接且必须以唯一末记录结束标记结束。
- **REQ-FMT-5:** Each record contains at most 65,536 clear bytes; the `FINAL` bit in `lengthAndFlags` must be masked before parsing ciphertext length; record length is `24 + ciphertextLength + 32` bytes; records are concatenated directly and must end with exactly one terminal-record marker.

- **REQ-FMT-6：** 每个对象以 `contentId` 原始 16 字节为 HKDF salt；AES/HMAC HKDF `info` 同时绑定 `assetId`、`keyId`、短边像素值和 HLS 分片序号，并独立派生 16 字节 AES 与 32 字节 HMAC 子密钥。不得把 32 字节视频主密钥直接用于 AES 或 HMAC。
- **REQ-FMT-6:** Each object uses the raw 16-byte `contentId` as the HKDF salt; AES/HMAC HKDF `info` also binds `assetId`, `keyId`, short-edge pixel value, and HLS segment sequence, deriving independent 16-byte AES and 32-byte HMAC subkeys. The 32-byte video master key must never be used directly for AES or HMAC.

- **REQ-FMT-7：** AES/HMAC HKDF `info` 字节、HMAC domain、记录 counter 计算、溢出处理和认证字段必须逐字节定义于格式文档 V2；PHP 与 Worker 必须使用相同的固定互操作向量。
- **REQ-FMT-7:** The exact AES/HMAC HKDF `info` bytes, HMAC domain, record-counter calculation, overflow handling, and authenticated fields must be specified byte-for-byte in the V2 format document; PHP and the Worker must use the same fixed interoperability vectors.

- **REQ-FMT-8：** 对象的首条记录选择新的 16 字节 CSPRNG base counter 并将该记录实际初始 counter 写入 header；后续记录 counter 按 V2 规定的固定块间隔递增。必须检查每条记录的起始 counter 与最后实际使用的 counter block 均不发生 128 位溢出或回绕。
- **REQ-FMT-8:** The first record of an object chooses a new 16-byte CSPRNG base counter and writes that record's actual initial counter in its header; subsequent record counters advance by the fixed block interval defined by V2. Both each record's starting counter and its last counter block actually used must be checked for 128-bit overflow and wraparound.

- **REQ-FMT-9：** 不同 `contentId` 派生不同对象级 AES 子密钥，因此不同对象的数值 counter 可以重叠；同一派生 AES 子密钥下的 counter block 不得重复。
- **REQ-FMT-9:** Different `contentId` values derive different object-level AES subkeys, so numeric counters may overlap across different objects; counter blocks must never repeat under the same derived AES subkey.

- **REQ-FMT-10：** 每条记录的 HMAC 必须覆盖 V2 domain、完整 40 字节前导区、完整 header 和密文；Worker 必须在认证成功后才解密并释放对应明文。
- **REQ-FMT-10:** Each record's HMAC must cover the V2 domain, complete 40-byte preamble, complete header, and ciphertext; the Worker must authenticate successfully before decrypting and releasing the corresponding clear bytes.

- **REQ-FMT-12：** `FINAL` 位必须且只能出现在对象最后一条记录上；播放器只有在该记录完整且 HMAC 成功后才接受正常 EOF。EOF 前未见 `FINAL`、`FINAL` 后有任何字节或 HTTP 总长度不一致均失败关闭。
- **REQ-FMT-12:** The `FINAL` bit must appear on exactly the last record; the player accepts normal EOF only after that complete record passes HMAC. Reaching EOF without `FINAL`, receiving any bytes after `FINAL`, or a mismatch in total HTTP length must fail closed.

- **REQ-FMT-11：** V2 不需要 `clearSha256` sidecar 才能认证网络记录；播放器可计算明文 SHA-256 用于测试/诊断，但该诊断值不得替代逐条 HMAC。
- **REQ-FMT-11:** V2 does not require a `clearSha256` sidecar to authenticate network records; the player may calculate a cleartext SHA-256 for testing/diagnostics, but that diagnostic digest must not replace per-record HMAC authentication.

### 4.4 Range、流式解密与错误
### 4.4 Range, streaming decryption, and errors

- **REQ-RANGE-1：** 初始请求可以是完整 GET，必须从对象 byte offset 0 读取 40 字节前导区；前导区长度计入所有 HTTP Range offset 和 `Content-Range` 总长度。
- **REQ-RANGE-1:** The initial request may be a full GET and must read the 40-byte preamble from object byte offset 0; the preamble length is included in every HTTP Range offset and `Content-Range` total length.

- **REQ-RANGE-2：** 首次完整记录前发生中断时，从对象 byte offset 0 重新请求；认证至少一条记录后发生中断时，从最后一个完整认证记录的末尾续传。
- **REQ-RANGE-2:** If interrupted before the first complete record, request again from object byte offset 0; if interrupted after authenticating at least one record, resume from the end of the last complete authenticated record.

- **REQ-RANGE-3：** 每次续传必须发送 `Range: bytes={verifiedOffset}-` 与原强 ETag 的 `If-Range`；不得对记录中间的已下载密文字节做 offset。
- **REQ-RANGE-3:** Each resume must send `Range: bytes={verifiedOffset}-` and `If-Range` with the original strong ETag; downloaded ciphertext bytes from the middle of a record must not advance the verified offset.

- **REQ-RANGE-4：** 续传响应必须为 `206`；验证 `Content-Range` 起点、结束位置、对象总长度、响应字节数和原始强 ETag；任何不匹配都必须拒绝。
- **REQ-RANGE-4:** A resume response must be `206`; validate the `Content-Range` start, end, total object length, response byte count, and original strong ETag; reject any mismatch.

- **REQ-RANGE-5：** 若服务器因对象版本变化对 `If-Range` 返回 `200`，或返回新 ETag/错误 Content-Range，播放器必须丢弃响应并失败；不得把它追加到旧对象缓存。
- **REQ-RANGE-5:** If the server returns `200` to `If-Range` because the object version changed, or returns a new ETag/invalid Content-Range, the player must discard the response and fail; it must not append it to the old-object buffer.

- **REQ-RANGE-6：** loader 只能在完整记录通过 HMAC 后推进 `verifiedOffset`；未完整记录在重试前丢弃并从该记录的起点重新下载。
- **REQ-RANGE-6:** The loader may advance `verifiedOffset` only after a complete record passes HMAC; an incomplete record must be discarded before retry and downloaded again from that record's start.

- **REQ-RANGE-7：** 播放器必须从已验证记录明文中流式解析完整 MP4 `moof`/`mdat`，仅向 MSE 追加完整、已认证的媒体片段；认证失败的明文不得到达 MSE。
- **REQ-RANGE-7:** The player must stream-parse complete MP4 `moof`/`mdat` pairs from authenticated record plaintext and append only complete, authenticated media fragments to MSE; plaintext from a failed authentication must never reach MSE.

- **REQ-RANGE-8：** 无效前导区、未知 profile、非法记录长度、序号错乱、counter 不一致、HMAC 失败、截断对象或最终对象长度矛盾都必须 fail closed。
- **REQ-RANGE-8:** An invalid preamble, unknown profile, invalid record length, out-of-order sequence, inconsistent counter, failed HMAC, truncated object, or final object-length mismatch must fail closed.

- **REQ-RANGE-9：** 密文对象请求与响应必须使用 identity 表示；若响应含非 identity `Content-Encoding`，播放器必须拒绝，因为 HTTP Range byte offset、ETag 和 V2 记录 offset 必须针对同一组原始对象字节。
- **REQ-RANGE-9:** Ciphertext-object requests and responses must use the identity representation; the player must reject a response with non-identity `Content-Encoding` because HTTP Range offsets, ETags, and V2 record offsets must refer to the same original object bytes.

### 4.5 PHP 打包端与职责边界
### 4.5 PHP packager and responsibility boundary

- **REQ-PHP-1：** PHP 调用方为一次视频资产打包提供无符号 64 位 `assetId`、范围 `0–1023` 的数字 `keyId` 和与之对应的 32 字节主密钥；为覆盖完整 unsigned bigint 范围，PHP/JSON API 使用规范十进制字符串承载 `assetId`。打包器在处理该资产时只解析一次 KeyMaterial，所有 rendition/分片复用它。
- **REQ-PHP-1:** For one video-asset packaging job, the PHP caller provides an unsigned 64-bit `assetId`, numeric `keyId` in range `0–1023`, and its corresponding 32-byte master key; PHP/JSON APIs carry `assetId` as a canonical decimal string to cover the full unsigned-bigint range. The packager resolves KeyMaterial once for the asset and reuses it across all renditions and segments.

- **REQ-PHP-2：** PHP SDK 为每个新加密对象生成随机 `contentId` 并写入 V2 前导区；为正确设置 `FINAL`，加密器最多暂存一条待输出记录，只有输入 EOF 后才将最后一条记录标记为 `FINAL`；空媒体对象拒绝；重打包不得复用已生成对象的 `contentId`。
- **REQ-PHP-2:** The PHP SDK generates a random `contentId` for each newly encrypted object and writes it into the V2 preamble; to set `FINAL` correctly, the encryptor stages at most one pending record and marks the last record `FINAL` only after input EOF; empty media objects are rejected; repackaging must not reuse a previously generated object's `contentId`.

- **REQ-PHP-3：** PHP 输出的媒体 URI 使用约定路径和 `.m4s` 扩展名，不写逐片 JSON；动态签名 playlist 的组装及最终对象上传由调用方/部署层负责。
- **REQ-PHP-3:** PHP output media URIs use the agreed path and `.m4s` extension and do not write per-segment JSON; dynamic signed-playlist assembly and final object upload are owned by the caller/deployment layer.

- **REQ-PHP-4：** 本仓库可以提供 URI 构造/验证接口或示例，但不得加入生产 OSS/RustFS 客户端、上传凭据或 `zb_base` 集成。
- **REQ-PHP-4:** This repository may provide URI construction/validation interfaces or examples, but must not add production OSS/RustFS clients, upload credentials, or `zb_base` integration.

- **REQ-PHP-5：** 版本发布必须使用调用方传入的 `versionId` 构建不可变路径；相同版本路径已存在时必须拒绝覆盖或由调用方显式选择另一个版本。
- **REQ-PHP-5:** Version publication must build an immutable path using the caller-supplied `versionId`; if the same version path already exists, the packager must reject overwriting it or require the caller to choose another version explicitly.

- **REQ-PHP-6：** HLS `EXT-X-MAP` 引用的 fMP4 初始化段在本版本保持明文，不使用 CTR-HMAC V2；播放列表可按宿主授权策略为其 URI 签名。V2 加密仅覆盖媒体分片对象，播放器仍须在媒体分片前正确加载初始化段。
- **REQ-PHP-6:** The fMP4 initialization segment referenced by HLS `EXT-X-MAP` remains clear in this version and is not protected by CTR-HMAC V2; the playlist may sign its URI according to host authorization policy. V2 encryption covers media-segment objects only, and the player must still load the initialization segment before media segments.

## 5. API 与兼容性
## 5. API and compatibility

- 播放器 API 需接收结构化 PlaybackInfo，而不是从每个分片 sidecar 推断 Key URI 和 Key ID。
- The player API must accept structured PlaybackInfo rather than inferring Key URI and key ID from each segment sidecar.

- CTR-HLS 的公开 PHP/TypeScript API 必须导出 profile、输出格式与请求用途等常量或类型化值；调用方示例不得要求用户手写 profile/模式字符串。`PlaybackInfo.profile` 的线协议值固定为该导出常量对应的 V2 标识。
- Public PHP/TypeScript CTR-HLS APIs must export constants or typed values for profile, output format, and request purpose; caller examples must not require users to hand-write profile/mode strings. The `PlaybackInfo.profile` wire value is fixed to the V2 identifier represented by that exported constant.

- 推荐播放信息字段为 `assetId`、`keyId`、`keyUri`、`masterPlaylistUri`、`versionId` 和 `profile`；字段顺序不影响语义，未知 profile 必须拒绝。
- The recommended playback-information fields are `assetId`, `keyId`, `keyUri`, `masterPlaylistUri`, `versionId`, and `profile`; field order is irrelevant, and unknown profiles must be rejected.

- `PlaybackInfo.assetId` 是范围 `0–18446744073709551615` 的规范十进制字符串，不带正号或多余前导零（零本身除外）；JSON 不使用可能丢精度的 Number。播放器将该值精确转换成 8 字节大端前导字段。`PlaybackInfo.keyId` 是 `0–1023` 的整数。`versionId` 是非空字符串；`keyUri` 与 `masterPlaylistUri` 必须是绝对 `https:` URI，允许宿主通过本地开发配置显式放行 `http:`，不得从 URI 推导 Key 或资产标识。
- `PlaybackInfo.assetId` is a canonical decimal string in the range `0–18446744073709551615`, with no plus sign or unnecessary leading zeroes (except the value zero itself); JSON must not use a potentially precision-losing Number. The player converts it exactly to the 8-byte big-endian preamble field. `PlaybackInfo.keyId` is an integer in `0–1023`. `versionId` is a non-empty string; `keyUri` and `masterPlaylistUri` must be absolute `https:` URIs, with `http:` allowed only through an explicit host development setting, and the player must not infer a Key or asset identifier from a URI.

- `PlaybackInfo.profile` 必须等于 SDK 导出的 V2 profile 常量；播放信息不接受缺省 profile、别名、大小写变体或 V1 profile。
- `PlaybackInfo.profile` must equal the V2 profile constant exported by the SDK; playback information does not accept an omitted profile, alias, case variant, or V1 profile.

- Key 请求使用宿主注入的 `credentials`/headers 配置；该配置与 `PlaybackInfo` 分开传递，不得通过拼接 Key URI query 的方式传递 Key 或密钥标识。
- Key requests use host-injected `credentials`/header options; these options are supplied separately from `PlaybackInfo`, and the player must not pass keys or key identifiers by appending them to the Key URI query.

- 播放 Key URI 支持 `application/octet-stream` 原始 32 字节密钥，或 `application/json` 的 `{"key":"<64 lowercase hex>"}`；`keyId` 由 PlaybackInfo 提供，不要求响应回传 Key ID。
- The playback Key URI supports either a raw 32-byte key as `application/octet-stream` or `application/json` with `{"key":"<64 lowercase hex>"}`; PlaybackInfo supplies `keyId`, and the response need not echo the key ID.

- Key 请求采用一次播放会话一次；默认只保存在播放器实例内存中，播放器销毁或切换到不同资产时清除引用，不写入 localStorage、IndexedDB、URL 或日志。
- A key request occurs once per playback session; by default the key is held only in player-instance memory, references are cleared when the player is destroyed or switches to another asset, and the key is not written to localStorage, IndexedDB, URLs, or logs.

- V2 profile 名称、记录格式、前导区和 Key URI schema 均与 V1 不兼容；维护中的播放器只接受 V2，遇到 V1、缺失 profile 或未知 profile 必须 fail closed。
- The V2 profile name, record format, preamble, and Key URI schema are incompatible with V1; maintained players accept V2 only and must fail closed on V1, a missing profile, or an unknown profile.

- 公开错误使用导出的类型化错误码/常量区分 Key 获取/格式失败、playlist 请求失败、对象授权拒绝、对象版本或 Range 校验失败、记录认证失败、MP4 解析失败、MSE append 失败和主动取消；错误对象和日志不得包含 Key 字节或签名 query 值。
- Public errors use exported typed error codes/constants to distinguish Key fetch/format failure, playlist request failure, object authorization denial, object-version or Range validation failure, record-authentication failure, MP4 parse failure, MSE append failure, and explicit cancellation; error objects and logs must not contain Key bytes or signed query values.

### 5.1 API 生命周期
### 5.1 API lifecycle

PHP 打包 API 在处理单个资产前解析一次 `KeyMaterial`；该值由调用方提供，至少含稳定 `keyId` 与恰好 32 字节主密钥。Provider 对同一次资产打包不得逐 rendition 或逐分片重复调用。
The PHP packaging API resolves `KeyMaterial` once before processing one asset; the caller provides this value, which contains at least a stable `keyId` and an exactly 32-byte master key. The provider must not be called again per rendition or segment within the same asset job.

播放器创建时接收一份 `PlaybackInfo` 与一份可选请求配置；Key 获取成功后才加载 master playlist。播放器销毁、切换资产或播放失败清理时，必须清除可达的主密钥引用并终止仍在进行的 Key/媒体请求。
Player creation receives one `PlaybackInfo` and optional request configuration; it loads the master playlist only after Key retrieval succeeds. On player destruction, asset switching, or failed-playback cleanup, it must clear reachable master-key references and abort outstanding Key/media requests.

同一播放器实例切换 rendition、seek 或 ABR 档位不得重新取 Key；切换到不同 `assetId` 必须结束旧会话并为新会话重新调用新 `keyUri`，不得复用旧资产 Key。
Changing rendition, seeking, or switching ABR levels within one player instance must not fetch another Key; switching to a different `assetId` ends the old session and calls the new `keyUri`, and must not reuse the old asset's Key.

## 6. 设计方案
## 6. Design

### 6.1 播放握手
### 6.1 Playback handshake

应用在播放时把 PlaybackInfo 交给播放器；应用可从自己的播放接口取得该对象，但接口实现不属于本仓库。
The application supplies PlaybackInfo to the player at playback time; it may obtain this object from its own playback API, whose implementation is outside this repository.

播放器先验证 PlaybackInfo 的必需字段及 URI scheme，再调用 Key URI 一次取得原打包主密钥；取得并校验 32 字节 Key 后，才调用 hls.js 加载 master playlist。
The player first validates required PlaybackInfo fields and URI schemes, then calls the Key URI once to obtain the original packaging master key; only after validating the 32-byte key does it ask hls.js to load the master playlist.

Key URI 请求由播放器的请求选项钩子提供 cookie/header；响应内容作为内存中的 Uint8Array 传给 Worker，Worker 在导入密钥后立即清零其主密钥副本。
The player's request-options hook supplies cookies/headers for the Key URI request; the response is held as an in-memory Uint8Array and passed to the Worker, which zeroes its master-key copy immediately after importing the keys.

### 6.2 对象身份与密钥派生
### 6.2 Object identity and key derivation

SDK 每次加密尝试生成新的 16 字节 CSPRNG `contentId`；同一次加密产物的所有记录使用相同 `contentId`，不同对象不得有意复用。
The SDK generates a new 16-byte CSPRNG `contentId` for each encryption attempt; all records in that encrypted object use the same `contentId`, and distinct objects must never intentionally reuse it.

V2 前导区提供对象身份；签名 query 可以在重试时保持不变或刷新，但不得改变该对象的 `contentId`、Key 派生结果或记录内容。
The V2 preamble supplies object identity; a signature query may remain unchanged or be refreshed on retry, but it must not change the object's `contentId`, derived keys, or record bytes.

同一视频资产的所有 rendition/分片复用同一个 master key 与 `keyId`；每对象 HKDF 子密钥隔离 AES-CTR counter 空间，不需要全局 counter 分配服务。
All renditions and segments of one video asset reuse the same master key and `keyId`; per-object HKDF subkeys isolate AES-CTR counter spaces, so no global counter-allocation service is required.

### 6.3 Range 续传
### 6.3 Range resumption

初始响应固定对象 ETag 与总 byte length；loader 的对象 offset 从前导区首字节开始，只有 Worker 确认一条记录认证成功后才推进完整记录长度。
The initial response establishes the object's ETag and total byte length; the loader's object offset begins at the first preamble byte and advances by a complete record length only after the Worker confirms that record's authentication.

Range 请求必须包含原 URI 上的签名参数、`Range` 和 `If-Range`；跨源服务必须暴露 ETag、Content-Range 和 Content-Length，并允许播放器所需的 CORS header。
Range requests must include the signature parameters on the original URI, `Range`, and `If-Range`; cross-origin services must expose ETag, Content-Range, and Content-Length and allow the CORS headers required by the player.

对象响应不得经过 gzip、Brotli 或其他内容编码；浏览器请求可声明 `Accept-Encoding: identity`（若浏览器不允许脚本设置该 header，则部署端必须关闭该对象路径的内容编码）。
Object responses must not use gzip, Brotli, or another content encoding; browser requests may declare `Accept-Encoding: identity` (if the browser prevents scripts from setting that header, the deployment must disable content encoding for the object path).

不同 ETag、不同总长或无效范围响应都作为对象版本不一致失败处理；自动从零重取属于显式策略，不能在原缓存后追加替换响应。
A different ETag, different total length, or invalid range response is treated as an object-version mismatch; restarting from byte zero is an explicit policy and a replacement response must never be appended to the old buffer.

loader 每个对象最多进行 3 次 Range 续传；次数耗尽、用户取消、授权拒绝、ETag/范围校验失败均终止当前对象并报告可区分的错误，不得把失败响应计入已接收字节。
The loader performs at most 3 Range resumptions per object; exhausting the limit, user cancellation, authorization denial, or ETag/range validation failure terminates the object with a distinguishable error, and failed responses must not count toward received bytes.

收到初始 `200` 且缺少有效 `Content-Length` 时，可以从头流式播放，但中断后不得从非零 offset 续传；实现必须从 byte 0 重新请求，或明确失败。若初始请求意外收到 `206`，除非它是从 byte 0 开始且 `Content-Range`/总长完整有效，否则必须拒绝。
If the initial `200` lacks a valid `Content-Length`, playback may stream from the beginning, but after interruption it must not resume from a non-zero offset; the implementation must request again from byte 0 or fail explicitly. An unexpected initial `206` must be rejected unless it starts at byte 0 and has a fully valid `Content-Range` and total length.

### 6.4 动态 playlist 与签名
### 6.4 Dynamic playlists and signatures

应用或部署层可以动态生成 master/media playlist，并为每个对象 URI 签名；播放器不解析签名算法，只把完整 URI 交给 hls.js/custom loader。
The application or deployment layer may dynamically generate master/media playlists and sign each object URI; the player does not interpret the signing algorithm and passes each complete URI to hls.js/the custom loader.

自定义 loader 不得通过重建 URL、删除 query 或添加 `.json` 后缀改变对象 URI；记录诊断时应去除 query 中的授权值。
The custom loader must not alter an object URI by rebuilding its URL, deleting its query, or appending `.json`; diagnostics must redact authorization values from query strings.

签名由生成播放列表的应用/API 或其授权服务签发，并由 CDN/对象服务按部署配置验证；签发和验证策略共同决定有效期，SDK 不生成签名、不设定 TTL，也不要求一个固定的验收时长。
Signatures are issued by the application/API that generates the playlist or its authorization service and are validated by the CDN/object service according to deployment configuration; issuance and validation policy together determine validity, while the SDK neither creates signatures nor sets a TTL or requires a fixed acceptance duration.

应用/API 应按自己的播放与弱网续传策略选择有效期；签名过期时，播放器必须明确报告授权失败，不得篡改 URI、移除签名或把 token 当作 Key。是否重新请求播放信息并刷新 playlist/签名由宿主应用决定。
The application/API should choose validity according to its playback and poor-network resumption policy; when a signature expires, the player must report authorization failure clearly and must not alter the URI, remove the signature, or treat the token as a Key. The host application decides whether to request playback information again and refresh the playlist/signatures.

URI query 按不透明授权数据处理：播放器、hls.js 插件及 Range loader 不得排序、解码再编码、丢弃重复 query 参数或把相对分片 URI 错误地解析到不同 origin；每次重试必须使用同一解析后对象 URL，除非宿主明确提供同对象的新签名 URL。
URI queries are treated as opaque authorization data: the player, hls.js plugin, and Range loader must not reorder, decode/re-encode, or drop duplicate query parameters, or resolve a relative segment URI against the wrong origin; each retry uses the same resolved object URL unless the host explicitly supplies a newly signed URL for that same object.

playlist 由宿主应用/API 或部署层提供并动态签名；播放器只消费 `PlaybackInfo.masterPlaylistUri`，不负责生成 M3U8、不重写对象路径，也不要求 CDN 支持查询参数拼接规则以外的自定义签名算法。
The host application/API or deployment layer supplies and dynamically signs playlists; the player consumes only `PlaybackInfo.masterPlaylistUri`, does not generate M3U8 or rewrite object paths, and does not require the CDN to implement a custom signing algorithm beyond validating the supplied query authorization.

媒体 playlist 的 `EXT-X-MAP` 初始化段 URI 由 playlist 提供，保持明文且可单独签名；`EXTINF`、分片顺序和分片时长沿用源 playlist，不根据加密记录数量重新计算。
The media playlist supplies the `EXT-X-MAP` initialization-segment URI, which remains clear and may be signed separately; `EXTINF`, segment ordering, and segment durations are preserved from the source playlist and are not recalculated from the number of encryption records.

每个 V2 `.m4s` 对象对应源媒体 playlist 中一个完整 HLS 媒体分片；加密记录边界不要求与 MP4 box、`moof` 或 `mdat` 边界重合。Worker 认证并解密记录后，MP4 parser 跨记录累积数据，只在形成完整可追加的 `moof`/`mdat` 媒体单元后提交给播放器/MSE。
Each V2 `.m4s` object corresponds to one complete HLS media segment from the source media playlist; encryption-record boundaries need not align with MP4 box, `moof`, or `mdat` boundaries. After authenticating and decrypting records, the MP4 parser accumulates data across records and submits data to the player/MSE only when a complete appendable `moof`/`mdat` media unit has formed.

Worker 与主线程之间只传递必要的已认证明文块、对象 offset、ETag/总长和错误状态；未认证记录的任何明文都不得离开 Worker。Range 恢复保留已认证记录以及 MP4 parser 的未完成 box 状态，用户 seek、切换资产或销毁播放器则丢弃当前未完成对象状态。
The Worker and main thread exchange only the necessary authenticated plaintext chunks, object offsets, ETag/total length, and error state; no plaintext from an unauthenticated record may leave the Worker. Range resumption preserves authenticated records and incomplete MP4-parser box state, while user seeking, asset switching, or player destruction discards the current incomplete-object state.

## 7. 验收标准
## 7. Acceptance criteria

- [x] Docker Chromium 网络记录证明整个 H.264 播放过程没有任何 `{segmentUri}.json` 或逐片 metadata/sidecar 请求；报告：`experiments/hls-ctr-v2-acceptance/browser-acceptance-report.json`。
- [x] Docker Chromium network records prove that H.264 playback makes no `{segmentUri}.json` or per-segment metadata/sidecar request; report: `experiments/hls-ctr-v2-acceptance/browser-acceptance-report.json`.

- [x] Docker Chromium 网络记录证明一个视频会话在 master playlist 前请求一次 Key；播放期间完成三档 rendition、手动切档、seek 和多个分片，Key 请求数仍为一次。独立自动 ABR 会话也通过升档与降档检查。报告：`experiments/hls-ctr-v2-acceptance/browser-acceptance-report.json`。
- [x] Docker Chromium network records prove that one video session requests the Key once before the master playlist; playback completes across three renditions, manual switches, seeking, and multiple segments without another Key request. A separate automatic-ABR session also passes upswitch and downswitch checks. Report: `experiments/hls-ctr-v2-acceptance/browser-acceptance-report.json`.

- [ ] 切换到不同 `assetId` 会先销毁旧会话并仅为新会话请求一次 Key；销毁播放器或取消播放会 abort 尚未结束的请求，且错误和日志不包含 Key 或签名值。
- [ ] Switching to a different `assetId` first destroys the old session and requests one Key only for the new session; destroying the player or cancelling playback aborts outstanding requests, and errors/logs contain no Key or signature values.

- [ ] Key URI 的原始 32 字节响应与 `{"key":"<64 lowercase hex>"}` JSON 响应都能解密 PHP 加密产物；错误 Content-Type、非法 JSON/Hex、错误长度、错误 Key、拒绝、超时和取消均在 master playlist 前失败。
- [ ] Both the raw 32-byte Key URI response and the `{"key":"<64 lowercase hex>"}` JSON response decrypt PHP-encrypted output; wrong Content-Type, invalid JSON/hex, wrong length, wrong key, denial, timeout, and cancellation all fail before the master playlist is loaded.

- [ ] PHP 与 TypeScript/Worker 的公开调用样例只用导出的常量或类型化值选择 V2；初始化段保持明文并通过 `EXT-X-MAP` 正确加载，媒体 playlist 的 `EXTINF` 和顺序与输入一致。
- [ ] Public PHP and TypeScript/Worker examples select V2 only through exported constants or typed values; the clear initialization segment loads correctly through `EXT-X-MAP`, and media-playlist `EXTINF` values and ordering match the input.

- [ ] 输出为有限 VOD playlist 且保留 `EXT-X-ENDLIST`；V2 playlist 不包含 `EXT-X-KEY`，不误报标准 `AES-128` 或 `SAMPLE-AES` 加密。
- [ ] Output is a finite VOD playlist retaining `EXT-X-ENDLIST`; the V2 playlist contains no `EXT-X-KEY` and does not misdeclare standard `AES-128` or `SAMPLE-AES` encryption.

- [x] 固定向量 `doc/vectors/CTR-HMAC-V2-001.json` 覆盖前导区、资产/Key/清晰度/分片上下文、HKDF 子密钥、两条记录、counter、`FINAL`、tag、明文和完整对象；PHP 8.5 与 Node.js 24 独立生成结果逐字节一致。
- [x] The fixed vector `doc/vectors/CTR-HMAC-V2-001.json` covers the preamble, asset/key/rendition/segment context, HKDF subkeys, two records, counters, `FINAL`, tags, cleartext, and complete object; independent PHP 8.5 and Node.js 24 generation matches byte for byte.

- [x] PHP `Encryptor` PHPUnit 与 Node Dedicated Worker 测试分别读取同一固定向量；PHP 输出对象 Hex/SHA-256 与向量逐字节/逐哈希一致，Worker 逐记录解密后与向量明文一致。
- [x] PHP `Encryptor` PHPUnit and Node Dedicated Worker tests independently consume the same fixed vector; the PHP output object Hex/SHA-256 matches the vector byte for byte and hash for hash, and the Worker decrypts each record to the vector cleartext.

- [x] Worker 固定向量与负向测试覆盖前导、header/counter、长度、`FINAL`、密文/tag、序号与截断；loader 篡改记录测试证明认证失败时没有任何媒体单元回调（因此没有明文进入 MSE）。
- [x] Worker fixed-vector and negative tests cover preamble, header/counter, length, `FINAL`, ciphertext/tag, sequence, and truncation; the loader tampering test proves that no media-unit callback occurs on authentication failure, so no cleartext reaches MSE.

- [x] PHP 与 Node Worker 固定向量验证带认证 `FINAL` 的完整对象；Node Worker 测试验证缺少 `FINAL`、截断和 `FINAL` 后追加记录均失败。loader Range 测试覆盖未完成响应重试与重试耗尽失败关闭。
- [x] PHP and Node Worker fixed-vector tests verify a complete object with authenticated `FINAL`; Node Worker tests verify that missing `FINAL`, truncation, and records appended after `FINAL` fail. Loader Range tests cover retrying incomplete responses and failing closed after retries are exhausted.

- [ ] 播放签名 URI 时所有分片 GET 与 Range 请求保留正确签名 query；测试覆盖有效签名、过期签名和跨对象签名拒绝。
- [ ] When playing signed URIs, all segment GET and Range requests preserve the correct signature query; tests cover valid signatures, expired signatures, and signatures rejected for another object.

- [x] Docker Chromium 注入首条完整认证记录后 13 字节处短读；播放器丢弃未完成记录，并从 `40 + header + ciphertext + tag = 65632` 字节边界发送 `Range`，同一签名 URI 携带 `If-Range` 恢复。报告：`experiments/hls-ctr-v2-acceptance/browser-acceptance-report.json`。
- [x] Docker Chromium injects a short read 13 bytes after the first complete authenticated record; the player discards the incomplete record and resumes from the `40 + header + ciphertext + tag = 65632` byte boundary, retaining the same signed URI and sending `If-Range`. Report: `experiments/hls-ctr-v2-acceptance/browser-acceptance-report.json`.

- [x] Node 24 loader 测试使用大于一条 64 KiB 记录的对象，并断言首个完整认证 `moof`/`mdat` 单元在流读取完毕前回调；Docker Chromium 随后通过 V2 H.264 对象完成 MSE 播放。
- [x] The Node 24 loader test uses an object larger than one 64 KiB record and asserts that its first complete authenticated `moof`/`mdat` unit is emitted before stream completion; Docker Chromium then completes MSE playback using V2 H.264 objects.

- [x] Node 24 loader 互操作测试拒绝错误 ETag、错误 `Content-Range` 起点/总长、非 identity `Content-Encoding`、忽略 Range 的 HTTP 200、416 和授权拒绝；拒绝响应不会推进已验证 offset。
- [x] Node 24 loader interoperability tests reject a wrong ETag, wrong `Content-Range` start/total, non-identity `Content-Encoding`, HTTP 200 that ignores Range, 416, and authorization denial; rejected responses do not advance the verified offset.

- [ ] V2 RustFS 对象替换故障注入尚未执行；历史 V1 RustFS 报告不能替代 V2 验收。
- [ ] V2 RustFS object-replacement fault injection has not been run; historical V1 RustFS reports do not replace V2 acceptance.

- [x] Node 24 测试覆盖无强 ETag 时拒绝续传和最多三次续传后明确失败；错误 Range 响应不推进 verified offset。
- [x] Node 24 tests cover refusing resumption without a strong ETag and an explicit failure after at most three resume attempts; invalid Range responses do not advance the verified offset.

- [ ] 实际对象路径中的 assetId 是 16 字符小写 hex，keyId 与短边像素使用规范十进制；分片序号固定为五位补零且拒绝超过 `65535`；MD5 前缀使用小写 hex 三字符；路径/扩展名不暴露算法；Key 原始/Hex/Base64 形式不出现在产物、URL 或日志。
- [ ] Actual object paths use a 16-character lowercase-hex assetId and canonical-decimal keyId and short-edge pixel value; segment sequence is five-digit zero-padded and values above `65535` are rejected; the MD5 prefix uses three lowercase hexadecimal characters; paths/extensions do not expose the algorithm; raw/hex/base64 Key forms do not appear in artifacts, URLs, or logs.

- [ ] 文件名边界用例至少覆盖序号 `0` → `00000`、`17` → `00017`、`65535` → `65535` 和 `65536` 明确拒绝；MD5 前缀使用原始未补零序号计算。
- [ ] Filename boundary cases cover at least sequence `0` → `00000`, `17` → `00017`, `65535` → `65535`, and explicit rejection of `65536`; the MD5 prefix is calculated using the original unpadded sequence.

- [x] Node 24 渐进测试证明整条记录通过认证且组成完整 `moof`/`mdat` 后才回调；Docker Chromium H.264 VOD 约 8.07 秒播放至 ended，覆盖 seek、三档手动切换、独立会话自动 ABR 升降档及 Range 恢复。Linux Chromium 对 HEVC 能力探测为不支持，播放器在 MSE append 前明确报 `PLAYER_CODEC_UNSUPPORTED`；本结果不代表 HEVC 能播放。报告：`experiments/hls-ctr-v2-acceptance/browser-acceptance-report.json`。
- [x] Node 24 progressive tests prove callbacks occur only after a complete record authenticates and forms a full `moof`/`mdat`; Docker Chromium plays the approximately 8.07-second H.264 VOD to ended and covers seeking, three manual renditions, automatic ABR up/down in a separate session, and Range resumption. Linux Chromium reports HEVC unsupported, and the player raises `PLAYER_CODEC_UNSUPPORTED` before MSE append; this does not prove HEVC playback. Report: `experiments/hls-ctr-v2-acceptance/browser-acceptance-report.json`.

- [x] `PlayerErrorCode` 导出 Key、播放取消、playlist、MSE append、对象授权、Range/版本、网络、记录认证和 MP4 分类；HLS 网络错误文本会遮蔽 query 参数值。Node 24 分类测试覆盖 playlist、append、取消状态、对象版本错误与签名脱敏；浏览器报告只保留签名 query 参数名。
- [x] Exported `PlayerErrorCode` distinguishes Key, playback cancellation, playlist, MSE append, object authorization, Range/version, network, record authentication, and MP4 categories; HLS network diagnostics redact query parameter values. Node 24 classification tests cover playlist, append, cancellation state, object-version errors, and signature redaction; browser reports retain only signed-query parameter names.

- [x] PHP Docker 全量 PHPUnit 回归通过：PHP 8.5.11，591 tests、1,435 assertions、9 skipped；V2 运行时只接受 V2 profile，普通 PHP-FFMpeg 回归包含在该全量套件内。
- [x] The full PHP Docker PHPUnit regression passed on PHP 8.5.11: 591 tests, 1,435 assertions, and 9 skipped; the V2 runtime accepts only the V2 profile, and ordinary PHP-FFMpeg regressions are included in the full suite.

- [x] Node 24 检查、播放器构建、V2 单测、PHPUnit 与 Chromium 浏览器验收均在 Docker 中运行；报告明确标注 Docker Chromium 的本地 HTTP fixture，未宣称 RustFS/CDN 已验收。
- [x] Node 24 checks, player build, V2 tests, PHPUnit, and Chromium browser acceptance all ran in Docker; the report identifies the local Docker Chromium HTTP fixture and does not claim RustFS/CDN acceptance.

- [ ] V2 RustFS 与生产 CDN 路径仍待单独验收；必须分别报告对象存储和真实 CDN 证据。
- [ ] V2 RustFS and production-CDN paths still require separate acceptance; object-store and actual CDN evidence must be reported separately.

## 8. 验证计划
## 8. Verification plan

### 8.1 施工顺序与任务出口
### 8.1 Implementation order and task exits

- [x] **T0 协议向量冻结：** 已生成并评审 `doc/vectors/CTR-HMAC-V2-001.json`，其中含两条记录、完整 40 字节前导、派生上下文、主密钥、contentId、base counter、header/counter/tag（含末记录 `FINAL`）、明文、完整对象和 SHA-256。PHP 8.5 与 Node.js 24 独立生成结果逐字段一致；T1/T3 实现必须继续以此为互操作基准。
- [x] **T0 Protocol-vector freeze:** `doc/vectors/CTR-HMAC-V2-001.json` has been generated and reviewed; it contains two records, the complete 40-byte preamble, derivation context, master key, contentId, base counter, headers/counters/tags (including the final record's `FINAL`), plaintext, complete object, and SHA-256. Independent PHP 8.5 and Node.js 24 generation matches field for field; T1/T3 implementations must continue to use it as their interoperability baseline.

- [x] **T1 PHP 格式原语：** 已实现 HKDF、CTR、HMAC、记录编码/解析、CSPRNG 与长度/溢出校验；PHP 固定向量逐字节匹配 T0，前导、字段、记录、FINAL、tag、截断和 counter 溢出负向用例失败关闭。
- [x] **T1 PHP format primitives:** HKDF, CTR, HMAC, record encoding/parsing, CSPRNG, and length/overflow validation are implemented; the PHP fixed vector matches T0 byte for byte, and negative cases for preamble, fields, records, FINAL, tag, truncation, and counter overflow fail closed.

- [x] **T2 PHP HLS 打包器：** 已实现单 rendition 与多 rendition media-playlist 打包入口；一次传入资产 KeyMaterial，媒体对象按 64 KiB 记录流式封装，按本 SDD 构造五位补零文件名；保留明文 `EXT-X-MAP`、重写分片 URI、不生成 sidecar，并通过 staging 与独占创建拒绝覆盖已发布路径。
- [x] **T2 PHP HLS packager:** Single- and multi-rendition media-playlist packaging entry points are implemented; one asset KeyMaterial is supplied for the packaging call, media objects are streamed in 64 KiB records, and filenames follow the five-digit rule. The packager preserves clear `EXT-X-MAP`, rewrites segment URIs, emits no sidecars, and rejects overwriting published paths through staging and exclusive creation.

- [x] **T3 Worker 解密器：** 已独立实现 V2 前导区与记录解析、HKDF/HMAC 校验、认证后 CTR 解密、`FINAL`/counter/顺序检查及错误清理；Node 24 Worker 测试通过 T0 向量与前导、长度、counter、序号、tag、FINAL、截断及不完整对象负向用例。认证失败时只返回错误，不传出明文。
- [x] **T3 Worker decryptor:** Independent V2 preamble and record parsing, HKDF/HMAC verification, post-authentication CTR decryption, `FINAL`/counter/sequence checks, and error cleanup are implemented. Node 24 Worker tests pass the T0 vector and negative cases for preamble, length, counter, sequence, tag, FINAL, truncation, and incomplete objects. Authentication failures return only an error and transfer no plaintext.

- [x] **T4 播放会话 API：** 已实现并导出 typed `PlaybackInfo`、V2 profile/请求用途/错误常量、Key URI 的 octet-stream 与 JSON Hex 两种解析、单次取 Key、请求凭据注入及销毁/切换时 Key 清理；Key 响应仅接受 HTTP 200，Key 成功前不发起 master-playlist 请求。Node 24 会话测试覆盖凭据、顺序、失败状态与超时。
- [x] **T4 Playback-session API:** Typed `PlaybackInfo`, V2 profile/request-purpose/error constants, octet-stream and JSON Hex Key-URI parsers, one-time Key retrieval, request-credential injection, and Key cleanup on destruction/asset switch are implemented and exported. Only HTTP 200 is accepted for the Key response, and the master playlist is not requested before Key retrieval succeeds. Node 24 session tests cover credentials, ordering, failure statuses, and timeout.

- [x] **T5 渐进解密与 MSE：** hls.js fragment loader 已连接 V2 Worker；仅在整条记录认证后释放明文，并跨记录缓冲、解析完整 `moof`/`mdat` 媒体单元，再通过 hls.js progressive `onProgress` 回调送入 append 流程。Node 24 流式测试证明首个完整媒体单元在读取最终记录前送出、签名 query 保留、无逐片 sidecar 请求，篡改记录不会送出明文。真实浏览器/MSE 播放验收仍归 T7。
- [x] **T5 Progressive decryption and MSE:** The hls.js fragment loader is connected to the V2 Worker; clear bytes are released only after whole-record authentication, then buffered across records and parsed into complete `moof`/`mdat` media units before entering the append path through hls.js progressive `onProgress`. Node 24 streaming tests prove the first complete media unit is emitted before the final record is read, signed queries are preserved, no per-segment sidecar request occurs, and a tampered record emits no clear bytes. Real-browser/MSE playback acceptance remains in T7.

- [x] **T6 Range 与授权：** 已实现强 ETag、Content-Range、总长、响应字节数与 identity 编码校验，以及最多三次记录边界续传；复用原始完整签名 URL 和 If-Range；单测覆盖无 ETag、坏 ETag/范围、Range 被忽略、416、403 和重试耗尽。V2 RustFS/对象替换验收仍属于 T7。
- [x] **T6 Range and authorization:** Strong ETag, Content-Range, total-length, response-byte-count, and identity-encoding validation are implemented, along with up to three record-boundary resumptions; the original full signed URL is reused with If-Range. Unit tests cover missing ETag, bad ETag/ranges, ignored Range, 416, 403, and exhausted retries. V2 RustFS/object-replacement acceptance remains in T7.

- [ ] **T7 浏览器与弱网验收（部分完成）：** Docker Chromium 已通过多 rendition H.264 MSE 播放、Key 单次获取、手动切档、seek、渐进认证追加、短读后签名 Range 恢复和自动 ABR 升降档；HEVC 样本在 Linux Chromium 被能力检测明确拒绝。Docker HTTP fixture 不代表 RustFS/CDN；V2 RustFS 对象替换与 iOS/Android 真机尚未验收。
- [ ] **T7 Browser and poor-network acceptance (partially complete):** Docker Chromium passed multi-rendition H.264 MSE playback, one-time Key retrieval, manual switching, seeking, progressive authenticated append, signed Range resumption after a short read, and automatic ABR up/down switching; capability detection explicitly rejects HEVC in Linux Chromium. The Docker HTTP fixture does not represent RustFS/CDN; V2 RustFS object replacement and physical iOS/Android devices remain untested.

- [ ] **T8 上游回归与发布文档（验证通过，文档核销中）：** Docker 中 Node 24 检查、V2 测试、播放器构建、Chromium 验收和 PHP 8.5.11 全量 PHPUnit 均通过；当前仍需复核剩余格式/错误/发布验收项，并记录 V2 RustFS/CDN 的待验边界。
- [ ] **T8 Upstream regression and release documentation (verification passed, documentation closure in progress):** Docker Node 24 checks, V2 tests, player build, Chromium acceptance, and the full PHP 8.5.11 PHPUnit suite all passed; remaining format/error/release criteria still need review, and the pending V2 RustFS/CDN acceptance boundary must be recorded.

- PHP PHPUnit 覆盖 V2 记录格式、路径构造、contentId 唯一性、失败清理、单次资产 KeyProvider 调用，并验证 V1 输入被拒绝且不触发 sidecar 请求。
- PHP PHPUnit covers the V2 record format, path construction, contentId uniqueness, failure cleanup, and one KeyProvider call per asset; it also verifies that V1 input is rejected without a sidecar request.

- Node 24 Docker Worker 测试使用与 PHP 相同的固定向量，覆盖成功、篡改、counter overflow、越界长度、错误序号和截断前导区/记录。
- Node 24 Docker Worker tests use the same fixed vectors as PHP and cover success, tampering, counter overflow, out-of-range lengths, wrong sequence, and truncated preambles/records.

- 浏览器自动化记录请求 URL、请求次数、Range/If-Range、ETag、Content-Range、Worker 认证事件、MSE append 事件、ABR/seek 和播放结束状态；所有报告剥离签名值和 Key。
- Browser automation records request URLs/counts, Range/If-Range, ETag, Content-Range, Worker authentication events, MSE append events, ABR/seeking, and playback completion; all reports redact signature values and Keys.

- 本地 Docker Nginx 与 RustFS 测试分别注入限速、短读、超时、错误范围、ETag 变化、签名过期和对象替换；验证相同对象 URI 在 Range 续传中的签名传递。
- Local Docker Nginx and RustFS tests separately inject throttling, short reads, timeouts, invalid ranges, ETag changes, signature expiry, and object replacement; verify signature propagation on Range resumption to the same object URI.

- 完整 Docker PHPUnit 回归覆盖上游普通媒体行为；不以单独 CTR/HLS 测试代替上游回归。
- Full Docker PHPUnit regression covers upstream ordinary-media behavior; CTR/HLS-only tests do not replace upstream regression.

## 9. 风险与回滚
## 9. Risks and rollback

- V2 是与 V1 不兼容的新 profile；错误的 profile 路由可能导致解析失败或安全降级，因此未知/缺失 profile 必须 fail closed。
- V2 is a new profile incompatible with V1; incorrect profile routing may cause parse failures or security downgrade, so missing or unknown profiles must fail closed.

- Key URI 会向浏览器提供可解密视频的主密钥；该自定义格式不是 DRM，浏览器用户可检查运行时明文/密钥，因此不得对外宣称 DRM 级保护。
- The Key URI provides the browser with the master key needed to decrypt video; this custom format is not DRM, and browser users can inspect runtime plaintext/key material, so it must not be marketed as DRM-grade protection.

- 三字符 MD5 前缀仅有 12 bit，不能用于安全判断；当前路径目录和 sequence 共同区分对象，写入层仍必须检测同路径覆盖。
- A three-character MD5 prefix has only 12 bits and cannot be used for security decisions; the path directories and sequence jointly distinguish objects, and the write layer must still detect same-path overwrites.

- 签名有效期由应用/API 的签发策略和 CDN/对象服务的验证配置共同决定；本 SDK 不设定固定时长。过期时播放器应明确失败，播放信息刷新由宿主应用决定。
- Signature validity is determined jointly by the application/API issuance policy and CDN/object-service validation configuration; this SDK sets no fixed duration. The player should fail clearly on expiry, while playback-information refresh is controlled by the host application.

- V1 是带有逐片 JSON sidecar 重大缺陷的历史版本；V2 不读取、不生成、不自动迁移 V1。保留 V1 文档仅用于解释历史格式，不构成运行时兼容承诺。
- V1 is a historical version with the major defect of per-segment JSON sidecars; V2 does not read, emit, or automatically migrate V1. V1 documentation is retained only to explain the historical format and does not promise runtime compatibility.

- 如需回退，回退到不包含 CTR-HLS 的应用版本；不得恢复 V1 播放兼容，也不得把已发布 V2 对象改写成 V1 或覆盖不可变版本路径。
- If rollback is required, revert to an application version without CTR-HLS; do not restore V1 playback compatibility or rewrite published V2 objects as V1 or overwrite immutable version paths.

## 10. 待决问题
## 10. Open questions

目前没有待维护者确认的产品或接口决策；后续评审发现的新歧义应先补充到本节。
There are currently no product or interface decisions awaiting maintainer confirmation; ambiguities found in later review should first be recorded in this section.

## 11. 实施记录
## 11. Implementation notes

CTR-HMAC V2 字节格式已于 2026-10-20 评审并冻结。T0–T6 已实现并通过相应固定向量、负向、互操作、播放会话、渐进处理和 Range 单测。T7 在 Docker Chromium 中通过正式 V2 PHP 产物的 H.264 播放、手动三档切换、seek、弱网短读 Range 恢复和自动 ABR 升降档；Linux Chromium 不支持该 HEVC 样本并在 MSE 前拒绝。T8 的 Node 24 检查、播放器构建、V2 与错误分类测试及 PHP 8.5.11 全量 PHPUnit（591 tests / 1,435 assertions / 9 skipped）已通过。测试报告位于 `experiments/hls-ctr-v2-acceptance/browser-acceptance-report.json`。V2 RustFS/CDN、对象替换故障注入、Safari/iOS 与 Android 真机仍未验收；其余尚未逐项验证的 SDD 标准维持未勾选，不能据此将整份 SDD 标为 Complete。
The CTR-HMAC V2 byte format was reviewed and frozen on 2026-10-20. T0–T6 are implemented and pass their fixed-vector, negative, interoperability, playback-session, progressive-processing, and Range unit tests. T7 passed H.264 playback of official PHP V2 artifacts in Docker Chromium, three manual renditions, seeking, weak-network short-read Range resumption, and automatic ABR up/down switching; Linux Chromium does not support the HEVC sample and rejects it before MSE. T8 Node 24 checks, player build, V2 and error-classification tests, and the full PHP 8.5.11 PHPUnit suite (591 tests / 1,435 assertions / 9 skipped) passed. The browser report is at `experiments/hls-ctr-v2-acceptance/browser-acceptance-report.json`. V2 RustFS/CDN, object-replacement fault injection, Safari/iOS, and physical Android acceptance remain incomplete; all other acceptance criteria not yet individually verified remain unchecked, so this SDD must not be marked Complete.
