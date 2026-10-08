<?php

namespace FFMpeg\Format\Hls\Encryption\CtrHmacV1;

/**
 * Non-secret context used by an application-owned key provider.
 */
final class KeyRequest
{
    /** @var string */
    private $outputId;

    /** @var string */
    private $renditionId;

    /** @var int */
    private $segmentSequence;

    /** @var string */
    private $contentId;

    public function __construct(string $outputId, string $renditionId, int $segmentSequence, string $contentId)
    {
        if ($outputId === '' || $renditionId === '' || $segmentSequence < 0) {
            throw new \InvalidArgumentException('The key request must identify an output, rendition, and non-negative segment sequence.');
        }

        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $contentId)) {
            throw new \InvalidArgumentException('The content ID must be a lowercase canonical UUID.');
        }

        $this->outputId = $outputId;
        $this->renditionId = $renditionId;
        $this->segmentSequence = $segmentSequence;
        $this->contentId = $contentId;
    }

    public function getOutputId(): string
    {
        return $this->outputId;
    }

    public function getRenditionId(): string
    {
        return $this->renditionId;
    }

    public function getSegmentSequence(): int
    {
        return $this->segmentSequence;
    }

    public function getContentId(): string
    {
        return $this->contentId;
    }
}
