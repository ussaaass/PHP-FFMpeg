<?php

namespace FFMpeg\Format\Hls\Workflow;

use FFMpeg\Format\Hls\Workflow\Value\ContainerPath;
use FFMpeg\Format\Hls\Workflow\Value\EncryptionProfile;
use FFMpeg\Format\Hls\Workflow\Value\PlaylistMode;
use FFMpeg\Format\Hls\Workflow\Value\PublicationMode;
use FFMpeg\Format\Hls\Workflow\Value\SegmentContainer;
use FFMpeg\Format\Hls\Workflow\Value\VideoCodec;
use FFMpeg\Format\Hls\Workflow\Value\VideoAssetId;

final class HlsOutput
{
    private $directory;
    private $playlistMode;
    private $container;
    private $codec;
    private $encryption;
    private $renditions;
    private $assetId;
    private $publicationMode;
    private function __construct(ContainerPath $directory, PlaylistMode $playlistMode, SegmentContainer $container, VideoCodec $codec, EncryptionProfile $encryption, array $renditions = [], ?VideoAssetId $assetId = null, ?PublicationMode $publicationMode = null)
    {
        $this->directory = $directory;
        $this->playlistMode = $playlistMode;
        $this->container = $container;
        $this->codec = $codec;
        $this->encryption = $encryption;
        $this->renditions = $renditions;
        $this->assetId = $assetId;
        $this->publicationMode = $publicationMode ?: PublicationMode::directory();
    }
    public static function create(ContainerPath $directory): self
    {
        return new self($directory, PlaylistMode::master(), SegmentContainer::fmp4(), VideoCodec::h264(), EncryptionProfile::none(), [], null, PublicationMode::directory());
    }
    public function playlistMode(PlaylistMode $value): self { return new self($this->directory, $value, $this->container, $this->codec, $this->encryption, $this->renditions, $this->assetId, $this->publicationMode); }
    public function segmentContainer(SegmentContainer $value): self { return new self($this->directory, $this->playlistMode, $value, $this->codec, $this->encryption, $this->renditions, $this->assetId, $this->publicationMode); }
    public function codec(VideoCodec $value): self { return new self($this->directory, $this->playlistMode, $this->container, $value, $this->encryption, $this->renditions, $this->assetId, $this->publicationMode); }
    public function encryption(EncryptionProfile $value): self { return new self($this->directory, $this->playlistMode, $this->container, $this->codec, $value, $this->renditions, $this->assetId, $this->publicationMode); }
    public function asset(VideoAssetId $assetId): self { return new self($this->directory, $this->playlistMode, $this->container, $this->codec, $this->encryption, $this->renditions, $assetId, $this->publicationMode); }
    public function publication(PublicationMode $value): self { return new self($this->directory, $this->playlistMode, $this->container, $this->codec, $this->encryption, $this->renditions, $this->assetId, $value); }
    public function rendition(Rendition $rendition): self
    {
        foreach ($this->renditions as $existing) {
            if ($existing->id()->value() === $rendition->id()->value()) {
                throw new \InvalidArgumentException('Rendition IDs must be unique within an output.');
            }
        }
        $renditions = $this->renditions;
        $renditions[] = $rendition;
        return new self($this->directory, $this->playlistMode, $this->container, $this->codec, $this->encryption, $renditions, $this->assetId, $this->publicationMode);
    }
    public function directory(): ContainerPath { return $this->directory; }
    public function mode(): PlaylistMode { return $this->playlistMode; }
    public function container(): SegmentContainer { return $this->container; }
    public function videoCodec(): VideoCodec { return $this->codec; }
    public function encryptionProfile(): EncryptionProfile { return $this->encryption; }
    /** @return Rendition[] */
    public function renditions(): array { return $this->renditions; }
    public function assetId(): ?VideoAssetId { return $this->assetId; }
    public function publicationMode(): PublicationMode { return $this->publicationMode; }
}
