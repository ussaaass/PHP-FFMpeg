# SDD：从 HLS Workflow API 中退役 CTR-HMAC V1
# SDD: Retire CTR-HMAC V1 from the HLS Workflow API

> 状态：Review。
> Status: Review.
> 创建日期：2026-10-20。
> Created: 2026-10-20.
> 负责人：项目维护者。
> Owner: Project maintainers.
> 关联规格：[CTR-HLS V2 无 Sidecar 播放与对象 URI 契约](SDD-20261020-hls-ctr-hmac-v2-no-sidecar.md)。
> Related specification: [CTR-HLS V2 Sidecar-Free Playback and Object URI Contract](SDD-20261020-hls-ctr-hmac-v2-no-sidecar.md).

## 1. 背景与问题
## 1. Background and problem

CTR-HLS V2 规格明确规定 V1 不兼容且不受后续维护支持；V1 的逐片 JSON sidecar 缺陷已由 V2 协议取代。
The CTR-HLS V2 specification explicitly states that V1 is incompatible and unsupported for future maintenance; V2 replaces the V1 design with its per-segment JSON sidecar defect.

当前 `EncryptionProfile::ctrHmacV1()` 仍是公开工厂方法，`WorkflowVerifier` 接受该 profile，`WorkflowRunner` 会调用 V1 `PlaylistEncryptor` 并输出带 sidecar 的内容。
The current `EncryptionProfile::ctrHmacV1()` remains a public factory, `WorkflowVerifier` accepts that profile, and `WorkflowRunner` invokes the V1 `PlaylistEncryptor` to emit content with sidecars.

仓库中的维护播放器只实现 V2，因此调用者可以通过公开 Workflow API 成功生成维护播放器无法播放的 V1 产物。
The maintained player in this repository implements only V2, so callers can successfully generate V1 artifacts through the public Workflow API that the maintained player cannot play.

这会让“不支持 V1”的规格与实际 API 行为相矛盾，也可能导致调用者把 V1 产物发布到生产环境。
This contradicts the specification's “V1 unsupported” policy and can lead callers to publish V1 artifacts to production.

## 2. 目标与范围
## 2. Goals and scope

目标是让公开 HLS Workflow API 不再生成 CTR-HMAC V1 产物，并让加密能力与受支持的 V2 协议保持一致。
The goal is to ensure the public HLS Workflow API no longer emits CTR-HMAC V1 artifacts and that encryption capabilities align with the supported V2 protocol.

本 SDD 仅覆盖 HLS Workflow 的加密 profile、预检、执行、发布模式及其测试和文档。
This SDD covers only HLS Workflow encryption profiles, preflight validation, execution, publication modes, related tests, and documentation.

本 SDD 不要求兼容播放、迁移或重新加密既有 V1 内容；既有 V1 内容必须从原始媒体重新打包为 V2。
This SDD does not require compatible playback, migration, or re-encryption of existing V1 content; existing V1 content must be repackaged as V2 from its original media.

本 SDD 不改变 V2 密文格式、密钥派生、播放器、HLS playlist 签名或对象存储上传流程。
This SDD does not change the V2 ciphertext format, key derivation, player, HLS playlist signing, or object-storage upload process.

## 3. 现状证据
## 3. Current-state evidence

`src/FFMpeg/Format/Hls/Workflow/Value/EncryptionProfile.php` 暴露 `ctrHmacV1()`，并把 V1 profile 标识作为可选值返回。
`src/FFMpeg/Format/Hls/Workflow/Value/EncryptionProfile.php` exposes `ctrHmacV1()` and returns the V1 profile identifier as a selectable value.

`src/FFMpeg/Format/Hls/Workflow/WorkflowVerifier.php` 按 V1 profile 执行 fMP4、asset ID、master playlist 和 versioned publication 检查。
`src/FFMpeg/Format/Hls/Workflow/WorkflowVerifier.php` applies fMP4, asset ID, master-playlist, and versioned-publication checks based on the V1 profile.

`src/FFMpeg/Format/Hls/Workflow/WorkflowRunner.php` 导入并调用 `CtrHmacV1\PlaylistEncryptor`，对 FFmpeg 输出执行 V1 加密发布。
`src/FFMpeg/Format/Hls/Workflow/WorkflowRunner.php` imports and invokes `CtrHmacV1\PlaylistEncryptor` to encrypt and publish FFmpeg output using V1.

`player/README.md` 声明维护播放器只支持 V2，且不会读取 V1 sidecar。
`player/README.md` states that the maintained player supports V2 only and does not read V1 sidecars.

V2 的 `MediaPlaylistPackager::packageRenditions()` 已提供独立的多 rendition V2 打包入口；它当前不由 `WorkflowRunner` 调用。
V2's `MediaPlaylistPackager::packageRenditions()` already provides a separate multi-rendition V2 packaging entry point; it is not currently called by `WorkflowRunner`.

## 4. 需求
## 4. Requirements

- **REQ-1：** 维护中的公开 Workflow API 不得接受或生成 `phpffmpeg-ctr-hmac-v1` 产物。
- **REQ-1:** The maintained public Workflow API must neither accept nor emit `phpffmpeg-ctr-hmac-v1` artifacts.

- **REQ-2：** V1 profile 不得作为受支持的公开加密选项出现；若为源码兼容暂时保留旧符号，调用必须明确失败并指出 V1 已退役及 V2 替代入口。
- **REQ-2:** V1 must not appear as a supported public encryption option; if an old symbol is temporarily retained for source compatibility, invoking it must fail explicitly and identify V1 as retired and the V2 replacement entry point.

- **REQ-3：** V1 请求必须在 FFmpeg 转码或发布开始前失败，不得留下可被误认为成功结果的部分输出。
- **REQ-3:** A V1 request must fail before FFmpeg transcoding or publication begins and must not leave partial output that could be mistaken for a successful result.

- **REQ-4：** 受支持的 V2 打包必须继续通过 `CtrHmacV2\MediaPlaylistPackager` 完成，并且不得生成 V1 sidecar。
- **REQ-4:** Supported V2 packaging must continue through `CtrHmacV2\MediaPlaylistPackager` and must not emit V1 sidecars.

- **REQ-5：** Workflow 的 versioned publication 校验不得再以 V1 是否启用作为 V2 发布的前提；不支持的组合必须在预检时明确报告。
- **REQ-5:** Workflow versioned-publication validation must no longer depend on V1 being enabled for V2 publication; unsupported combinations must be reported clearly during preflight.

- **REQ-6：** 文档和示例不得继续建议调用 `EncryptionProfile::ctrHmacV1()` 作为有效的加密工作流。
- **REQ-6:** Documentation and examples must no longer recommend `EncryptionProfile::ctrHmacV1()` as a valid encrypted workflow.

## 5. 实施方向
## 5. Implementation direction

优先从公开 `EncryptionProfile` API 中移除 V1 选择，并删除 Workflow 对 V1 `PlaylistEncryptor` 的执行分支及其专属 KeyProvider/KeyUriResolver 依赖。
Prefer removing the V1 option from the public `EncryptionProfile` API and deleting the Workflow branch that executes the V1 `PlaylistEncryptor`, including its V1-specific KeyProvider/KeyUriResolver dependencies.

若维护者决定保留过渡期源码兼容，旧工厂方法必须标记弃用且返回值不能绕过 V1 拒绝检查。
If maintainers choose to retain source compatibility during a transition, the old factory must be deprecated and its value must not bypass V1 rejection checks.

V2 Workflow 集成可复用现有 `MediaPlaylistPackager::packageRenditions()`；是否将其封装成单次 `WorkflowRunner` 调用，应由实现评审确定，但不得因此恢复 V1 产物生成。
V2 Workflow integration may reuse the existing `MediaPlaylistPackager::packageRenditions()`; implementation review may decide whether to wrap it in a single `WorkflowRunner` call, but must not re-enable V1 artifact generation as a result.

若本次实现不将 V2 打包纳入 `WorkflowRunner`，则 Workflow 必须明确只负责生成未加密 HLS，V2 加密由独立打包器完成，并在 API 文档和示例中说明该边界。
If this implementation does not integrate V2 packaging into `WorkflowRunner`, Workflow must explicitly remain responsible only for generating unencrypted HLS, with V2 encryption performed by the separate packager; API documentation and examples must state this boundary.

## 6. 验收标准
## 6. Acceptance criteria

- [ ] 公开 Workflow API 无法生成 V1 sidecar 或 V1 profile 的加密分片。
- [ ] The public Workflow API cannot generate V1 sidecars or encrypted segments using the V1 profile.

- [ ] 若调用者仍传入旧 V1 选项，执行会在启动 FFmpeg 前失败，并返回稳定、可理解的错误信息。
- [ ] If a caller still supplies the old V1 option, execution fails before starting FFmpeg and returns a stable, understandable error.

- [ ] V1 被拒绝时，输出目录、staging 目录和 current-version pointer 均不发生部分发布或破坏。
- [ ] When V1 is rejected, no partial publication or damage occurs to the output directory, staging directory, or current-version pointer.

- [ ] V2 多 rendition 打包仍成功，所有 rendition 共用传入的 asset KeyMaterial，且生成物不包含 `.json` sidecar。
- [ ] V2 multi-rendition packaging still succeeds, all renditions use the supplied asset KeyMaterial, and generated artifacts contain no `.json` sidecars.

- [ ] versioned publication 对受支持的 V2 路径有明确行为；不支持的路径在预检阶段失败。
- [ ] Versioned publication has explicit behavior for supported V2 paths; unsupported paths fail during preflight.

- [ ] 所有引用 V1 Workflow 选项的测试、示例和用户文档均已更新；V1 格式文档作为历史协议记录保留。
- [ ] All tests, examples, and user documentation referring to the V1 Workflow option are updated; the V1 format document remains as a historical protocol record.

## 7. 风险与未决事项
## 7. Risks and open decisions

移除 V1 工厂方法会造成使用该未支持能力的调用方源码不兼容；保留但拒绝执行可降低源码迁移成本，却会暂时保留误导性 API 表面。
Removing the V1 factory causes a source-compatibility break for callers using this unsupported capability; retaining it while rejecting execution lowers migration cost but temporarily preserves a misleading API surface.

本 SDD 尚未决定是否把 V2 打包直接整合进 `WorkflowRunner`，还是维持“Workflow 生成明文 HLS、V2 Packager 加密发布”的两阶段 API；该决定须在 Approved 前明确。
This SDD does not yet decide whether V2 packaging should be integrated directly into `WorkflowRunner` or remain a two-stage API where Workflow generates clear HLS and the V2 Packager encrypts it; this decision must be resolved before approval.

本 SDD 仅记录审查发现和预期行为；在规格批准前，不视为已完成代码修复。
This SDD records the review finding and intended behavior only; it does not represent a completed code fix before the specification is approved.
