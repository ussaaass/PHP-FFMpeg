<?php

namespace FFMpeg\Format\Hls\Workflow\Value;

final class PlaylistMode
{
    private $value;
    private function __construct(string $value) { $this->value = $value; }
    public static function master(): self { return new self('master'); }
    public static function media(): self { return new self('media'); }
    public function value(): string { return $this->value; }
}
