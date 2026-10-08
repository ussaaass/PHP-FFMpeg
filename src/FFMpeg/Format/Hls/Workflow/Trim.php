<?php

namespace FFMpeg\Format\Hls\Workflow;

final class Trim implements WorkflowStepInterface
{
    private $start;
    private $end;
    private function __construct(Timecode $start, Timecode $end)
    {
        if ($end->value() <= $start->value()) { throw new \InvalidArgumentException('Trim end must be greater than trim start.'); }
        $this->start = $start;
        $this->end = $end;
    }
    public static function between(Timecode $start, Timecode $end): self { return new self($start, $end); }
    public function videoFilter(): ?string { return null; }
    public function audioFilter(): ?string { return null; }
    public function trim(): ?array { return ['start' => $this->start->value(), 'duration' => $this->end->value() - $this->start->value()]; }
}
