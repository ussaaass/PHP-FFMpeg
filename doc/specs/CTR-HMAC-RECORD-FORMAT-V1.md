# CTR/HMAC 媒体记录格式 V1
# CTR/HMAC Media Record Format V1

> 状态：V1 已冻结；不兼容更改必须使用新的 profile 版本。
> Status: V1 frozen; incompatible changes must use a new profile version.
> 关联设计：[加密编排与播放器 SDD](SDD-20261006-hls-ctr-encryption-and-player.md)
> Related design: [Encryption pipeline and player SDD](SDD-20261006-hls-ctr-encryption-and-player.md)

## 1. 适用范围
## 1. Scope

本格式定义 fMP4 HLS 媒体分片的项目自定义记录式 AES-CTR 加密和 HMAC-SHA-256 认证；它不是 HLS 标准 `AES-128` 或 `SAMPLE-AES` 加密格式。
This format defines project-specific record-based AES-CTR encryption and HMAC-SHA-256 authentication for fMP4 HLS media segments; it is not the HLS-standard `AES-128` or `SAMPLE-AES` encryption format.

明文初始化段不由本格式加密；首期配置只覆盖视频媒体分片，独立音频/字幕轨不得被误报为已加密。
Clear initialization segments are not encrypted by this format; the first-release configuration covers video media segments only and must not report separate audio/subtitle tracks as encrypted.

受保护文件仅能由遵循本格式的自定义播放器播放；不支持自定义解密器的 HLS 客户端必须被视为不兼容。
Protected files can be played only by a custom player that implements this format; an HLS client without the custom decryptor must be treated as incompatible.

## 2. 密钥和派生
## 2. Keys and derivation

调用方的密钥 provider 按视频资产返回一个不公开的 32 字节随机主密钥及非秘密 `keyId`；该视频资产的全部 rendition 和媒体分片必须保持相同密钥与 `keyId`，不同视频资产应使用不同密钥；各分片仍须使用不同的 `contentId`。
The caller's key provider returns a secret random 32-byte master key and a non-secret `keyId` per video asset; all renditions and media segments for that asset must keep the same key and `keyId`, while different video assets should use different keys; each segment still requires a distinct `contentId`.

`contentId` 使用小写规范 UUID 文本，并作为 HKDF salt 的 UTF-8 字节；该值是分片唯一标识，不是授权凭据。
`contentId` is a lowercase canonical UUID string and its UTF-8 bytes are the HKDF salt; it uniquely identifies a segment and is not an authorization credential.

使用 HKDF-SHA-256 分别派生 16 字节 AES 密钥和 32 字节 HMAC 密钥；PRK 按 RFC 5869 从 32 字节主密钥和 `contentId` salt 提取。
Use HKDF-SHA-256 to derive a 16-byte AES key and a 32-byte HMAC key independently; extract the PRK according to RFC 5869 from the 32-byte master key and the `contentId` salt.

AES 派生 `info` 的确切字节是 UTF-8 `phpffmpeg-ctr-hmac-v1\0aes-128-ctr`，HMAC 派生 `info` 的确切字节是 UTF-8 `phpffmpeg-ctr-hmac-v1\0hmac-sha256`。
The exact UTF-8 bytes for AES derivation `info` are `phpffmpeg-ctr-hmac-v1\0aes-128-ctr`; the exact UTF-8 bytes for HMAC derivation `info` are `phpffmpeg-ctr-hmac-v1\0hmac-sha256`.

每个派生密钥通过 HKDF-Expand 使用对应 `info` 独立派生；实现不得把 master key 直接用于 AES 或 HMAC。
Derive each subkey independently with HKDF-Expand using its corresponding `info`; implementations must not use the master key directly for AES or HMAC.

AES 模式为 AES-128-CTR，HMAC 为 HMAC-SHA-256，记录认证采用 Encrypt-then-MAC；浏览器 Worker 必须完成常量时间/`SubtleCrypto.verify` 认证后才解密并释放对应记录明文。
Use AES-128-CTR for encryption and HMAC-SHA-256 for authentication with an Encrypt-then-MAC construction; the browser Worker must authenticate using constant-time comparison/`SubtleCrypto.verify` before decrypting and releasing a record's clear bytes.

每次加密分片生成新的 16 字节 CSPRNG `baseCounter`；provider 不得复用 `contentId`，且同一 profile 内不得重置或复用同一分片记录的 counter。
Generate a new 16-byte CSPRNG `baseCounter` for each encrypted segment; providers must not reuse `contentId`, and a segment's counters must never be reset or reused within this profile.

## 3. 二进制记录布局
## 3. Binary record layout

一个媒体对象由一条或多条记录直接串接构成，不加入额外 padding；对象长度必须等于 sidecar 中所有记录长度之和。
One media object is the direct concatenation of one or more records without extra padding; its byte length must equal the sum of record lengths in the sidecar.

每条记录为 `header || ciphertext || tag`；header 固定 24 字节，tag 固定 32 字节。
Each record is `header || ciphertext || tag`; the header is exactly 24 bytes and the tag is exactly 32 bytes.

header 字节 `0–3` 是从零开始的无符号 32 位 big-endian 记录序号。
Header bytes `0–3` contain the zero-based unsigned 32-bit big-endian record sequence number.

header 字节 `4–19` 是该记录 AES-CTR 的 16 字节初始 counter，按网络字节序存放。
Header bytes `4–19` contain the 16-byte initial AES-CTR counter for the record, stored in network byte order.

header 字节 `20–23` 是密文字节长度，即明文字节长度，使用无符号 32 位 big-endian 编码；单条记录长度不得超过 65,536 字节。
Header bytes `20–23` contain the ciphertext byte length, which equals the cleartext byte length, as an unsigned 32-bit big-endian integer; a record must not exceed 65,536 bytes.

每条记录的 counter 为 128 位 big-endian 整数 `baseCounter + sequence × 4096`；溢出必须报错，禁止回绕到零。
Each record counter is the 128-bit big-endian integer `baseCounter + sequence × 4096`; overflow must fail and must never wrap to zero.

每条记录使用独立 AES-CTR 操作；counter 的 4096 个 AES block 空间足以容纳单条 65,536 字节最大记录，最后未满 16 字节的 block 按 AES-CTR 标准处理。
Each record is processed as an independent AES-CTR operation; the 4096 AES-block counter space accommodates one maximum 65,536-byte record, and a final partial 16-byte block follows standard AES-CTR processing.

`tag = HMAC-SHA-256(macKey, domain || contentIdUtf8 || 0x00 || header || ciphertext)`，tag 为全部 32 字节，不截断。
`tag = HMAC-SHA-256(macKey, domain || contentIdUtf8 || 0x00 || header || ciphertext)`; the tag is all 32 bytes and is not truncated.

domain 的确切字节为 UTF-8 `phpffmpeg-ctr-hmac-v1\n`，末尾包含一个 LF 字节 `0x0a`。
The exact domain bytes are UTF-8 `phpffmpeg-ctr-hmac-v1\n`, including one trailing LF byte `0x0a`.

认证内容包含完整 header 和密文；sidecar 中重复的 counter/长度信息只用于早期一致性检查，不能替代 HMAC 验证。
Authentication covers the complete header and ciphertext; the counter/length fields duplicated in the sidecar support early consistency checks but do not replace HMAC verification.

## 4. Sidecar 元数据契约
## 4. Sidecar metadata contract

每个密文媒体分片对应一个 JSON sidecar；sidecar schema 使用整数 `version: 1` 和字符串 `profile: "phpffmpeg-ctr-hmac-v1"`。
Each encrypted media segment has one JSON sidecar; the sidecar schema uses integer `version: 1` and string `profile: "phpffmpeg-ctr-hmac-v1"`.

必需顶层字段为 `segmentUri`、`contentId`、`keyId`、`keyUri`、`baseCounter`、`clearBytes`、`cipherBytes`、`clearSha256`、`records`。
Required top-level fields are `segmentUri`, `contentId`, `keyId`, `keyUri`, `baseCounter`, `clearBytes`, `cipherBytes`, `clearSha256`, and `records`.

`baseCounter` 和每条记录的 `counter` 使用 RFC 4648 标准 Base64 编码，解码后必须分别为 16 字节。
`baseCounter` and each record's `counter` use standard RFC 4648 Base64 encoding and must decode to exactly 16 bytes.

`clearSha256` 为解密后整个原始媒体分片的 64 字符小写十六进制 SHA-256；该值是产物完整性验证信息，不是每个网络记录的认证替代品。
`clearSha256` is the lowercase 64-character hexadecimal SHA-256 of the entire clear media segment after decryption; it is an artifact-integrity check and not a replacement for per-network-record authentication.

`records` 按序列递增排列，每项包含 `sequence`、`counter`、`ciphertextLength` 和 `tagLength: 32`；不允许未知记录跳过或乱序恢复。
`records` are ordered by increasing sequence, and each item contains `sequence`, `counter`, `ciphertextLength`, and `tagLength: 32`; unknown records must not be skipped or resumed out of order.

`keyUri` 是外部 provider 可选使用的客户端取钥地址；其内容、认证方式和响应 schema 由播放器宿主应用定义，绝不在 sidecar 中包含密钥或访问 token。
`keyUri` is the client key-retrieval address that an external provider may use; its contents, authentication method, and response schema are defined by the player host application, and the sidecar never contains keys or access tokens.

`cipherBytes` 必须等于下载对象长度；对非空明文，记录数为 `ceil(clearBytes / 65536)`，每条长度等于其对应明文切片长度，所有 tag 长度均为 32。
`cipherBytes` must equal the downloaded object length; for non-empty clear media, record count is `ceil(clearBytes / 65536)`, each record length equals its corresponding clear slice length, and every tag is 32 bytes.

播放器必须将 `segmentUri` 解析为绝对 URL 后与正在加载的媒体对象身份比较，并按 URL 规则解析相对 `keyUri`；跨源获取受 CORS 与宿主授权配置约束。
The player must resolve `segmentUri` to an absolute URL and compare it with the media object being loaded, and resolve relative `keyUri` values according to URL rules; cross-origin requests are subject to CORS and host authorization configuration.

## 5. 播放密钥 Provider 契约
## 5. Playback key-provider contract

播放器向宿主回调传入 `keyId`、`contentId`、`keyUri`、profile、用途和 AbortSignal；宿主负责鉴权并返回对应 32 字节 master key。
The player callback receives `keyId`, `contentId`, `keyUri`, profile, purpose, and AbortSignal; the host authenticates the request and returns the corresponding 32-byte master key.

播放器在浏览器内按本规范派生 AES/HMAC 子密钥并以不可导出的 `CryptoKey` 发送给 Worker；可选 provider 也可直接返回符合算法与用途约束的不可导出 `CryptoKey`。
The player derives AES/HMAC subkeys in the browser according to this specification and transfers them to the Worker as non-extractable `CryptoKey` objects; an optional provider may instead return non-extractable `CryptoKey` objects with the required algorithms and usages.

provider 的拒绝、空响应、错误长度、错误 keyId、超时和取消都必须作为播放错误上报；不得尝试演示密钥、匿名取钥或清晰内容回退。
Provider denial, empty responses, incorrect key length, mismatched keyId, timeouts, and cancellation must be reported as playback errors; never fall back to demo keys, anonymous key retrieval, or clear-media fallback.

密钥请求与密钥缓存的授权域由调用方决定；库内默认不跨播放器实例缓存密钥，也不把密钥写入持久化浏览器存储。
The caller defines the authorization scope of key requests and caching; by default, the library does not share key caches across player instances or persist keys in browser storage.

## 6. 错误处理与 Range 约束
## 6. Error handling and Range constraints

记录边界由 sidecar 的记录长度累加确定；Range 续传只能从经过完整 HMAC 验证的记录边界继续，不能从记录中间开始解密。
Record boundaries are calculated by summing record lengths from the sidecar; Range resume may continue only at a fully HMAC-verified record boundary and must not start decryption in the middle of a record.

对象续传必须校验 HTTP `206`、`Content-Range` 起点/总长度和与初始响应一致的 ETag；若服务器返回不同 ETag 或对象总长，必须停止当前分片并按明确策略从字节零重新获取或失败。
Object resume must validate HTTP `206`, the `Content-Range` start/total length, and an ETag matching the initial response; if the server returns a different ETag or object length, stop the current segment and either restart from byte zero under an explicit policy or fail.

HTTP `200` 对象替换响应不得被当作 Range 尾部拼接；播放器应丢弃不匹配响应中的缓存/解密状态后再执行策略。
An HTTP `200` object-replacement response must not be appended as the tail of a Range response; the player must discard mismatched response buffers/decrypt state before applying its recovery policy.

Sidecar 记录数、密文长度、清单宣告时长和解析到的完整 MP4 media fragment 数必须互相校验；任一矛盾都应在把不可信明文送入 MSE 前失败。
Sidecar record count, ciphertext length, playlist duration, and the number of parsed complete MP4 media fragments must be checked against each other; any contradiction must fail before untrusted clear bytes are passed to MSE.

## 7. 共享互操作向量要求
## 7. Shared interoperability vector requirements

V1 固定向量包含 master key、UUID contentId、baseCounter、明文和确切输出记录字节；生产加密器仍必须使用 CSPRNG baseCounter，禁止使用该向量密钥。
The V1 fixed vector contains the master key, UUID contentId, baseCounter, cleartext, and exact output record bytes; production encryptors must still use a CSPRNG baseCounter, and the vector key must never be used outside tests.

当前基础向量存放于 [`tests/fixtures/ctr-hmac-v1.json`](../../tests/fixtures/ctr-hmac-v1.json)，用于 PHP 断言与浏览器 Worker 互操作测试；其中的密钥只用于公开测试向量，严禁用于真实内容。
The current base vector is stored in [`tests/fixtures/ctr-hmac-v1.json`](../../tests/fixtures/ctr-hmac-v1.json) for PHP assertions and browser Worker interoperability tests; its key is public test-vector data and must never protect real content.

该向量至少覆盖一条短记录、恰好 65,536 字节记录、多记录对象、错误 tag、错误 counter、错序序号和截断尾记录。
The vector set must cover at least one short record, an exactly 65,536-byte record, a multi-record object, an invalid tag, invalid counter, out-of-order sequence number, and a truncated trailing record.

PHP 单元测试与 JavaScript Dedicated Worker 必须独立检查同一固定向量；PHP 加密打包器生成的实际 VOD 分片还必须由 Worker 解密并核对明文、SHA-256、记录计数及 sidecar 元数据。
PHP unit tests and the JavaScript Dedicated Worker must independently check the same fixed vector; actual VOD segments generated by the PHP packager must also be decrypted by the Worker and checked for matching clear bytes, SHA-256, record count, and sidecar metadata.

测试向量可使用公开的测试密钥，但必须与生产 provider 和生产构建隔离，并明确标记不可用于真实内容。
Test vectors may use public test keys but must be isolated from production providers and production builds and clearly marked as unusable for real content.

## 8. 参考
## 8. References

HKDF 的算法定义为 [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869)；CTR 记录格式额外定义本项目的 counter 分块规则和认证封装。
HKDF is defined by [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869); this project-specific CTR record format additionally defines its counter allocation and authentication envelope.

本格式不是对 RFC 8216 HLS 标准加密标签的替代；HLS 标准 AES-128/CBC 与 fMP4 `SAMPLE-AES`/CBCS 的产品路径仍由 HLS 主 SDD 独立管理。
This format does not replace RFC 8216 HLS-standard encryption tags; the product paths for HLS-standard AES-128/CBC and fMP4 `SAMPLE-AES`/CBCS remain separately governed by the main HLS SDD.
