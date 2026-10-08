ARG PHP_VERSION=8.5
FROM php:${PHP_VERSION}-cli-bookworm AS base

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        unzip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

ENV COMPOSER_CACHE_DIR=/tmp/composer-cache

WORKDIR /workspace

FROM base AS default

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

FROM base AS ffmpeg9

ARG TARGETARCH
ARG FFMPEG_BUILD_TAG=autobuild-2026-09-28-13-06

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && case "${TARGETARCH}" in \
        amd64) ffmpeg_arch=linux64 ;; \
        arm64) ffmpeg_arch=linuxarm64 ;; \
        *) echo "Unsupported Docker architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && archive="ffmpeg-n9.0.2-14-gebafaee10a-${ffmpeg_arch}-gpl-9.0.tar.xz" \
    && curl --fail --location --silent --show-error \
        "https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_BUILD_TAG}/${archive}" \
        --output /tmp/ffmpeg.tar.xz \
    && tar -xJf /tmp/ffmpeg.tar.xz --strip-components=2 -C /usr/local/bin \
        --wildcards '*/bin/ffmpeg' '*/bin/ffprobe' \
    && rm /tmp/ffmpeg.tar.xz \
    && ffmpeg -version | head -n 1 \
    && ffprobe -version | head -n 1
