import { PlayerErrorCode } from './constants.js';

export function redactDiagnostic(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/([?&][^=\s&]+)=([^&\s]*)/g, '$1=[REDACTED]');
}

export function classifyHlsError(data) {
  const details = String(data?.details || '');
  const responseText = data?.response?.text || '';
  const loaderCode = responseText.match(/\b(PLAYER_[A-Z0-9_]+):/)?.[1];
  if (loaderCode) {
    if (loaderCode.startsWith('PLAYER_SEGMENT_') || loaderCode === PlayerErrorCode.RECORD_AUTH_FAILED || loaderCode === PlayerErrorCode.MP4_INVALID) {
      return { source: 'segment', code: loaderCode };
    }
    return { source: 'hls', code: loaderCode };
  }
  if (/^(manifest|levelLoad)/i.test(details)) return { source: 'playlist', code: PlayerErrorCode.PLAYLIST_LOAD_FAILED };
  if (/^(bufferAppend|bufferAddCodec)/i.test(details)) return { source: 'mse', code: PlayerErrorCode.MSE_APPEND_FAILED };
  return { source: 'hls' };
}
