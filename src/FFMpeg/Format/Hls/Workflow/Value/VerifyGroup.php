<?php

namespace FFMpeg\Format\Hls\Workflow\Value;

final class VerifyGroup
{
    private $value;
    private function __construct(string $value) { $this->value = $value; }
    public static function inputsAndStreams(): self { return new self('inputs-and-streams'); }
    public static function targetProfile(): self { return new self('target-profile'); }
    public static function encryption(): self { return new self('encryption'); }
    public static function pathsAndNames(): self { return new self('paths-and-names'); }
    public function value(): string { return $this->value; }
}
