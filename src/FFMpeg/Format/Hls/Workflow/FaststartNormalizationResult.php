<?php

namespace FFMpeg\Format\Hls\Workflow;

/** Secret-free, path-free summary of source MP4 faststart handling. */
final class FaststartNormalizationResult
{
    private $path;
    private $summary;

    public function __construct(string $path, array $summary)
    {
        $this->path = $path;
        $this->summary = $summary;
    }

    public function path(): string { return $this->path; }
    public function summary(): array { return $this->summary; }
}
