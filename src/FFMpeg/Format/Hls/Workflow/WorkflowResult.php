<?php

namespace FFMpeg\Format\Hls\Workflow;

final class WorkflowResult
{
    private $directory;
    private $masterPlaylist;
    private $descriptor;
    private $toolVersions;
    private $verification;
    private $artifacts;
    private $keyIds;
    private $currentVersionPointer;
    private $versionId;
    private $commandSummary;
    public function __construct(string $directory, string $masterPlaylist, ?string $descriptor, array $toolVersions, VerificationReport $verification, array $artifacts = [], array $keyIds = [], ?string $currentVersionPointer = null, ?string $versionId = null, array $commandSummary = [])
    {
        $this->directory = $directory;
        $this->masterPlaylist = $masterPlaylist;
        $this->descriptor = $descriptor;
        $this->toolVersions = $toolVersions;
        $this->verification = $verification;
        $this->artifacts = $artifacts;
        $this->keyIds = array_values(array_unique($keyIds));
        $this->currentVersionPointer = $currentVersionPointer;
        $this->versionId = $versionId;
        $this->commandSummary = $commandSummary;
    }
    public function directory(): string { return $this->directory; }
    public function masterPlaylist(): string { return $this->masterPlaylist; }
    public function descriptor(): ?string { return $this->descriptor; }
    public function toolVersions(): array { return $this->toolVersions; }
    public function verification(): VerificationReport { return $this->verification; }
    public function artifacts(): array { return $this->artifacts; }
    public function keyIds(): array { return $this->keyIds; }
    public function currentVersionPointer(): ?string { return $this->currentVersionPointer; }
    public function versionId(): ?string { return $this->versionId; }
    /** Structured execution summary; deliberately excludes raw arguments, paths, and key material. */
    public function commandSummary(): array { return $this->commandSummary; }
}
