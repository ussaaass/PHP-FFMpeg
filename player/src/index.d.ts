export const PlaybackProfile: Readonly<{
  CTR_HMAC_V2: 'phpffmpeg-ctr-hmac-v2';
}>;

export const RequestPurpose: Readonly<{
  KEY: 'key';
  HLS: 'hls';
  SEGMENT: 'segment';
}>;

export const HttpCredentials: Readonly<{
  OMIT: 'omit';
  SAME_ORIGIN: 'same-origin';
  INCLUDE: 'include';
}>;

export const KeyRequestTimeout: Readonly<{
  DEFAULT_MILLISECONDS: 10000;
  MAXIMUM_MILLISECONDS: 120000;
}>;

export const PlayerErrorCode: Readonly<{
  KEY_FETCH_FAILED: 'PLAYER_KEY_FETCH_FAILED';
  KEY_TIMEOUT: 'PLAYER_KEY_TIMEOUT';
  KEY_FORMAT_INVALID: 'PLAYER_KEY_FORMAT_INVALID';
  PLAYBACK_INFO_INVALID: 'PLAYER_PLAYBACK_INFO_INVALID';
  PLAYBACK_CANCELLED: 'PLAYER_PLAYBACK_CANCELLED';
}>;

export type PlaybackProfileValue = typeof PlaybackProfile[keyof typeof PlaybackProfile];
export type RequestPurposeValue = typeof RequestPurpose[keyof typeof RequestPurpose];

export interface PlaybackInfo {
  profile: PlaybackProfileValue;
  /** Canonical unsigned 64-bit decimal string. */
  assetId: string;
  keyId: number;
  keyUri: string;
  masterPlaylistUri: string;
  versionId: string;
}

export interface PlayerRequestContext {
  url: string;
  purpose: RequestPurposeValue;
  context?: unknown;
  signal?: AbortSignal;
}

export interface PlayerLevel {
  index: number;
  width: number;
  height: number;
  bitrate: number;
  videoCodec?: string;
  audioCodec?: string;
}

export interface PlaybackMetrics {
  startedAt: number;
  levelSwitches: number;
  automaticLevelSwitches: number;
  manualLevelSwitches: number;
  rebufferCount: number;
  rebufferMilliseconds: number;
  bufferedSegments: number;
  fatalErrors: number;
  completed: boolean;
  elapsedMilliseconds: number;
}

export interface HlsCtrPlayerOptions {
  requestOptions?: (context: PlayerRequestContext) => RequestInit | undefined;
  hlsConfig?: Record<string, unknown>;
  allowInsecureHttp?: boolean;
  keyRequestTimeoutMilliseconds?: number;
  onError?: (error: { source: string; code?: string; type?: string; details?: string; codec?: string; error?: string; fatal?: boolean }) => void;
  onEvent?: (event: Record<string, unknown>) => void;
}

export class HlsCtrPlayerError extends Error {
  code: string;
}

export function validatePlaybackInfo(value: unknown, options?: { allowInsecureHttp?: boolean }): PlaybackInfo;

export class HlsCtrPlayer {
  constructor(video: HTMLMediaElement, options?: HlsCtrPlayerOptions);
  static isSupported(): boolean;
  /** Fetches the Key exactly once before requesting the master playlist. */
  load(playbackInfo: PlaybackInfo): Promise<PlaybackInfo>;
  play(): Promise<void>;
  pause(): void;
  getLevels(): PlayerLevel[];
  setLevel(level: number): void;
  seek(seconds: number): void;
  getMetrics(): PlaybackMetrics;
  destroy(): void;
}
