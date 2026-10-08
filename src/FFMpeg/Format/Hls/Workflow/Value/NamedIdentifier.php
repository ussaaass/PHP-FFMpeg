<?php

namespace FFMpeg\Format\Hls\Workflow\Value;

abstract class NamedIdentifier
{
    /** @var string */
    private $value;

    final protected function __construct(string $value)
    {
        if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/', $value)) {
            throw new \InvalidArgumentException('Identifiers must be 1-128 URL-safe characters.');
        }
        $this->value = $value;
    }

    final public function value(): string
    {
        return $this->value;
    }

    final public function __toString(): string
    {
        return $this->value;
    }
}
