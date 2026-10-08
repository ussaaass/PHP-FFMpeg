<?php

namespace FFMpeg\Format\Hls\Workflow;

final class Rotation
{
    private $filter;
    private function __construct(string $filter) { $this->filter = $filter; }
    public static function clockwise(): self { return new self('transpose=1'); }
    public static function counterClockwise(): self { return new self('transpose=2'); }
    public function filter(): string { return $this->filter; }
}
