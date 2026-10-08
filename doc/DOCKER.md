# Docker 开发环境
# Docker development environment

本项目提供 Docker 开发环境，宿主机只需安装 Docker Engine 或 Docker Desktop，并启用 Docker Compose。
This project provides a Docker development environment; the host only needs Docker Engine or Docker Desktop with Docker Compose enabled.

## 构建镜像
## Build the image

在仓库根目录执行：
Run from the repository root:

```sh
docker compose build
```

镜像默认使用 PHP 8.5 CLI，并包含 Composer、FFmpeg、FFprobe 以及 PHPUnit 所需的 PHP 扩展。
The image uses PHP 8.5 CLI by default and includes Composer, FFmpeg, FFprobe, and the PHP extensions required by PHPUnit.

默认 `php` 服务使用 Debian Bookworm 提供的 FFmpeg。HLS 需要验证最新稳定版时，可使用 `php-ffmpeg9` 服务；它从 BtbN FFmpeg Builds 下载锁定的 FFmpeg 9.0.2 GPL 静态构建，不会在 Docker 构建期间编译 FFmpeg。该构建支持 Linux `amd64` 和 `arm64`。
The default `php` service uses the FFmpeg package provided by Debian Bookworm. To verify HLS against the latest stable release, use the `php-ffmpeg9` service; it downloads a pinned FFmpeg 9.0.2 GPL static build from BtbN FFmpeg Builds and does not compile FFmpeg during the Docker build. This build supports Linux `amd64` and `arm64`.

首次构建 FFmpeg 9 镜像时需要下载约 120–145 MiB 的预编译归档；Docker 会缓存构建层，后续构建通常不需要重复下载。
The first FFmpeg 9 image build downloads a precompiled archive of about 120–145 MiB; Docker caches the build layer, so later builds usually do not download it again.

```sh
docker compose --profile ffmpeg9 build php-ffmpeg9
docker compose --profile ffmpeg9 run --rm php-ffmpeg9 ffmpeg -version
docker compose --profile ffmpeg9 run --rm php-ffmpeg9 ffprobe -version
docker compose --profile ffmpeg9 run --rm php-ffmpeg9 vendor/bin/phpunit
```

FFmpeg 9 镜像中的 `/usr/local/bin/ffmpeg` 和 `/usr/local/bin/ffprobe` 优先于 Debian 系统版本。运行 PHP 测试时，PHP-FFMpeg 会通过 PATH 使用这两个程序。该第三方归档采用 GPL 构建，仅用于本地开发和测试环境。
In the FFmpeg 9 image, `/usr/local/bin/ffmpeg` and `/usr/local/bin/ffprobe` take precedence over Debian system binaries. PHP-FFMpeg uses these programs through PATH when running tests. This third-party archive is a GPL build and is intended only for the local development and test environment.

## 安装依赖
## Install dependencies

```sh
docker compose run --rm php composer install
```

`vendor/` 和 Composer 下载缓存保存在 Docker 命名卷中，不需要在宿主机安装 PHP 或 Composer。
`vendor/` and the Composer download cache are stored in Docker named volumes, so PHP and Composer do not need to be installed on the host.

## 运行测试
## Run tests

```sh
docker compose run --rm php vendor/bin/phpunit
```

该命令运行 PHPUnit 配置中的全部测试，包括需要 FFmpeg 的功能测试。
This command runs all tests configured in PHPUnit, including functional tests that require FFmpeg.

## 进入容器
## Open a container shell

```sh
docker compose run --rm php bash
```

容器挂载当前仓库目录为 `/workspace`，可在容器中运行 PHP、Composer、FFmpeg 和 FFprobe 命令。
The container mounts the current repository at `/workspace`; PHP, Composer, FFmpeg, and FFprobe commands can be run inside it.

## 切换 PHP 版本
## Switch PHP versions

首次构建或更换版本时，可通过 `PHP_VERSION` 指定官方 PHP CLI 镜像版本：
Set `PHP_VERSION` to choose an official PHP CLI image version when building for the first time or switching versions:

```sh
PHP_VERSION=8.4 docker compose build --no-cache
PHP_VERSION=8.4 docker compose run --rm php composer install
```

项目支持的 PHP 版本范围以 `composer.json` 为准；指定版本必须有对应的 `php:<版本>-cli-bookworm` 镜像。
The PHP versions supported by the project are listed in `composer.json`; the selected version must have a matching `php:<version>-cli-bookworm` image.

## 清理 Docker 环境
## Clean up the Docker environment

如需删除容器和本项目的命名卷（包括已安装的 `vendor/` 和 Composer 缓存），执行：
To remove the containers and this project's named volumes, including installed `vendor/` dependencies and the Composer cache, run:

```sh
docker compose down --volumes
```
