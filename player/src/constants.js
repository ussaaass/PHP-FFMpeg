export const PlaybackProfile = Object.freeze({
  CTR_HMAC_V1: 'phpffmpeg-ctr-hmac-v1',
});

export const KeyProviderKind = Object.freeze({
  APPLICATION: 'application',
});

export const RequestPurpose = Object.freeze({
  DESCRIPTOR: 'descriptor',
  HLS: 'hls',
  SEGMENT: 'segment',
  SIDECAR: 'sidecar',
});

export const HttpCredentials = Object.freeze({
  OMIT: 'omit',
  SAME_ORIGIN: 'same-origin',
  INCLUDE: 'include',
});

export const KeyProviderTimeout = Object.freeze({
  DEFAULT_MILLISECONDS: 10000,
  MAXIMUM_MILLISECONDS: 120000,
});

const descriptorUrlToken = Symbol('PlaybackDescriptorUrl');

export class PlaybackDescriptorUrl {
  constructor(value, token) {
    if (token !== descriptorUrlToken) {
      throw new TypeError('Use PlaybackDescriptorUrl.from() to create a descriptor URL');
    }

    this.href = value;
    Object.freeze(this);
  }

  static from(value) {
    const raw = value instanceof URL ? value.href : value;
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new TypeError('Playback descriptor URL must be a non-empty string or URL');
    }

    let parsed;
    try {
      parsed = new URL(raw, globalThis.location?.href || 'http://localhost/');
    } catch (_error) {
      throw new TypeError('Playback descriptor URL is invalid');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new TypeError('Playback descriptor URL must use HTTP or HTTPS');
    }

    return new PlaybackDescriptorUrl(parsed.href, descriptorUrlToken);
  }

  toString() {
    return this.href;
  }
}
