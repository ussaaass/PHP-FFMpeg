FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

ARG TARGETARCH
ARG FFMPEG_BUILD_TAG=autobuild-2026-09-28-13-06

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
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

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm audit --omit=dev \
    && mkdir -p public/vendor \
    && cp node_modules/hls.js/dist/hls.mjs public/vendor/hls.mjs
COPY server.mjs crypto-records.mjs ./
COPY public ./public

EXPOSE 8789
CMD ["node", "server.mjs"]
