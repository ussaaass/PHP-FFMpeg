# CTR/HMAC 媒体记录格式 V2
# CTR/HMAC Media Record Format V2

> 状态：Approved / Frozen；维护者于 2026-10-20 批准字节格式；实现完成前不得用于生产媒体。
> Status: Approved / Frozen; the maintainer approved the byte format on 2026-10-20; do not use it for production media until implementation is complete.
> 关联设计：[CTR-HLS V2 无 Sidecar 播放 SDD](SDD-20261020-hls-ctr-hmac-v2-no-sidecar.md)
> Related design: [CTR-HLS V2 sidecar-free playback SDD](SDD-20261020-hls-ctr-hmac-v2-no-sidecar.md)
> V1 规范：[CTR/HMAC 媒体记录格式 V1](CTR-HMAC-RECORD-FORMAT-V1.md)
> V1 specification: [CTR/HMAC Media Record Format V1](CTR-HMAC-RECORD-FORMAT-V1.md)

## 1. 目的与安全模型
## 1. Purpose and security model

本文件提出无逐片 sidecar 的 V2 二进制对象格式，用于 fMP4 HLS `.m4s` 媒体对象的项目自定义 AES-CTR 加密与 HMAC-SHA-256 认证。
This document proposes a V2 binary-object format without per-segment sidecars for project-specific AES-CTR encryption and HMAC-SHA-256 authentication of fMP4 HLS `.m4s` media objects.

V2 不是 RFC 8216 的 `AES-128`、`SAMPLE-AES` 或 DRM；播放必须使用实现本格式的自定义播放器。
V2 is not RFC 8216 `AES-128`, `SAMPLE-AES`, or DRM; playback requires a custom player implementing this format.

同一视频资产在一个播放/打包上下文中使用调用方提供的固定 32 字节主密钥；每个对象通过独立 `contentId` 派生对象级 AES/HMAC 子密钥。
One video asset uses a caller-supplied stable 32-byte master key within a playback/packaging context; each object derives object-scoped AES/HMAC subkeys from a distinct `contentId`.

V2 中的 `contentId` 是非秘密对象身份，不是密钥、URL 凭证或访问授权。
The V2 `contentId` is a non-secret object identity, not a key, URL credential, or access authorization.

V1 是独立冻结 profile；V2 的实现不得修改 V1 记录字节或把 V2 对象按 V1 解码。
V1 is a separately frozen profile; V2 implementation must not modify V1 record bytes or decode V2 objects as V1.

V1 含有逐片 JSON sidecar 这一重大设计缺陷，仅供历史参考；维护中的实现只支持 V2，不得读取、生成或自动迁移 V1。
V1 contains the major design defect of per-segment JSON sidecars and is retained only for historical reference; maintained implementations support V2 only and must not read, emit, or automatically migrate V1.

## 2. 密钥派生
## 2. Key derivation

主密钥必须恰好为 32 字节，由应用在打包时提供，并在播放时通过播放信息携带的 Key URI 从应用取得同一份字节。
The master key must be exactly 32 bytes, supplied by the application during packaging and retrieved as the same bytes from the application through the Key URI carried in playback information.

每次加密对象尝试必须由 CSPRNG 生成一个新的 16 字节 `contentId`；不得把它从资产 ID、rendition、分片序号、版本 ID 或文件名确定性计算出来。
Each encryption-object attempt must generate a new 16-byte `contentId` using a CSPRNG; it must not be deterministically calculated from asset ID, rendition, segment sequence, version ID, or filename.

使用 `contentId` 原始 16 字节作为 HKDF-SHA-256 salt；不得先转为 UUID 文本、十六进制或 Base64 再作为 salt。
Use the raw 16 `contentId` bytes as the HKDF-SHA-256 salt; do not convert them to UUID text, hexadecimal, or Base64 before using them as the salt.

AES 派生固定前缀为 UTF-8 `phpffmpeg-ctr-hmac-v2\0aes-128-ctr\0`，长度为 34 字节。
The fixed AES-derivation prefix is UTF-8 `phpffmpeg-ctr-hmac-v2\0aes-128-ctr\0`, with a length of 34 bytes.

HMAC 派生固定前缀为 UTF-8 `phpffmpeg-ctr-hmac-v2\0hmac-sha256\0`，长度为 34 字节。
The fixed HMAC-derivation prefix is UTF-8 `phpffmpeg-ctr-hmac-v2\0hmac-sha256\0`, with a length of 34 bytes.

从主密钥和 `contentId` salt 按 RFC 5869 执行 HKDF-SHA-256，独立输出 16 字节 AES key 和 32 字节 HMAC key；不得直接把主密钥用于 AES 或 HMAC。HKDF `info` 还绑定前导区中的资产、Key、清晰度和 HLS 分片上下文，具体字节定义见第 3 节。
Apply HKDF-SHA-256 according to RFC 5869 using the master key and `contentId` salt, independently deriving a 16-byte AES key and a 32-byte HMAC key; never use the master key directly for AES or HMAC. The HKDF `info` also binds the asset, key, rendition, and HLS segment context from the preamble; exact bytes are defined in Section 3.

## 3. 对象前导区
## 3. Object preamble

每个对象以固定 40 字节前导区开始，前导区不加密。
Each object begins with a fixed 40-byte unencrypted preamble.

字节 `0–7` 固定为 8 个 ASCII 字节 `PFFHLS2` 后跟 LF 字节 `0x0a`，即十六进制 `50 46 46 48 4c 53 32 0a`。
Bytes `0–7` are fixed to the 8 ASCII bytes `PFFHLS2` followed by LF byte `0x0a`, namely hexadecimal `50 46 46 48 4c 53 32 0a`.

| Offset / 偏移 | Length / 长度 | Field / 字段 | Encoding / 编码 |
|---:|---:|---|---|
| `0–7` | 8 | Magic `PFFHLS2\n` | 固定 ASCII/LF 字节 / Fixed ASCII/LF bytes |
| `8–15` | 8 | `assetId` | 无符号 64 位大端 / Unsigned 64-bit big-endian |
| `16–17` | 2 | `keyId` | 无符号 16 位大端，范围 `0–1023` / Unsigned 16-bit big-endian, range `0–1023` |
| `18–19` | 2 | `shortEdgePixels` | 无符号 16 位大端，范围 `1–65535` / Unsigned 16-bit big-endian, range `1–65535` |
| `20–21` | 2 | `segmentSequence` | 无符号 16 位大端，范围 `0–65535` / Unsigned 16-bit big-endian, range `0–65535` |
| `22–23` | 2 | Reserved | 必须全为零 / Must be zero |
| `24–39` | 16 | `contentId` | CSPRNG 原始字节 / Raw CSPRNG bytes |

`assetId` 是调用方的无符号 64 位整数；前导中保存其 8 字节大端值。`keyId` 是调用方的数字标识，同一资产播放信息、打包 KeyMaterial 与对象前导必须一致。
`assetId` is the caller-supplied unsigned 64-bit integer, stored in the preamble as 8 big-endian bytes. `keyId` is the caller-supplied numeric identifier and must match across playback information, packaging KeyMaterial, and the object preamble.

`shortEdgePixels` 是视频实际宽高中的较短边像素数，不使用 `720p` 等文本标签。`segmentSequence` 是 rendition 内从零开始的 HLS 媒体分片序号，不是对象内部加密记录序号。
`shortEdgePixels` is the pixel count of the shorter actual video dimension; text labels such as `720p` are not used. `segmentSequence` is the zero-based HLS media-segment sequence within a rendition, not the encrypted record sequence within the object.

保留字节必须为零；未知或越界字段必须拒绝。AES HKDF `info` 为 AES 固定前缀后接前导区字节 `8–21`，总长 48 字节；HMAC HKDF `info` 为 HMAC 固定前缀后接相同 14 字节上下文，总长 48 字节。两者均使用 `contentId` 原始 16 字节作为 HKDF salt。
Reserved bytes must be zero; unknown or out-of-range fields must be rejected. The AES HKDF `info` is the fixed AES prefix followed by preamble bytes `8–21`, for 48 bytes total; the HMAC HKDF `info` is the fixed HMAC prefix followed by the same 14 context bytes, also 48 bytes total. Both use the raw 16 `contentId` bytes as HKDF salt.

任何前导区长度错误、magic 不匹配或重复读取到不支持的 profile 均须拒绝；播放器不得尝试猜测格式。
Reject any incorrect preamble length, mismatching magic, or unsupported profile; the player must not guess the format.

前导区 offset 为 0；第一条记录 offset 为 40；这 40 字节必须计入 HTTP 对象总长和所有 Range byte offset。
The preamble offset is 0; the first record offset is 40; these 40 bytes count toward the HTTP object total length and every Range byte offset.

`contentId` 虽未以独立明文 tag 认证，但它用于派生 HMAC key，且作为 HMAC 输入；篡改它会导致记录认证失败。
Although `contentId` is not covered by a separate plaintext tag, it derives the HMAC key and is included in the HMAC input; tampering with it causes record authentication to fail.

## 4. 记录布局与 CTR counter
## 4. Record layout and CTR counter

对象前导区之后是一条或多条连续记录；对象不允许额外 padding 或尾随数据。
One or more contiguous records follow the object preamble; objects do not allow extra padding or trailing data.

每条记录布局为 `header || ciphertext || tag`；header 固定 24 字节，tag 固定 32 字节。
Each record is laid out as `header || ciphertext || tag`; the header is exactly 24 bytes and the tag is exactly 32 bytes.

header 字节 `0–3` 是从零开始的记录序号，使用无符号 32 位 big-endian 编码；每个新对象的第一条记录序号必须为 0，后续必须严格递增 1。
Header bytes `0–3` contain the zero-based record sequence as an unsigned 32-bit big-endian integer; the first record of each new object must be 0 and each following record must increase by exactly 1.

header 字节 `4–19` 是该记录 AES-CTR 操作的 16 字节初始 counter block，按网络字节序存放。
Header bytes `4–19` contain the 16-byte initial counter block for that record's AES-CTR operation, stored in network byte order.

header 字节 `20–23` 是无符号 32 位大端 `lengthAndFlags`；最高位 `0x80000000` 是 `FINAL` 标记，低 31 位是密文字节长度。密文长度等于明文长度，且必须在 1 至 65,536 字节范围内。
Header bytes `20–23` contain an unsigned 32-bit big-endian `lengthAndFlags` value; the most significant bit `0x80000000` is the `FINAL` flag and the lower 31 bits are the ciphertext byte length. Ciphertext length equals plaintext length and must be between 1 and 65,536 bytes.

记录总长度由 header 在线解析为 `24 + ciphertextLength + 32` 字节；解析器必须先屏蔽 `FINAL` 位并检查长度上限，再分配/缓存完整记录。
Record total length is parsed online from the header as `24 + ciphertextLength + 32` bytes; the parser must mask off the `FINAL` bit and check the maximum length before allocating or buffering a complete record.

每个对象使用新的 16 字节 CSPRNG `baseCounter`；第一条记录 header 的 counter 等于该值。
Each object uses a new 16-byte CSPRNG `baseCounter`; the first record's header counter equals that value.

第 `sequence` 条记录的初始 counter 是 128 位无符号 big-endian 整数 `baseCounter + sequence × 4096`；溢出必须失败且不得回绕。
The initial counter for record `sequence` is the 128-bit unsigned big-endian integer `baseCounter + sequence × 4096`; overflow must fail and must never wrap.

每条记录最多消耗 4,096 个 AES block counter 值；实现必须确保记录明文最多 65,536 字节，并采用 AES-CTR 标准的末尾部分 block 处理。
Each record consumes at most 4,096 AES block counter values; implementations must cap record plaintext at 65,536 bytes and process a final partial block according to AES-CTR.

实现必须同时检查该记录最后一个实际使用的 counter block 不超过 `2^128−1`；只检查记录起始 counter 不足以防止 128 位加法回绕。
Implementations must also verify that the last counter block actually used by a record does not exceed `2^128−1`; checking only the record's starting counter does not prevent 128-bit wraparound.

V2 header 的 `sequence` 是对象内加密记录序号，从零连续递增；前导 `segmentSequence` 才是 HLS rendition 的分片序号，二者不得混用。
The V2 header `sequence` is the encrypted record index within an object and increases contiguously from zero; the preamble `segmentSequence` is the HLS segment sequence within a rendition, and the two must not be conflated.

除最后一条记录外，所有记录的 `FINAL` 位必须为 0；恰好最后一条记录的 `FINAL` 位必须为 1。该位包含在完整 header 的 HMAC 中；设置 `FINAL` 后不得再有记录或尾随字节。
The `FINAL` bit must be 0 on every record except the last, and must be 1 on exactly the last record. This bit is covered by the HMAC over the complete header; no records or trailing bytes may follow a record marked `FINAL`.

打包器必须暂存最多一条待输出记录：读到后续明文时才将前一条记录作为非末记录写出；输入 EOF 后将最后一条记录标记为 `FINAL`。空媒体对象必须拒绝。
The packager must stage at most one pending record: it writes a pending record as non-final only after more clear input arrives, then marks the last record `FINAL` when input reaches EOF. Empty media objects must be rejected.

## 5. 记录认证与加解密顺序
## 5. Record authentication and encryption order

V2 HMAC domain 的确切字节为 UTF-8 `phpffmpeg-ctr-hmac-v2\n`，包含末尾一个 LF 字节 `0x0a`。
The exact V2 HMAC-domain bytes are UTF-8 `phpffmpeg-ctr-hmac-v2\n`, including one trailing LF byte `0x0a`.

`tag = HMAC-SHA-256(macKey, domain || preamble40 || header24 || ciphertext)`；tag 固定 32 字节，不截断。
`tag = HMAC-SHA-256(macKey, domain || preamble40 || header24 || ciphertext)`; the tag is exactly 32 bytes and is not truncated.

加密使用 Encrypt-then-MAC：先以该记录 header counter 执行 AES-128-CTR，再对完整前导区、header 和密文计算 HMAC。
Encryption uses Encrypt-then-MAC: first apply AES-128-CTR with the record header counter, then calculate HMAC over the complete preamble, header, and ciphertext.

解密端必须先验证完整 HMAC，再运行 AES-CTR；不得在 tag 校验成功前向 MSE、DOM、文件或调用方提供任何该记录明文。
The decryptor must verify the complete HMAC before running AES-CTR; it must not expose any plaintext from that record to MSE, the DOM, files, or callers before tag verification succeeds.

在同一个视频级主密钥下，不同 `contentId` 通过 HKDF 得到不同对象级 AES/HMAC 子密钥；对象间 counter 数值可重复，但同一实际 AES key 下的 AES counter block 不得重复。
Under one video-level master key, distinct `contentId` values derive distinct object-level AES/HMAC subkeys through HKDF; numeric counters may repeat between objects, but AES counter blocks must never repeat under the same actual AES key.

## 6. 对象结束与完整性检查
## 6. Object completion and integrity checks

无 sidecar 模式下，播放器以初始 HTTP 响应的有效 `Content-Length` 或最终 `Content-Range` 总长确定密文对象总长；续传必须保持该总长。HTTP 长度用于传输一致性检查，不代替格式结束标记。
Without sidecars, the player determines ciphertext object length from a valid initial HTTP `Content-Length` or final `Content-Range` total; resumption must preserve that total. HTTP length is used for transport-consistency checks and does not replace the format's completion marker.

对象必须恰好以带有效 HMAC 的 `FINAL` 记录结束；EOF 前未遇到 `FINAL`、`FINAL` 记录后仍有字节，或不完整 header、ciphertext、tag，均为截断/格式错误。
An object must end exactly with a `FINAL` record carrying a valid HMAC; reaching EOF without `FINAL`, receiving bytes after a `FINAL` record, or receiving an incomplete header, ciphertext, or tag is a truncation/format error.

播放器必须验证前导上下文、记录序号连续、counter 按 base counter 规则匹配、每条 tag 正确、恰有一个末尾 `FINAL` 标记且 HTTP 总 byte 数一致。
The player must validate preamble context, contiguous record sequence numbers, counters matching the base-counter rule, every tag, exactly one terminal `FINAL` marker, and the total HTTP byte count.

播放器必须从认证后的明文中解析完整 MP4 box 与 `moof`/`mdat` 配对；不完整媒体片段不得追加到 MSE。
The player must parse complete MP4 boxes and `moof`/`mdat` pairs from authenticated plaintext; incomplete media fragments must not be appended to MSE.

`EXTINF` 与时长、最终 MP4 片段数不再依赖逐片 sidecar 交叉声明；播放器必须在 VOD 结束时检测残余明文、残余密文或未完成 box。
`EXTINF` duration and final MP4-fragment count are no longer cross-declared through per-segment sidecars; at VOD completion, the player must detect residual plaintext, residual ciphertext, or incomplete boxes.

## 7. HTTP Range 与对象版本
## 7. HTTP Range and object versions

首次请求可以为完整 GET，预期状态码为 `200`；播放器流式读取前导区和记录，不等待完整对象下载后才开始验证。
The initial request may be a full GET and is expected to return `200`; the player streams the preamble and records and does not wait for the complete object download before starting validation.

播放器只在完整记录成功认证后推进对象 offset；该 offset 包含 40 字节前导区及之前每条完整记录的 header、密文和 tag。
The player advances the object offset only after a complete record authenticates; this offset includes the 40-byte preamble and every prior complete record's header, ciphertext, and tag.

续传请求使用 `Range: bytes={offset}-` 和初始响应的强 ETag `If-Range`；无强 ETag 时可以完整播放成功，但中断后必须从对象零重取或显式失败，不得假装安全续传。
Resume requests use `Range: bytes={offset}-` and the initial response's strong ETag as `If-Range`; playback may succeed without a strong ETag if uninterrupted, but after interruption it must restart from object byte zero or fail explicitly rather than claiming safe resumption.

续传响应必须为 `206`，`Content-Range` 起点必须等于请求 offset，总长必须等于初始对象长度，结束位置及响应体 byte 数必须一致，强 ETag 必须与初始值完全一致。
A resume response must be `206`; the `Content-Range` start must equal the requested offset, its total must equal the initial object length, its end must match the response-body byte count, and its strong ETag must exactly match the initial value.

服务器若返回 `200`、无效 `206`、新 ETag 或不同总长，播放器必须拒绝响应并清理当前对象缓冲；禁止跨对象版本拼接。
If the server returns `200`, an invalid `206`, a new ETag, or a different total length, the player must reject the response and clear the current object buffer; combining object versions is forbidden.

CORS 必须暴露 `ETag`、`Content-Range`、`Content-Length`，并允许 `Range`、`If-Range` 及应用所需授权 header。
CORS must expose `ETag`, `Content-Range`, and `Content-Length`, and allow `Range`, `If-Range`, and application-required authorization headers.

## 8. 对象 URI 与文件命名契约
## 8. Object URI and filename contract

未签名路径为 `/media/{assetIdHex}/{keyId}/{shortEdgePixels}/{versionId}/{md5Prefix}-{sequence5}.m4s`；`assetIdHex` 是 8 字节大端 assetId 的 16 字符小写十六进制值，keyId 和 shortEdgePixels 使用规范十进制；`sequence5` 固定为五位补零十进制，范围对应 `00000`–`65535`。
The unsigned path is `/media/{assetIdHex}/{keyId}/{shortEdgePixels}/{versionId}/{md5Prefix}-{sequence5}.m4s`; `assetIdHex` is the 16-character lowercase hexadecimal form of the 8-byte big-endian assetId, keyId and shortEdgePixels use canonical decimal, and `sequence5` is five-digit zero-padded decimal in the range `00000`–`65535`.

`assetId`、数字 `keyId`、短边像素值和 `versionId` 均由调用方提供；SDK 不负责持久化 AssetId 与 Key 的对应关系。路径中的 `keyId` 与前导/PlaybackInfo 中的 `keyId` 是同一个数值。
The caller supplies `assetId`, numeric `keyId`, short-edge pixel value, and `versionId`; the SDK does not persist the mapping between AssetId and Key. The path `keyId` is the same numeric value as the `keyId` in the preamble and PlaybackInfo.

`assetId` 的对象路径形式是其 8 字节大端值的小写十六进制表示，共 16 个字符；路径中的 `keyId` 与 `shortEdgePixels` 分别使用其规范十进制表示，不补零。
The object-path form of `assetId` is the lowercase hexadecimal representation of its 8-byte big-endian value, exactly 16 characters; path `keyId` and `shortEdgePixels` use their canonical unpadded decimal representations.

`sequence` 是 rendition 内从零开始的 HLS 分片序号，允许范围为 `0–65535`；文件名必须使用五位补零形式，超出范围必须失败，不得扩位或覆盖。
`sequence` is the zero-based HLS segment sequence within a rendition, with an allowed range of `0–65535`; filenames must use five-digit zero-padded form, and out-of-range values must fail without widening or overwriting.

`md5Prefix` 取 UTF-8 `{assetIdDecimal}-{shortEdgePixels}-{sequence}` 的 MD5 小写十六进制前 3 个字符；哈希输入数字使用规范十进制形式，文件名中的分片序号才补零。
`md5Prefix` is the first 3 lowercase hexadecimal characters of the MD5 digest of UTF-8 `{assetIdDecimal}-{shortEdgePixels}-{sequence}`; numeric hash inputs use canonical decimal, while only the filename segment sequence is padded.

扩展名固定为 `.m4s`；不得在路径或扩展名中加入 `ctr`、`encrypted` 或其他加密方式标识。
The extension is fixed to `.m4s`; do not include `ctr`, `encrypted`, or another encryption-method marker in the path or extension.

MD5 前缀只作为文件名格式组成部分，不承担唯一性保证、安全散列或授权；对象 URI 的各目录段、sequence 与 versionId 必须正确隔离对象。
The MD5 prefix is only a filename-format component and provides no uniqueness guarantee, secure hashing, or authorization; object path components, sequence, and versionId must correctly isolate objects.

动态 playlist 可以为对象 URI 附加签名 query；签名授权需绑定确切对象路径和不可变版本，播放器在 Range 重试中原样保留 query。
A dynamic playlist may append a signature query to an object URI; authorization must bind the exact object path and immutable version, and the player must preserve the query unchanged during Range retries.

路径只用于对象定位；即使路径包含非秘密数字 `keyId`，也不能用路径替代签名或访问控制。
The path is only for locating an object; even when it contains the non-secret numeric `keyId`, it cannot replace signatures or access control.

## 9. V2 互操作向量
## 9. V2 interoperability vectors

V2 固定向量必须包括 32 字节主密钥、16 字节 `contentId`、对象前导区、至少两条记录、明确 base counter、明文、完整对象字节和 SHA-256。
A V2 fixed vector must include a 32-byte master key, 16-byte `contentId`, object preamble, at least two records, explicit base counter, cleartext, complete object bytes, and SHA-256.

固定向量 `doc/vectors/CTR-HMAC-V2-001.json` 定义本规范的两记录互操作基准，包含完整输入、上下文、HKDF info/输出、header、counter、密文、tag、对象十六进制字节和 SHA-256。该向量使用公开测试密钥与固定 counter，只能用于互操作验证。
The fixed vector `doc/vectors/CTR-HMAC-V2-001.json` defines the two-record interoperability baseline for this specification and contains all inputs, context, HKDF info/outputs, headers, counters, ciphertexts, tags, complete object bytes in hexadecimal, and SHA-256. It uses public test keys and a fixed counter and is for interoperability validation only.

PHP 8.5 OpenSSL/HKDF 与 Node.js 24 `node:crypto` 独立生成结果逐字段一致：40 字节前导、AES/HMAC 子密钥、两条记录及 201 字节对象完全相同；对象 SHA-256 为 `954997fc759f472bccfe6450a63a43a16347e3ade3b622e4b016ce2d8e33068a`。
Independent generation with PHP 8.5 OpenSSL/HKDF and Node.js 24 `node:crypto` matches field for field: the 40-byte preamble, AES/HMAC subkeys, both records, and 201-byte object are identical; the object SHA-256 is `954997fc759f472bccfe6450a63a43a16347e3ade3b622e4b016ce2d8e33068a`.

PHP 单元测试和 Dedicated Worker 测试必须分别验证同一向量的确切派生子密钥行为、counter、tag 和明文。
PHP unit tests and Dedicated Worker tests must independently verify exact subkey-derivation behavior, counters, tags, and plaintext for the same vector.

负向向量必须覆盖前导区篡改、错误 profile、错序记录、长度超限、counter 错误、tag 错误、counter 溢出和截断对象。
Negative vectors must cover tampered preambles, unknown profiles, out-of-order records, oversized lengths, wrong counters, invalid tags, counter overflow, and truncated objects.

生产实现必须使用 CSPRNG 生成对象 contentId 和 base counter；固定测试向量密钥不得用于真实内容。
Production implementations must use a CSPRNG for object contentIds and base counters; fixed test-vector keys must never protect real content.

## 10. 当前状态
## 10. Current status

V2 字节布局已由维护者批准并冻结；固定向量已经过 PHP 与 Node.js 24 两种独立实现交叉生成。后续若需改变线协议字节，必须定义新的 profile，不能静默修改本冻结格式。
The V2 byte layout is approved and frozen by the maintainer; the fixed vector has been cross-generated by independent PHP and Node.js 24 implementations. Any future wire-byte change must define a new profile and must not silently alter this frozen format.

播放 Key 接口支持 `application/octet-stream` 原始 32 字节密钥，或 `application/json` 的 `{"key":"<hex>"}`（PHP `bin2hex()` 形式的 64 个小写十六进制字符）；播放器按 `Content-Type` 选择解析器，不做编码猜测。此为已确认的设计契约，尚未实现。
The playback Key endpoint supports either a raw 32-byte key as `application/octet-stream` or `application/json` with `{"key":"<hex>"}` (64 lowercase hexadecimal characters in PHP `bin2hex()` form); the player selects a parser by `Content-Type` and does not guess encodings. This contract is confirmed but not yet implemented.

五位补零 sequence 文件名规则已由维护者确认，尚未实现。
The five-digit zero-padded sequence filename rule has been confirmed by the maintainer but is not yet implemented.
