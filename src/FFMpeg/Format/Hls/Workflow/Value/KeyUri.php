<?php

namespace FFMpeg\Format\Hls\Workflow\Value;

final class KeyUri
{
    /** @var string */
    private $value;

    private function __construct(string $value)
    {
        if ($value === '' || preg_match('/[\r\n\x00]/', $value)) {
            throw new \InvalidArgumentException('A key URI must be non-empty and contain no control characters.');
        }
        $this->value = $value;
    }

    public static function from(string $value): self { return new self($value); }
    public function value(): string { return $this->value; }
    public function __toString(): string { return $this->value; }
}
