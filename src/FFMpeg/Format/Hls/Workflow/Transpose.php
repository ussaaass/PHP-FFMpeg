<?php

namespace FFMpeg\Format\Hls\Workflow;

final class Transpose implements WorkflowStepInterface
{
    private $rotation;
    private function __construct(Rotation $rotation) { $this->rotation = $rotation; }
    public static function using(Rotation $rotation): self { return new self($rotation); }
    public function videoFilter(): ?string { return $this->rotation->filter(); }
    public function audioFilter(): ?string { return null; }
    public function trim(): ?array { return null; }
}
