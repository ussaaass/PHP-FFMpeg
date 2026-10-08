<?php

namespace FFMpeg\Format\Hls\Workflow\Value;

final class KeyId extends NamedIdentifier
{
    public static function named(string $value): self { return new self($value); }
}
