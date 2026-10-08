<?php

namespace FFMpeg\Format\Hls\Workflow;

final class Crop implements WorkflowStepInterface
{
    private $width;
    private $height;
    private function __construct(int $width, int $height)
    {
        if ($width < 2 || $height < 2 || $width % 2 !== 0 || $height % 2 !== 0) {
            throw new \InvalidArgumentException('Crop dimensions must be positive even numbers.');
        }
        $this->width = $width;
        $this->height = $height;
    }
    public static function centered(int $width, int $height): self { return new self($width, $height); }
    public function videoFilter(): ?string { return 'crop=' . $this->width . ':' . $this->height; }
    public function audioFilter(): ?string { return null; }
    public function trim(): ?array { return null; }
}
