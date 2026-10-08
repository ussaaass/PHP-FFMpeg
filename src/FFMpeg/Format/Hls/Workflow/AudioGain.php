<?php

namespace FFMpeg\Format\Hls\Workflow;

/** Applies a bounded gain to the embedded source audio before rendition encoding. */
final class AudioGain implements WorkflowStepInterface
{
    private $decibels;

    private function __construct(float $decibels)
    {
        if (!is_finite($decibels) || $decibels < -60.0 || $decibels > 24.0) {
            throw new \InvalidArgumentException('Audio gain must be between -60 and 24 dB.');
        }
        $this->decibels = $decibels;
    }

    public static function decibels(float $decibels): self { return new self($decibels); }
    public function videoFilter(): ?string { return null; }
    public function audioFilter(): ?string { return 'volume=' . rtrim(rtrim(number_format($this->decibels, 3, '.', ''), '0'), '.') . 'dB'; }
    public function trim(): ?array { return null; }
}
