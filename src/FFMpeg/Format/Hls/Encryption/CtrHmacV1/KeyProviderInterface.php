<?php

namespace FFMpeg\Format\Hls\Encryption\CtrHmacV1;

/**
 * Resolves encryption key material from an application-owned secret source.
 */
interface KeyProviderInterface
{
    public function getKeyMaterial(KeyRequest $request): KeyMaterial;
}
