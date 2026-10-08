<?php

namespace FFMpeg\Format\Hls\Workflow;

interface WorkflowStepInterface
{
    /** A closed, internally generated FFmpeg filter expression; callers cannot provide arbitrary text. */
    public function videoFilter(): ?string;
    /** A closed, internally generated FFmpeg audio filter; callers cannot provide arbitrary text. */
    public function audioFilter(): ?string;
    /** @return array{start: float, duration: float}|null */
    public function trim(): ?array;
}
