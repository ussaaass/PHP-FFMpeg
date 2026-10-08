<?php

namespace FFMpeg\Format\Hls\Workflow;

final class VerificationReport
{
    /** @var Finding[] */
    private $findings;
    public function __construct(array $findings) { $this->findings = array_values($findings); }
    /** @return Finding[] */
    public function findings(): array { return $this->findings; }
    public function hasBlockingErrors(): bool
    {
        foreach ($this->findings as $finding) {
            if ($finding->severity()->value() === 'error') { return true; }
        }
        return false;
    }
}
