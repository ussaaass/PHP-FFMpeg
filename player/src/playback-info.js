import { PlaybackProfile } from './constants.js';

const MAX_ASSET_ID = 18446744073709551615n;

export function validatePlaybackInfo(value, { allowInsecureHttp = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('PlaybackInfo must be an object');
  if (value.profile !== PlaybackProfile.CTR_HMAC_V2) throw new TypeError('Unsupported playback profile');
  if (typeof value.assetId !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value.assetId) || BigInt(value.assetId) > MAX_ASSET_ID) {
    throw new TypeError('PlaybackInfo.assetId must be a canonical unsigned 64-bit decimal string');
  }
  if (!Number.isInteger(value.keyId) || value.keyId < 0 || value.keyId > 1023) throw new TypeError('PlaybackInfo.keyId must be an integer from 0 to 1023');
  if (typeof value.versionId !== 'string' || value.versionId.length === 0) throw new TypeError('PlaybackInfo.versionId must be a non-empty string');
  return {
    profile: PlaybackProfile.CTR_HMAC_V2,
    assetId: value.assetId,
    keyId: value.keyId,
    versionId: value.versionId,
    keyUri: absoluteHttpUri(value.keyUri, 'keyUri', allowInsecureHttp),
    masterPlaylistUri: absoluteHttpUri(value.masterPlaylistUri, 'masterPlaylistUri', allowInsecureHttp),
  };
}

export function assetIdToBytes(assetId) {
  const value = BigInt(assetId);
  const bytes = new Uint8Array(8);
  let remaining = value;
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

export function parseKeyResponse(contentType, bytes) {
  const mediaType = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  let key;
  if (mediaType === 'application/octet-stream') {
    key = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes).slice();
  } else if (mediaType === 'application/json') {
    let value;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new TypeError('Key endpoint returned invalid JSON');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.key !== 'string' || !/^[0-9a-f]{64}$/.test(value.key)) {
      throw new TypeError('Key JSON must contain a 64-character lowercase hexadecimal key');
    }
    key = Uint8Array.from(value.key.match(/../g), pair => Number.parseInt(pair, 16));
  } else {
    throw new TypeError('Key endpoint Content-Type must be application/octet-stream or application/json');
  }
  if (key.byteLength !== 32) throw new TypeError('The V2 master key must contain exactly 32 bytes');
  return key;
}

function absoluteHttpUri(value, name, allowInsecureHttp) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`PlaybackInfo.${name} must be an absolute HTTP URI`);
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`PlaybackInfo.${name} must be an absolute HTTP URI`); }
  if (url.protocol !== 'https:' && !(allowInsecureHttp && url.protocol === 'http:')) throw new TypeError(`PlaybackInfo.${name} must use HTTPS`);
  if (url.username || url.password) throw new TypeError(`PlaybackInfo.${name} must not embed credentials`);
  return url.href;
}
