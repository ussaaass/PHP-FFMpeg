<?php

namespace FFMpeg\Format\Hls\Encryption\CtrHmacV1;

/**
 * Encrypted media bytes and the non-secret metadata required by a player.
 */
final class EncryptedSegment
{
    /** @var string */
    private $encryptedBytes;

    /** @var array<string, mixed> */
    private $sidecar;

    /**
     * @param array<string, mixed> $sidecar
     */
    public function __construct(string $encryptedBytes, array $sidecar)
    {
        $this->encryptedBytes = $encryptedBytes;
        $this->sidecar = $sidecar;
    }

    public function getEncryptedBytes(): string
    {
        return $this->encryptedBytes;
    }

    /**
     * @return array<string, mixed>
     */
    public function getSidecar(): array
    {
        return $this->sidecar;
    }
}
