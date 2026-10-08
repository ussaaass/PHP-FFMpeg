<?php

namespace FFMpeg\Format\Hls\Workflow;

use FFMpeg\Format\Hls\Workflow\Value\FindingSeverity;

final class Finding
{
    private $code;
    private $severity;
    private $message;
    private $location;
    private $recommendation;

    public function __construct(string $code, FindingSeverity $severity, string $message, string $location = '', string $recommendation = '')
    {
        if (!preg_match('/^[A-Z][A-Z0-9_]{2,63}$/', $code)) {
            throw new \InvalidArgumentException('Finding codes must be stable uppercase identifiers.');
        }
        $this->code = $code;
        $this->severity = $severity;
        $this->message = $message;
        $this->location = $location;
        $this->recommendation = $recommendation;
    }
    public function code(): string { return $this->code; }
    public function severity(): FindingSeverity { return $this->severity; }
    public function message(): string { return $this->message; }
    public function location(): string { return $this->location; }
    public function recommendation(): string { return $this->recommendation; }
}
