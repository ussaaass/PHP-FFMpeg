<?php

namespace FFMpeg\Format\Hls\Workflow\Value;

final class FindingSeverity
{
    private $value;
    private function __construct(string $value) { $this->value = $value; }
    public static function error(): self { return new self('error'); }
    public static function warning(): self { return new self('warning'); }
    public static function info(): self { return new self('info'); }
    public function value(): string { return $this->value; }
}
