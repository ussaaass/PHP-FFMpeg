<?php

namespace FFMpeg\Format\Hls\Workflow\Value;

final class ContainerPath
{
    /** @var string */
    private $value;

    private function __construct(string $value)
    {
        if ($value === '' || $value[0] !== '/' || strpos($value, "\0") !== false || preg_match('/[\x01-\x1f\x7f]/', $value)) {
            throw new \InvalidArgumentException('Container paths must be absolute and contain no control characters.');
        }
        foreach (explode('/', $value) as $part) {
            if ($part === '.' || $part === '..') {
                throw new \InvalidArgumentException('Container paths must not contain dot or parent path components.');
            }
        }
        $this->value = $value;
    }

    public static function from(string $value): self { return new self($value); }
    public function value(): string { return $this->value; }
    public function __toString(): string { return $this->value; }
}
