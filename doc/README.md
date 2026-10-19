# SDD 文档管理

本目录用于管理 PHP-FFMpeg 后续的 SDD（Specification-Driven Development，规格驱动开发）文档。每个有明确用户价值、影响公开 API 或涉及多处实现的改动，都应先有一份 SDD；小型缺陷修复可以直接通过 issue 和代码评审跟踪。

## 文档组织

- `SDD_TEMPLATE.md`：新 SDD 的起始模板。
- `specs/`：具体需求规格。每项需求一份 Markdown 文件。

文件名格式：`SDD-YYYYMMDD-简短英文主题.md`。日期使用首次起草日期；文件创建后保持路径稳定。

## 编写与评审流程

1. 从模板创建文档，先写清问题、目标和明确不做的范围。
2. 记录现状、用户场景、行为要求，以及公开 API、兼容性和错误处理约定。
3. 补充实现方案、测试/验证方式、风险和待决事项。未确定的内容明确标为待决，不要伪装成已达成的决定。
4. 状态设为 `Review`，完成需求和方案评审后改为 `Approved`。
5. 实施期间状态设为 `Implementing`；实现完成并核对验收标准后改为 `Complete`。
6. 需求被新规格取代时，将旧文档设为 `Superseded`，并互相链接；不要删除已批准或已完成的规格。

状态只能表示文档当前阶段：`Draft`、`Review`、`Approved`、`Implementing`、`Complete`、`Superseded`。

## 强制双语规则

所有 SDD 必须逐行中英对照，不得豁免。每一行有实际含义的中文内容后，必须紧接一行意思对应的英文内容；先中文，后英文。标题、元数据、段落、列表项、表格内容、图注、代码注释和验收标准都适用此规则。

中英文必须表达相同的要求、范围、约束和状态，不能只翻译摘要或部分章节。代码、命令、标识符、链接和纯分隔符等无需翻译；但其说明文字仍须成对出现。表格中的中文与英文可在同一单元格内分行排列。

新建或更新 SDD 时，评审者必须检查全文逐行双语对应情况；不符合时不得标记为 `Approved` 或 `Complete`。以英文读者（包括原项目维护者）能够仅阅读英文行准确理解规格为验收要求。

## 维护约定

- SDD 描述预期行为和决策；实现细节只有在影响接口、兼容性或后续维护时才写入。
- 验收标准应可观察、可验证，并尽量覆盖成功路径、失败路径和兼容性。
- 实施过程中若需求或方案发生实质变化，先更新 SDD，再继续实现。
- 标记 `Complete` 前，检查规格中的验收标准是否已满足，并记录实际验证结果。
- SDD 不替代代码注释、用户文档、变更日志或 issue；需要时在文档中链接它们。

## SDD 索引

新建规格后，在下方登记标题、状态和日期，便于查找。

| 文档 | 状态 | 创建日期 | 简述 |
| --- | --- | --- | --- |
| [SDD-20261003-dockerized-development.md](specs/SDD-20261003-dockerized-development.md)<br>容器化开发环境 | Approved | 2026-10-03 | 使用 Docker 提供本地 PHP、Composer 与 FFmpeg 开发和验证环境。<br>Use Docker for the local PHP, Composer, and FFmpeg development and verification environment. |
| [SDD-20261003-test-suite-maintenance.md](specs/SDD-20261003-test-suite-maintenance.md)<br>测试稳定性与弃用清理 | Complete | 2026-10-03 | 修正进度速率测试并清理 PHP/PHPUnit 弃用。<br>Fix progress-rate tests and clean up PHP/PHPUnit deprecations. |
| [SDD-20261003-hls-support.md](specs/SDD-20261003-hls-support.md)<br>HLS 输出与输入支持 | Review | 2026-10-03 | 设计媒体编排、HLS 输出、加密及执行前兼容性预检。<br>Specify media orchestration, HLS output, encryption, and pre-execution compatibility checks. |
| [SDD-20261004-hls-technical-validation.md](specs/SDD-20261004-hls-technical-validation.md)<br>HLS 技术验证计划 | Implementing | 2026-10-04 | 记录 FFmpeg 9 HLS 实验，并规定隔离的 Docker CTR 播放 Demo 与 Worker/MSE、弱网验证。<br>Record FFmpeg 9 HLS experiments and specify an isolated Docker CTR playback Demo with Worker/MSE and poor-network validation. |
| [SDD-20261004-hls-api-usage-design.md](specs/SDD-20261004-hls-api-usage-design.md)<br>HLS 编排 API 使用方式与参数模型 | Review | 2026-10-04 | 提议 Docker 工作流中的结构化输入、步骤、输出、加密与预检 API。<br>Propose structured input, step, output, encryption, and preflight APIs for Docker workflows. |
| [SDD-20261020-retire-ctr-hmac-v1-workflow.md](specs/SDD-20261020-retire-ctr-hmac-v1-workflow.md)<br>从 HLS Workflow API 中退役 CTR-HMAC V1 | Review | 2026-10-20 | 解决公开 Workflow 仍能生成维护播放器不支持的 V1 sidecar 产物的问题。<br>Address the issue where the public Workflow can still emit V1 sidecar artifacts unsupported by the maintained player. |
