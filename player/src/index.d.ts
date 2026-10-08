export const PlaybackProfile: Readonly<{
  CTR_HMAC_V1: 'phpffmpeg-ctr-hmac-v1';
}>;

export const KeyProviderKind: Readonly<{
  APPLICATION: 'application';
}>;

export const RequestPurpose: Readonly<{
  DESCRIPTOR: 'descriptor';
  HLS: 'hls';
  SEGMENT: 'segment';
  SIDECAR: 'sidecar';
}>;

export const HttpCredentials: Readonly<{
  OMIT: 'omit';
  SAME_ORIGIN: 'same-origin';
  INCLUDE: 'include';
}>;

export const KeyProviderTimeout: Readonly<{
  DEFAULT_MILLISECONDS: 10000;
  MAXIMUM_MILLISECONDS: 120000;
}>;

export type PlaybackProfileValue = typeof PlaybackProfile[keyof typeof PlaybackProfile];
export type KeyProviderKindValue = typeof KeyProviderKind[keyof typeof KeyProviderKind];
export type RequestPurposeValue = typeof RequestPurpose[keyof typeof RequestPurpose];
export type KeyId = string & { readonly __keyIdBrand: unique symbol };

export class PlaybackDescriptorUrl {
  private constructor();
  readonly href: string;
  static from(value: string | URL): PlaybackDescriptorUrl;
  toString(): string;
}

export interface PlaybackDescriptor {
  version: 1;
  profile: PlaybackProfileValue;
  masterPlaylistUri: string;
  keyProvider: KeyProviderKindValue;
  segmentCount: number;
}

export interface KeyProviderContext {
  keyId: KeyId;
  keyUri: string;
  contentId: string;
  profile: PlaybackProfileValue;
  signal: AbortSignal;
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
  keyProvider: {
    getMasterKey(context: KeyProviderContext): Promise<Uint8Array | ArrayBuffer> | Uint8Array | ArrayBuffer;
  };
  requestOptions?: (context: PlayerRequestContext) => RequestInit | undefined;
  hlsConfig?: Record<string, unknown>;
  keyProviderTimeoutMilliseconds?: number;
  onError?: (error: { source: string; code?: string; type?: string; details?: string; codec?: string; error?: string; fatal?: boolean }) => void;
  onEvent?: (event: Record<string, unknown>) => void;
}

export class HlsCtrPlayer {
  constructor(video: HTMLMediaElement, options: HlsCtrPlayerOptions);
  static isSupported(): boolean;
  load(descriptorUrl: PlaybackDescriptorUrl): Promise<PlaybackDescriptor>;
  play(): Promise<void>;
  pause(): void;
  getLevels(): PlayerLevel[];
  setLevel(level: number): void;
  seek(seconds: number): void;
  getMetrics(): PlaybackMetrics;
  destroy(): void;
}

export class HlsCtrPlayerError extends Error {
  code: string;
}
