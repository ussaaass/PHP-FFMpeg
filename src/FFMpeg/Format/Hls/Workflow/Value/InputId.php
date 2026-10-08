<?php

namespace FFMpeg\Format\Hls\Workflow\Value;

final class InputId extends NamedIdentifier
{
    public static function named(string $value): self { return new self($value); }
}
