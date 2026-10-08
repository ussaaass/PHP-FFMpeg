<?php

namespace FFMpeg\Format\Hls\Encryption\CtrHmacV1;

/**
 * Describes the published encrypted HLS output without exposing secret data.
 */
final class EncryptionResult
{
    /** @var string */
    private $outputDirectory;

    /** @var string */
    private $masterPlaylist;

    /** @var string */
    private $playbackDescriptor;

    /** @var array<int, array<string, mixed>> */
    private $segments;
    /** @var string|null */
    private $currentVersionPointer;
    /** @var string|null */
    private $versionId;

    /**
     * @param array<int, array<string, mixed>> $segments
     */
    public function __construct(string $outputDirectory, string $masterPlaylist, string $playbackDescriptor, array $segments, ?string $currentVersionPointer = null, ?string $versionId = null)
    {
        $this->outputDirectory = $outputDirectory;
        $this->masterPlaylist = $masterPlaylist;
        $this->playbackDescriptor = $playbackDescriptor;
        $this->segments = $segments;
        $this->currentVersionPointer = $currentVersionPointer;
        $this->versionId = $versionId;
    }

    public function getOutputDirectory(): string
    {
        return $this->outputDirectory;
    }

    public function getMasterPlaylist(): string
    {
        return $this->masterPlaylist;
    }

    public function getPlaybackDescriptor(): string
    {
        return $this->playbackDescriptor;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function getSegments(): array
    {
        return $this->segments;
    }

    public function getCurrentVersionPointer(): ?string
    {
        return $this->currentVersionPointer;
    }

    public function getVersionId(): ?string
    {
        return $this->versionId;
    }
}
