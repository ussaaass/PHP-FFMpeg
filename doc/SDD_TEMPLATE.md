# SDD：<需求标题>
# SDD: <Feature title>

> 状态：Draft  
> Status: Draft  
> 创建日期：YYYY-MM-DD  
> Created: YYYY-MM-DD  
> 负责人：<姓名或团队>  
> Owner: <Name or team>  
> 关联 issue / PR：<链接或无>
> Related issue / PR: <Link or none>

> **强制规则：每一行有实际含义的中文内容，下一行必须提供意思一致的英文。**
> **Mandatory: Every meaningful Chinese line must be followed by an English line with the same meaning.**

## 1. 背景与问题
## 1. Background and problem

描述现状、遇到的问题，以及为什么需要处理。
Describe the current situation, the problem, and why it needs to be addressed.

## 2. 目标与范围
## 2. Goals and scope

### 目标
### Goals

- <可验证的目标>
- <A verifiable goal>

### 不在本次范围
### Out of scope

- <明确排除的内容>
- <An explicitly excluded item>

## 3. 用户场景
## 3. User scenarios

描述使用者、触发条件和期望结果。必要时列出主要使用流程。
Describe the user, trigger, and expected result. Include the main workflow when useful.

## 4. 需求与预期行为
## 4. Requirements and expected behavior

按编号列出可观察的行为要求。
List observable behavior requirements with identifiers.

- **REQ-1：** <需求>
- **REQ-1:** <Requirement>

### 错误与边界情况
### Errors and edge cases

- <输入无效、外部程序失败、资源清理等行为>
- <Behavior for invalid input, external process failures, resource cleanup, and similar cases>

## 5. API 与兼容性
## 5. API and compatibility

说明公开 API、配置项、命令行参数或输出格式是否变化；说明 PHP、Symfony、FFmpeg 等支持范围及向后兼容影响。没有变化时写“无”。
Describe changes to public APIs, configuration, command-line arguments, or output formats. State the supported PHP, Symfony, FFmpeg, and other relevant versions, and any backward-compatibility impact. Write “None” when there are no changes.

## 6. 设计方案
## 6. Design

描述方案、关键决策及其理由。需要时记录备选方案和取舍。
Describe the approach, key decisions, and their rationale. Record alternatives and trade-offs when relevant.

## 7. 验收标准
## 7. Acceptance criteria

- [ ] <能独立验证的结果>
- [ ] <A result that can be verified independently>

## 8. 验证计划
## 8. Verification plan

列出需要运行的单元测试、集成测试、兼容性检查或手动验证，并说明涉及的环境/版本。
List the unit tests, integration tests, compatibility checks, or manual verification to perform, including relevant environments and versions.

## 9. 风险与回滚
## 9. Risks and rollback

列出已知风险、缓解方式，以及出现问题时如何恢复或禁用变更。
List known risks, mitigations, and how to revert or disable the change if problems occur.

## 10. 待决问题
## 10. Open questions

- [ ] <问题、负责人、解决期限；没有时写“无”>
- [ ] <Question, owner, and due date; write “None” when there are no open questions>

## 11. 实施记录
## 11. Implementation notes

实施后补充实际完成情况、验证结果、偏差及相关提交/PR 链接。评审和实现过程中若方案有实质调整，也在这里记录并同步更新上文。
After implementation, record what was completed, verification results, deviations, and related commit or PR links. Record material changes made during review or implementation here, and update the relevant sections above.
