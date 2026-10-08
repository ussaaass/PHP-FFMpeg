<?php

namespace FFMpeg\Format\Hls\Workflow\Value;

/** Selects atomic directory output or immutable versions with an atomic current pointer. */
final class PublicationMode
{
    private $value;

    private function __construct(string $value) { $this->value = $value; }
    public static function directory(): self { return new self('directory'); }
    public static function versioned(): self { return new self('versioned'); }
    public function value(): string { return $this->value; }
}
