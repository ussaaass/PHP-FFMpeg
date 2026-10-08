# SDD：容器化开发环境
# SDD: Dockerized development environment

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

贡献者需要在宿主机安装并维护 PHP、Composer、FFmpeg 和 FFprobe，导致环境准备成本高且不同开发机器之间容易出现差异。
Contributors currently need to install and maintain PHP, Composer, FFmpeg, and FFprobe on the host, which makes setup costly and environments inconsistent across machines.

## 2. 目标与范围
## 2. Goals and scope

### 目标
### Goals

- 提供基于 Docker Compose 的本地 PHP 开发和测试环境，宿主机只需 Docker 与 Compose。
- Provide a local PHP development and test environment through Docker Compose, requiring only Docker and Compose on the host.
- 在容器中提供 Composer、FFmpeg、FFprobe 以及项目测试所需的 PHP 扩展。
- Provide Composer, FFmpeg, FFprobe, and the PHP extensions required by the project tests inside the container.
- 将 Composer 下载缓存和 `vendor/` 依赖保存在 Docker 命名卷中。
- Store the Composer download cache and `vendor/` dependencies in Docker named volumes.

### 不在本次范围
### Out of scope

- 不提供生产部署镜像或生产运行编排。
- A production image or production deployment orchestration is out of scope.
- 不在本次变更中重写 GitHub Actions 的 CI 矩阵。
- Reworking the GitHub Actions CI matrix is out of scope for this change.

## 3. 用户场景
## 3. User scenarios

新贡献者克隆仓库后，通过 Docker Compose 安装依赖、运行 PHPUnit 或进入 PHP 容器，不需要在宿主机安装项目运行时。
A new contributor clones the repository and uses Docker Compose to install dependencies, run PHPUnit, or open a PHP container without installing the project runtime on the host.

## 4. 需求与预期行为
## 4. Requirements and expected behavior

- **REQ-1：** Docker 镜像默认使用 PHP 8.5 CLI，并安装 Composer、FFmpeg、FFprobe 和测试所需 PHP 扩展。
- **REQ-1:** The Docker image uses PHP 8.5 CLI by default and installs Composer, FFmpeg, FFprobe, and the PHP extensions required for testing.
- **REQ-2：** PHP 版本可通过 `PHP_VERSION` 构建参数覆盖。
- **REQ-2:** The PHP version can be overridden through the `PHP_VERSION` build argument.
- **REQ-3：** Compose 提供依赖安装、测试执行和交互式 shell 所需的 PHP 服务。
- **REQ-3:** Compose provides a PHP service for dependency installation, test execution, and an interactive shell.
- **REQ-4：** 项目源码通过 bind mount 提供给容器，`vendor/` 和 Composer 缓存保存在命名卷中。
- **REQ-4:** Project source is bind-mounted into the container, while `vendor/` and the Composer cache are stored in named volumes.
- **REQ-5：** 仓库提供清楚的容器构建、依赖安装、测试、shell 和 PHP 版本切换命令。
- **REQ-5:** The repository documents clear commands for building the container, installing dependencies, running tests, opening a shell, and switching PHP versions.

### 错误与边界情况
### Errors and edge cases

- 首次构建和 Composer 安装需要网络连接与可用的 Docker 镜像源。
- The first image build and Composer installation require network access and a working Docker image registry.
- 容器内的 `vendor/` 由 Docker 命名卷管理，不应要求宿主机安装 PHP。
- The container's `vendor/` directory is managed by a Docker named volume and must not require host PHP.

## 5. API 与兼容性
## 5. API and compatibility

不改变 PHP 库的公开 API 或运行时依赖声明；本次只增加开发环境配置。默认 PHP 版本为项目当前支持范围中的 8.5。
The public PHP library API and runtime dependency declarations remain unchanged; this change adds development environment configuration only. The default PHP version is 8.5, which is within the project's current supported range.

## 6. 设计方案
## 6. Design

使用官方 PHP CLI Debian 镜像构建开发容器，通过 Docker Compose 管理容器和命名卷，并在 `doc/DOCKER.md` 记录日常命令。
Build the development container from the official PHP CLI Debian image, manage the container and named volumes through Docker Compose, and document everyday commands in `doc/DOCKER.md`.

## 7. 验收标准
## 7. Acceptance criteria

- [x] Docker Compose 能成功构建 PHP 开发镜像。
- [x] Docker Compose can successfully build the PHP development image.
- [x] 容器内可运行 `php`、`composer`、`ffmpeg` 和 `ffprobe`。
- [x] `php`, `composer`, `ffmpeg`, and `ffprobe` run inside the container.
- [x] 容器内 Composer 安装的依赖位于命名卷，不会要求宿主机 PHP。
- [x] Dependencies installed by Composer inside the container reside in a named volume and do not require host PHP.
- [x] 文档提供依赖安装、测试运行、进入 shell 和切换 PHP 版本的命令。
- [x] Documentation provides commands to install dependencies, run tests, open a shell, and switch PHP versions.

## 8. 验证计划
## 8. Verification plan

构建 Compose 镜像，并在容器中检查 PHP、Composer、FFmpeg、FFprobe 版本和 PHP 扩展；按需通过容器运行 PHPUnit。
Build the Compose image and inspect PHP, Composer, FFmpeg, FFprobe, and PHP extension versions inside the container; run PHPUnit through the container when requested.

## 9. 风险与回滚
## 9. Risks and rollback

Docker Hub 或系统包仓库不可用时，首次构建会失败；通过移除新增 Docker 配置即可回滚，不影响库的 PHP API。
The first build will fail if Docker Hub or the system package repository is unavailable; removing the added Docker configuration rolls back the change without affecting the PHP library API.

## 10. 待决问题
## 10. Open questions

- 无；PHP 8.5 作为默认开发版本，且保留 `PHP_VERSION` 覆盖能力。
- None; PHP 8.5 is the default development version, and `PHP_VERSION` remains configurable.

## 11. 实施记录
## 11. Implementation notes

已添加 Dockerfile、Compose 服务、构建忽略规则和 Docker 使用指南，并在仓库 README 中添加入口。
Added a Dockerfile, Compose service, build ignore rules, and Docker usage guide, and linked the guide from the repository README.

已成功构建镜像，并在容器中确认 PHP 扩展、Composer、FFmpeg 与 FFprobe 可用。
Successfully built the image and confirmed the PHP extensions, Composer, FFmpeg, and FFprobe are available in the container.

按维护者要求运行 PHPUnit：554 个测试、1159 个断言，1 个失败、9 个跳过；另有 6 条代码弃用和 41 条 PHPUnit 配置弃用。失败位于 `VideoProgressListenerTest::testHandle` 的速率浮动范围断言。
PHPUnit was run at the maintainer's request: 554 tests, 1159 assertions, 1 failure, and 9 skipped; there were also 6 code deprecations and 41 PHPUnit configuration deprecations. The failure is the rate tolerance assertion in `VideoProgressListenerTest::testHandle`.
