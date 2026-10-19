<?php

namespace FFMpeg\Format\Hls\Encryption\CtrHmacV2;

/** Caller-owned asset key material. */
final class KeyMaterial
{
    private $assetId;
    private $keyId;
    private $masterKey;

    public function __construct(string $assetId, int $keyId, string $masterKey)
    {
        if (!preg_match('/^(0|[1-9][0-9]{0,19})$/', $assetId) || self::compareDecimal($assetId, '18446744073709551615') > 0) {
            throw new \InvalidArgumentException('assetId must be a canonical unsigned 64-bit decimal string.');
        }
        if ($keyId < 0 || $keyId > 1023) {
            throw new \InvalidArgumentException('keyId must be between 0 and 1023.');
        }
        if (strlen($masterKey) !== 32) {
            throw new \InvalidArgumentException('The CTR/HMAC V2 master key must contain exactly 32 bytes.');
        }
        $this->assetId = $assetId;
        $this->keyId = $keyId;
        $this->masterKey = $masterKey;
    }

    public function getAssetId(): string { return $this->assetId; }
    public function getKeyId(): int { return $this->keyId; }
    /** @internal */
    public function getMasterKey(): string { return $this->masterKey; }
    public function __debugInfo(): array { return ['assetId' => $this->assetId, 'keyId' => $this->keyId, 'masterKey' => '[redacted]']; }
    public function __serialize(): array { throw new \LogicException('Secret key material must not be serialized.'); }

    private static function compareDecimal(string $left, string $right): int
    {
        return strlen($left) <=> strlen($right) ?: strcmp($left, $right);
    }
}
