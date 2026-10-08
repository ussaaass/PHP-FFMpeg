<?php

namespace FFMpeg\Format\Hls\Workflow\Value;

final class SegmentContainer
{
    private $value;
    private function __construct(string $value) { $this->value = $value; }
    public static function mpegTs(): self { return new self('mpegts'); }
    public static function fmp4(): self { return new self('fmp4'); }
    public function value(): string { return $this->value; }
}
