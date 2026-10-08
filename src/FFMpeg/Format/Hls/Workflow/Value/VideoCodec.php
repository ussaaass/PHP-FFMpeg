<?php

namespace FFMpeg\Format\Hls\Workflow\Value;

final class VideoCodec
{
    private $value;
    private function __construct(string $value) { $this->value = $value; }
    public static function h264(): self { return new self('h264'); }
    public static function hevc(): self { return new self('hevc'); }
    public function value(): string { return $this->value; }
}
