<?php

namespace FFMpeg\Format\Hls\Workflow;

/** Inspects top-level ISO BMFF boxes without loading media payloads into memory. */
final class Mp4BoxInspector
{
    /**
     * A file is faststart when a complete moov box precedes the first mdat box.
     * @return array{faststart: bool, boxes: array<int, string>}
     */
    public function inspect(string $path): array
    {
        $handle = @fopen($path, 'rb');
        if ($handle === false) {
            throw new \RuntimeException(sprintf('Unable to open MP4 input "%s".', $path));
        }
        try {
            $stat = fstat($handle);
            if (!is_array($stat) || !isset($stat['size']) || $stat['size'] < 8) {
                throw new \UnexpectedValueException('MP4 input is too small to contain a valid top-level box.');
            }
            $length = (int) $stat['size'];
            $offset = 0;
            $boxes = [];
            $moovOffset = null;
            $mdatOffset = null;
            while ($offset < $length) {
                if ($length - $offset < 8 || fseek($handle, $offset) !== 0) {
                    throw new \UnexpectedValueException('Truncated or unreadable MP4 box header.');
                }
                $header = fread($handle, 8);
                if ($header === false || strlen($header) !== 8) {
                    throw new \UnexpectedValueException('Truncated MP4 box header.');
                }
                $parts = unpack('Nsize/a4type', $header);
                $size = (int) $parts['size'];
                $type = $parts['type'];
                $headerSize = 8;
                if ($size === 1) {
                    $extended = fread($handle, 8);
                    if ($extended === false || strlen($extended) !== 8) {
                        throw new \UnexpectedValueException('Truncated extended MP4 box header.');
                    }
                    $words = unpack('Nhigh/Nlow', $extended);
                    if ($words['high'] > 0x7fffffff) {
                        throw new \UnexpectedValueException('MP4 box size exceeds the platform integer range.');
                    }
                    $size = $words['high'] * 4294967296 + $words['low'];
                    $headerSize = 16;
                } elseif ($size === 0) {
                    $size = $length - $offset;
                }
                if ($size < $headerSize || $size > $length - $offset) {
                    throw new \UnexpectedValueException(sprintf('Invalid or out-of-bounds MP4 box "%s".', $type));
                }
                $boxes[] = $type;
                if ($type === 'moov' && $moovOffset === null) { $moovOffset = $offset; }
                if ($type === 'mdat' && $mdatOffset === null) { $mdatOffset = $offset; }
                $offset += (int) $size;
            }
            if ($offset !== $length || $moovOffset === null || $mdatOffset === null) {
                throw new \UnexpectedValueException('MP4 must contain complete top-level moov and mdat boxes.');
            }
            return ['faststart' => $moovOffset < $mdatOffset, 'boxes' => $boxes];
        } finally {
            fclose($handle);
        }
    }
}
