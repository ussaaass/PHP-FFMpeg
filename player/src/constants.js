export const PlaybackProfile = Object.freeze({
  CTR_HMAC_V2: 'phpffmpeg-ctr-hmac-v2',
});

export const RequestPurpose = Object.freeze({
  KEY: 'key',
  HLS: 'hls',
  SEGMENT: 'segment',
});

export const HttpCredentials = Object.freeze({
  OMIT: 'omit',
  SAME_ORIGIN: 'same-origin',
  INCLUDE: 'include',
});

export const KeyRequestTimeout = Object.freeze({
  DEFAULT_MILLISECONDS: 10000,
  MAXIMUM_MILLISECONDS: 120000,
});

export const PlayerErrorCode = Object.freeze({
  KEY_FETCH_FAILED: 'PLAYER_KEY_FETCH_FAILED',
  KEY_TIMEOUT: 'PLAYER_KEY_TIMEOUT',
  KEY_FORMAT_INVALID: 'PLAYER_KEY_FORMAT_INVALID',
  PLAYBACK_INFO_INVALID: 'PLAYER_PLAYBACK_INFO_INVALID',
  PLAYBACK_CANCELLED: 'PLAYER_PLAYBACK_CANCELLED',
});
