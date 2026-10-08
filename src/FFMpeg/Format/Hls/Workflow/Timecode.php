<?php

namespace FFMpeg\Format\Hls\Workflow;

final class Timecode
{
    private $seconds;
    private function __construct(float $seconds)
    {
        if (!is_finite($seconds) || $seconds < 0) { throw new \InvalidArgumentException('Timecode seconds must be finite and non-negative.'); }
        $this->seconds = $seconds;
    }
    public static function seconds(float $seconds): self { return new self($seconds); }
    public function value(): float { return $this->seconds; }
}
