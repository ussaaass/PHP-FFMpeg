<?php

namespace FFMpeg\Format\Hls\Workflow\Value;

final class EncryptionProfile
{
    private $value;
    private function __construct(string $value) { $this->value = $value; }
    public static function none(): self { return new self('none'); }
    public static function ctrHmacV1(): self { return new self('phpffmpeg-ctr-hmac-v1'); }
    public function value(): string { return $this->value; }
}
