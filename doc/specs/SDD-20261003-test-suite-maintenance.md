# SDD：测试套件稳定性与弃用清理
# SDD: Test suite stability and deprecation cleanup

> 状态：Complete  
> Status: Complete  
> 创建日期：2026-10-03  
> Created: 2026-10-03  
> 负责人：项目维护者  
> Owner: Project maintainers  
> 关联 issue / PR：待创建
> Related issue / PR: To be created

## 1. 背景与问题
## 1. Background and problem

PHP 8.5 与 PHPUnit 10 下，完整测试运行出现进度速率断言失败、PHP 弃用提示和 PHPUnit 弃用提示。
Under PHP 8.5 and PHPUnit 10, the full test run reports a progress-rate assertion failure, PHP deprecations, and PHPUnit deprecations.

进度监听器测试依赖真实休眠时间；速率计算也将字节变化量与耗时相乘，导致结果受调度延迟影响。
The progress listener tests depend on real sleep intervals, and the rate calculation multiplies the size delta by elapsed time, making results sensitive to scheduling delays.

## 2. 目标与范围
## 2. Goals and scope

### 目标
### Goals

- 使用可控时钟验证进度监听器，确保测试结果确定且不依赖真实等待。
- Use a controllable clock to verify progress listeners so results are deterministic and do not depend on real waiting.
- 按数据量除以耗时计算传输速率，并妥善处理零或负时间间隔。
- Calculate throughput as size delta divided by elapsed time, and handle zero or negative intervals safely.
- 清理本次观察到的 PHP 8.5 弃用和 PHPUnit 10 弃用，同时保留 PHPUnit 9 的配置路径。
- Remove the observed PHP 8.5 and PHPUnit 10 deprecations while retaining a configuration path for PHPUnit 9.

### 不在本次范围
### Out of scope

- 不在本次变更中全面重写测试或升级所有开发依赖。
- Rewriting the entire test suite or upgrading all development dependencies is out of scope.

## 3. 用户场景
## 3. User scenarios

维护者在 PHP 8.5 容器中运行完整 PHPUnit 套件时，可获得稳定结果且不产生已知弃用提示。
Maintainers can run the full PHPUnit suite in the PHP 8.5 container with stable results and without the known deprecation notices.

CI 在 PHP 8.0 上使用 PHPUnit 9 时，仍能通过独立兼容配置运行同一套测试。
CI can continue running the same tests on PHP 8.0 with PHPUnit 9 through a separate compatible configuration.

## 4. 需求与预期行为
## 4. Requirements and expected behavior

- **REQ-1：** 速率按每秒处理的数据量计算；耗时无效或数据量未增加时速率为零。
- **REQ-1:** Throughput is calculated as the amount of data processed per second; the rate is zero when elapsed time is invalid or the size has not increased.
- **REQ-2：** 音频和视频进度测试使用固定时间输入，不调用 `sleep()`。
- **REQ-2:** Audio and video progress tests use fixed time inputs and do not call `sleep()`.
- **REQ-3：** PHP 8.5 弃用来源得到修复，包括 `SplObjectStorage` 旧方法、无效反射调用和空数组键。
- **REQ-3:** PHP 8.5 deprecation sources are fixed, including legacy `SplObjectStorage` methods, ineffective reflection calls, and null array keys.
- **REQ-4：** PHPUnit 10 的数据提供器声明、测试数据和 XML 配置符合当前规范。
- **REQ-4:** PHPUnit 10 data providers, test data, and XML configuration follow the current conventions.
- **REQ-5：** PHPUnit 9 与 PHPUnit 10 都能通过对应配置运行测试。
- **REQ-5:** Tests can run with both PHPUnit 9 and PHPUnit 10 through their respective configurations.

## 5. API 与兼容性
## 5. API and compatibility

不改变公开 API 签名。速率值修正为按秒计算，属于对现有进度值含义的纠正。
No public API signatures change. The rate value is corrected to represent throughput per second, matching its existing meaning.

保留 PHP 8.0 支持，并为 PHPUnit 9 保留独立配置；PHPUnit 10 使用现代 XML 配置。
PHP 8.0 support is retained with a separate PHPUnit 9 configuration; PHPUnit 10 uses the modern XML configuration.

## 6. 设计方案
## 6. Design

在进度监听器中提供可覆盖的当前时间读取方法，使单元测试可注入固定时间序列。
Provide an overridable current-time method in the progress listener so unit tests can supply a fixed sequence of timestamps.

将 PHPUnit 10 配置放在默认 `phpunit.xml.dist`，并通过独立的 PHPUnit 9 配置及 CI 版本分支保持旧版兼容。
Use PHPUnit 10 configuration in the default `phpunit.xml.dist`, and preserve older-version compatibility through a separate PHPUnit 9 configuration and a CI version branch.

## 7. 验收标准
## 7. Acceptance criteria

- [x] 音频和视频进度监听器测试不再使用真实休眠，速率结果确定。
- [x] Audio and video progress listener tests no longer use real sleeps, and rate results are deterministic.
- [x] PHP 8.5 / PHPUnit 10 完整测试套件通过且无已知 PHP 或 PHPUnit 弃用提示。
- [x] The full suite passes under PHP 8.5 / PHPUnit 10 without the known PHP or PHPUnit deprecation notices.
- [x] PHPUnit 9 配置仍能用于 PHP 8.0 的 CI 测试。
- [x] The PHPUnit 9 configuration remains usable for PHP 8.0 CI tests.
- [x] 完整测试套件无失败。
- [x] The full test suite has no failures.

## 8. 验证计划
## 8. Verification plan

在 Docker PHP 8.5 环境运行完整 PHPUnit 套件并显示两类弃用详情；必要时在 PHP 8.0 / PHPUnit 9 环境检查兼容配置。
Run the full PHPUnit suite in the Docker PHP 8.5 environment with both deprecation types displayed; check the compatibility configuration under PHP 8.0 / PHPUnit 9 when available.

## 9. 风险与回滚
## 9. Risks and rollback

速率计算修正会改变错误时间间隔下返回的数值；通过针对固定输入的单元测试确认预期值。
Correcting the rate calculation changes values produced for elapsed intervals; fixed-input unit tests will verify the expected values.

## 10. 待决问题
## 10. Open questions

- 无。
- None.

## 11. 实施记录
## 11. Implementation notes

进度速率改为数据增量除以经过秒数；音频和视频监听器测试通过可控时钟提供固定时间值，移除了真实休眠。
Progress throughput now divides the size delta by elapsed seconds; audio and video listener tests use a controllable clock and no longer sleep.

清理了 PHP 8.5 弃用调用与 PHPUnit 10 的数据提供器、配置弃用；保留并更新了 PHPUnit 9 配置，CI 根据已安装的 PHPUnit 主版本选择配置。
Removed PHP 8.5 deprecated calls and PHPUnit 10 data provider and configuration deprecations; retained and updated the PHPUnit 9 configuration, with CI selecting configuration based on the installed PHPUnit major version.

PHP 8.5.11 / PHPUnit 10.5.65：554 个测试、1186 个断言、9 个跳过，全部通过，未报告弃用。
PHP 8.5.11 / PHPUnit 10.5.65: 554 tests, 1186 assertions, 9 skipped; all passed with no reported deprecations.

PHP 8.5.11 / PHPUnit 9.6.37：554 个测试、1156 个断言、9 个跳过，全部通过。
PHP 8.5.11 / PHPUnit 9.6.37: 554 tests, 1156 assertions, 9 skipped; all passed.
