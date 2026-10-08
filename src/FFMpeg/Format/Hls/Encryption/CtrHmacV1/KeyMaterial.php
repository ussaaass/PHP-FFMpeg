<?php

namespace FFMpeg\Format\Hls\Encryption\CtrHmacV1;

/**
 * Secret key material supplied by an application-owned key provider.
 */
final class KeyMaterial
{
    /** @var string */
    private $keyId;

    /** @var string */
    private $masterKey;

    public function __construct(string $keyId, string $masterKey)
    {
        if ($keyId === '' || preg_match('/[\r\n]/', $keyId)) {
            throw new \InvalidArgumentException('The key identifier must be non-empty and single-line.');
        }

        if (strlen($masterKey) !== 32) {
            throw new \InvalidArgumentException('The CTR/HMAC V1 master key must contain exactly 32 bytes.');
        }

        $this->keyId = $keyId;
        $this->masterKey = $masterKey;
    }

    public function getKeyId(): string
    {
        return $this->keyId;
    }

    /**
     * @internal Do not log, serialize, or expose the returned bytes.
     */
    public function getMasterKey(): string
    {
        return $this->masterKey;
    }

    public function __debugInfo(): array
    {
        return ['keyId' => $this->keyId, 'masterKey' => '[redacted]'];
    }

    /**
     * Prevent accidental leakage through PHP serialization and cache backends.
     *
     * @return array<string, mixed>
     */
    public function __serialize(): array
    {
        throw new \LogicException('Secret key material must not be serialized.');
    }
}
