import Hls from 'hls.js';
import { V2CtrFragmentLoader } from './v2-fragment-loader.js';
import { KeyRequestTimeout, PlaybackProfile, PlayerErrorCode, RequestPurpose } from './constants.js';
import { startPlaybackSession } from './playback-session.js';
import { HlsCtrPlayerError } from './errors.js';

export class HlsCtrPlayer {
  constructor(video, options = {}) {
    if (!(video instanceof HTMLMediaElement)) throw new TypeError('HlsCtrPlayer requires an HTMLMediaElement');
    const keyRequestTimeoutMilliseconds = options.keyRequestTimeoutMilliseconds ?? KeyRequestTimeout.DEFAULT_MILLISECONDS;
    if (!Number.isInteger(keyRequestTimeoutMilliseconds) || keyRequestTimeoutMilliseconds < 1 || keyRequestTimeoutMilliseconds > KeyRequestTimeout.MAXIMUM_MILLISECONDS) {
      throw new RangeError(`keyRequestTimeoutMilliseconds must be an integer from 1 to ${KeyRequestTimeout.MAXIMUM_MILLISECONDS}`);
    }
    if (!Hls.isSupported()) throw new Error('This browser does not support the Media Source Extensions required by HlsCtrPlayer');

    this.video = video;
    this.options = options;
    this.session = null;
    this.sessionAbortController = null;
    this.unsupportedVideoCodec = null;
    this.metrics = { startedAt: performance.now(), levelSwitches: 0, automaticLevelSwitches: 0, manualLevelSwitches: 0, rebufferCount: 0, rebufferMilliseconds: 0, bufferedSegments: 0, fatalErrors: 0, completed: false };
    this.playbackStarted = false;
    this.rebufferStartedAt = null;
    const requestOptions = options.requestOptions || (() => ({}));
    const thisPlayer = this;
    this.hls = new Hls({
      // Use short VOD EWMA half-lives so bandwidth changes can affect short
      // HLS assets within a few segments; callers may override either value.
      abrEwmaFastVoD: 1,
      abrEwmaSlowVoD: 3,
      abrBandWidthUpFactor: 0.85,
      ...(options.hlsConfig || {}),
      progressive: true,
      fLoader: class extends V2CtrFragmentLoader {
        constructor() {
          const session = thisPlayer.session;
          if (!session) throw new HlsCtrPlayerError(PlayerErrorCode.PLAYBACK_INFO_INVALID, 'Playback information and Key must load before HLS media requests');
          super({ playbackInfo: session.playbackInfo, masterKey: session.masterKey, requestOptions, onSegmentAuthenticated: result => options.onEvent?.({ type: 'segment-authenticated', ...result }) });
        }
      },
      fetchSetup: (context, initParams) => {
        const requestInit = requestOptions({ url: context.url, purpose: RequestPurpose.HLS, context, signal: initParams.signal }) || {};
        if (typeof requestInit.then === 'function') throw new TypeError('requestOptions must return RequestInit synchronously');
        return new Request(context.url, { ...initParams, ...requestInit });
      },
    });
    this.hls.on(Hls.Events.ERROR, (_event, data) => {
      const hlsErrorMessage = data.error?.message || data.response?.text || '';
      if (data.details === Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR) {
        const message = data.error?.message || 'No browser MSE codec is compatible with the declared HLS variants';
        const codec = message.match(/CODECS[^\[]*\["([^\"]+)/)?.[1];
        this.unsupportedVideoCodec = codec || 'unknown';
        this.hls.stopLoad();
        options.onError?.({
          source: 'capability',
          code: 'PLAYER_CODEC_UNSUPPORTED',
          type: 'unsupported-codec',
          details: 'No declared HLS video codec can be added to this browser MSE pipeline',
          codec: this.unsupportedVideoCodec,
          fatal: true,
        });
        return;
      }
      options.onError?.({ source: 'hls', type: data.type, details: data.details, fatal: data.fatal, error: data.error?.message });
      if (data.fatal) this.metrics.fatalErrors += 1;
    });
    this.hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      const unsupported = (data.levels || []).find(level => {
        const codec = level.videoCodec;
        return codec && !MediaSource.isTypeSupported(`video/mp4; codecs="${codec}"`);
      });
      if (unsupported) {
        this.unsupportedVideoCodec = unsupported.videoCodec;
        this.hls.stopLoad();
        options.onError?.({
          source: 'capability',
          code: 'PLAYER_CODEC_UNSUPPORTED',
          type: 'unsupported-codec',
          details: 'This browser cannot create an MSE SourceBuffer for a declared video codec',
          codec: unsupported.videoCodec,
          fatal: true,
        });
      }
    });
    this.hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      const level = this.hls.levels[data.level];
      const automatic = this.hls.autoLevelEnabled;
      this.metrics.levelSwitches += 1;
      if (automatic) this.metrics.automaticLevelSwitches += 1;
      else this.metrics.manualLevelSwitches += 1;
      options.onEvent?.({ type: 'level-switched', level: data.level, width: level?.width, height: level?.height, automatic, atMilliseconds: performance.now() - this.metrics.startedAt });
    });
    this.hls.on(Hls.Events.FRAG_BUFFERED, (_event, data) => {
      const stats = data.frag.stats;
      this.metrics.bufferedSegments += 1;
      options.onEvent?.({
        type: 'segment-buffered',
        level: data.frag.level,
        sequence: data.frag.sn,
        duration: data.frag.duration,
        bytes: stats?.loaded,
        bandwidthEstimate: stats?.bwEstimate,
        loadMilliseconds: stats?.loading?.end && stats?.loading?.start ? stats.loading.end - stats.loading.start : undefined,
        processingMilliseconds: stats?.parsing?.end && stats?.parsing?.start ? stats.parsing.end - stats.parsing.start : undefined,
      });
    });
    this.videoEventHandlers = {
      playing: () => {
        this.playbackStarted = true;
        if (this.rebufferStartedAt !== null) {
          const duration = performance.now() - this.rebufferStartedAt;
          this.metrics.rebufferMilliseconds += duration;
          this.rebufferStartedAt = null;
          options.onEvent?.({ type: 'rebuffer-ended', durationMilliseconds: duration, atMilliseconds: performance.now() - this.metrics.startedAt });
        }
      },
      waiting: () => {
        if (!this.playbackStarted || this.video.ended || this.rebufferStartedAt !== null) return;
        this.rebufferStartedAt = performance.now();
        this.metrics.rebufferCount += 1;
        options.onEvent?.({ type: 'rebuffer-started', atMilliseconds: this.rebufferStartedAt - this.metrics.startedAt });
      },
      ended: () => {
        this.metrics.completed = true;
        options.onEvent?.({ type: 'playback-completed', ...this.getMetrics() });
      },
    };
    for (const [name, handler] of Object.entries(this.videoEventHandlers)) this.video.addEventListener(name, handler);
    this.hls.attachMedia(video);
  }

  static isSupported() {
    return Hls.isSupported();
  }

  async load(playbackInfo) {
    this.sessionAbortController?.abort();
    if (this.session) this.hls.stopLoad();
    this.session?.masterKey.fill(0);
    this.session = null;
    this.sessionAbortController = new AbortController();
    const requestOptions = this.options.requestOptions || (() => ({}));
    const session = await startPlaybackSession(playbackInfo, {
      requestOptions,
      signal: this.sessionAbortController.signal,
      timeoutMilliseconds: this.options.keyRequestTimeoutMilliseconds ?? KeyRequestTimeout.DEFAULT_MILLISECONDS,
      abortKeyRequest: () => this.sessionAbortController?.abort(),
      allowInsecureHttp: this.options.allowInsecureHttp === true,
      onKeyReady: (info, masterKey) => {
        this.session = { playbackInfo: info, masterKey };
        this.masterPlaylistUrl = info.masterPlaylistUri;
        this.hls.loadSource(this.masterPlaylistUrl);
      },
    });
    this.options.onEvent?.({ type: 'playback-key-loaded', profile: PlaybackProfile.CTR_HMAC_V2, assetId: session.playbackInfo.assetId, keyId: session.playbackInfo.keyId });
    return session.playbackInfo;
  }

  play() {
    return this.video.play();
  }

  pause() {
    this.video.pause();
  }

  getLevels() {
    return this.hls.levels.map((level, index) => ({ index, width: level.width, height: level.height, bitrate: level.bitrate, videoCodec: level.videoCodec, audioCodec: level.audioCodec }));
  }

  setLevel(level) {
    if (!Number.isInteger(level) || level < -1 || level >= this.hls.levels.length) throw new RangeError('Invalid hls.js level index');
    this.hls.currentLevel = level;
  }

  getMetrics() {
    const activeRebuffer = this.rebufferStartedAt === null ? 0 : performance.now() - this.rebufferStartedAt;
    return { ...this.metrics, rebufferMilliseconds: this.metrics.rebufferMilliseconds + activeRebuffer, elapsedMilliseconds: performance.now() - this.metrics.startedAt };
  }

  seek(time) {
    if (!Number.isFinite(time) || time < 0) throw new RangeError('Seek time must be a non-negative finite number');
    this.video.currentTime = time;
  }

  destroy() {
    this.sessionAbortController?.abort();
    this.hls.destroy();
    this.session?.masterKey.fill(0);
    this.session = null;
    for (const [name, handler] of Object.entries(this.videoEventHandlers)) this.video.removeEventListener(name, handler);
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
  }
}

export { HlsCtrPlayerError } from './errors.js';
export { HttpCredentials, KeyRequestTimeout, PlaybackProfile, PlayerErrorCode, RequestPurpose } from './constants.js';
export { validatePlaybackInfo } from './playback-info.js';
