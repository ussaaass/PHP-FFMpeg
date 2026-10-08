<?php

namespace FFMpeg\Format\Hls\Workflow;

use FFMpeg\Format\Hls\Workflow\Value\RenditionId;

final class Rendition
{
    private $id;
    private $width;
    private $height;
    private $videoBitrate;
    private $audioBitrate;

    private function __construct(RenditionId $id, int $width, int $height, int $videoBitrate, int $audioBitrate)
    {
        if ($width < 2 || $height < 2 || $width % 2 !== 0 || $height % 2 !== 0 || $videoBitrate < 100000 || $audioBitrate < 16000) {
            throw new \InvalidArgumentException('Renditions require even dimensions and positive, realistic bitrates.');
        }
        $this->id = $id;
        $this->width = $width;
        $this->height = $height;
        $this->videoBitrate = $videoBitrate;
        $this->audioBitrate = $audioBitrate;
    }
    public static function create(RenditionId $id, int $width, int $height, int $videoBitrate, int $audioBitrate = 128000): self
    {
        return new self($id, $width, $height, $videoBitrate, $audioBitrate);
    }
    public function id(): RenditionId { return $this->id; }
    public function width(): int { return $this->width; }
    public function height(): int { return $this->height; }
    public function videoBitrate(): int { return $this->videoBitrate; }
    public function audioBitrate(): int { return $this->audioBitrate; }
}
