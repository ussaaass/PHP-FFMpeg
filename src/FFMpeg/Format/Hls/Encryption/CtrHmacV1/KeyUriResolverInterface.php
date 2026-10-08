<?php

namespace FFMpeg\Format\Hls\Encryption\CtrHmacV1;

/**
 * Maps non-secret key request metadata to a client-facing key URI.
 */
interface KeyUriResolverInterface
{
    public function getKeyUri(KeyRequest $request, KeyMaterial $keyMaterial): string;
}
