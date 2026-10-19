import { KeyRequestTimeout, PlayerErrorCode, RequestPurpose } from './constants.js';
import { HlsCtrPlayerError } from './errors.js';
import { parseKeyResponse, validatePlaybackInfo } from './playback-info.js';

/** Resolve the asset Key before invoking the callback that starts master-playlist loading. */
export async function startPlaybackSession(playbackInfo, {
  requestOptions = () => ({}),
  signal,
  timeoutMilliseconds = KeyRequestTimeout.DEFAULT_MILLISECONDS,
  abortKeyRequest = () => {},
  allowInsecureHttp = false,
  fetchImpl = fetch,
  onKeyReady = () => {},
} = {}) {
  let info;
  try {
    info = validatePlaybackInfo(playbackInfo, { allowInsecureHttp });
  } catch (error) {
    throw new HlsCtrPlayerError(PlayerErrorCode.PLAYBACK_INFO_INVALID, error.message, { cause: error });
  }
  if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > KeyRequestTimeout.MAXIMUM_MILLISECONDS) {
    throw new RangeError(`timeoutMilliseconds must be from 1 to ${KeyRequestTimeout.MAXIMUM_MILLISECONDS}`);
  }
  let timedOut = false;
  let key;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortKeyRequest();
  }, timeoutMilliseconds);
  try {
    const init = requestOptions({ url: info.keyUri, purpose: RequestPurpose.KEY, signal }) || {};
    if (typeof init.then === 'function') throw new TypeError('requestOptions must return RequestInit synchronously');
    const response = await fetchImpl(info.keyUri, { ...init, method: 'GET', signal, cache: 'no-store' });
    if (response.status !== 200) throw new HlsCtrPlayerError(PlayerErrorCode.KEY_FETCH_FAILED, `Key endpoint returned HTTP ${response.status}`);
    try {
      key = parseKeyResponse(response.headers.get('content-type'), new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      throw new HlsCtrPlayerError(PlayerErrorCode.KEY_FORMAT_INVALID, error.message, { cause: error });
    }
    onKeyReady(info, key);
    return { playbackInfo: info, masterKey: key };
  } catch (error) {
    key?.fill(0);
    if (timedOut) throw new HlsCtrPlayerError(PlayerErrorCode.KEY_TIMEOUT, 'Playback Key request timed out', { cause: error });
    if (signal?.aborted) throw new HlsCtrPlayerError(PlayerErrorCode.PLAYBACK_CANCELLED, 'Playback key request was cancelled', { cause: error });
    if (error instanceof HlsCtrPlayerError) throw error;
    throw new HlsCtrPlayerError(PlayerErrorCode.KEY_FETCH_FAILED, 'Unable to obtain the playback Key', { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}
