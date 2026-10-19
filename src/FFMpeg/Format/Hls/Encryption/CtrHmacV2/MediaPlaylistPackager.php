<?php

namespace FFMpeg\Format\Hls\Encryption\CtrHmacV2;

/** Packages one completed local fMP4 VOD media playlist without sidecars. */
final class MediaPlaylistPackager
{
    private $encryptor;

    public function __construct(?Encryptor $encryptor = null)
    {
        $this->encryptor = $encryptor ?: new Encryptor();
    }

    /**
     * @return array{playlist:string,objects:array<int,string>}
     */
    public function package(string $sourcePlaylist, string $outputRoot, string $versionId, int $shortEdgePixels, KeyMaterial $keyMaterial): array
    {
        $sourcePlaylist = realpath($sourcePlaylist) ?: '';
        if ($sourcePlaylist === '' || !is_file($sourcePlaylist)) throw new \InvalidArgumentException('The source media playlist must be an existing local file.');
        if ($versionId === '' || !preg_match('/^[A-Za-z0-9._-]+$/', $versionId) || $versionId === '.' || $versionId === '..') throw new \InvalidArgumentException('versionId must be a safe single path component.');
        if ($shortEdgePixels < 1 || $shortEdgePixels > 65535) throw new \InvalidArgumentException('shortEdgePixels must be between 1 and 65535.');
        if (file_exists($outputRoot)) throw new \InvalidArgumentException('The package output root must not already exist.');
        $parent = realpath(dirname($outputRoot));
        if ($parent === false || !is_dir($parent)) throw new \InvalidArgumentException('The output parent directory must already exist.');
        $finalOutputRoot = $parent . DIRECTORY_SEPARATOR . basename($outputRoot);
        $outputRoot = $finalOutputRoot . '.staging-' . bin2hex(random_bytes(8));
        if (!mkdir($outputRoot, 0700)) throw new \RuntimeException('Unable to create a staging package directory.');
        try {
        $sourceRoot = dirname($sourcePlaylist);
        $lines = file($sourcePlaylist, FILE_IGNORE_NEW_LINES);
        if ($lines === false || $lines === [] || trim($lines[0]) !== '#EXTM3U') throw new \UnexpectedValueException('Invalid HLS media playlist.');

        $mediaSequence = 0;
        $hasEndList = false;
        $hasExtInf = false;
        $segmentSequence = null;
        $rewritten = [];
        $objects = [];
        $assetHex = self::assetIdHex($keyMaterial->getAssetId());
        $prefix = 'media/' . $assetHex . '/' . $keyMaterial->getKeyId() . '/' . $shortEdgePixels . '/' . $versionId . '/';

        foreach ($lines as $line) {
            $trimmed = trim($line);
            if (preg_match('/^#EXT-X-MEDIA-SEQUENCE:(\d+)$/', $trimmed, $matches)) {
                $mediaSequence = (int) $matches[1];
                $segmentSequence = $mediaSequence;
            }
            if ($trimmed === '#EXT-X-ENDLIST') $hasEndList = true;
            if (strpos($trimmed, '#EXTINF:') === 0) $hasExtInf = true;

            if (strpos($trimmed, '#EXT-X-MAP:') === 0) {
                $mapUri = self::attribute($trimmed, 'URI');
                $mapSource = self::resolveLocal($sourceRoot, $mapUri);
                $mapRelative = self::relativeUri($sourceRoot, $mapSource);
                $mapTarget = $outputRoot . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $mapRelative);
                self::copyExclusive($mapSource, $mapTarget);
                $line = preg_replace('/URI="[^"]*"/', 'URI="' . addcslashes($mapRelative, "\\\"") . '"', $line, 1);
            } elseif ($trimmed !== '' && $trimmed[0] !== '#') {
                if ($segmentSequence === null) $segmentSequence = 0;
                if (!$hasExtInf) throw new \UnexpectedValueException('Each media object URI must follow an EXTINF line.');
                if ($segmentSequence > 65535) throw new \OutOfRangeException('The rendition has more than 65536 media segments.');
                $source = self::resolveLocal($sourceRoot, $trimmed);
                $name = substr(md5($keyMaterial->getAssetId() . '-' . $shortEdgePixels . '-' . $segmentSequence), 0, 3) . '-' . str_pad((string) $segmentSequence, 5, '0', STR_PAD_LEFT) . '.m4s';
                $relative = $prefix . $name;
                $target = $outputRoot . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
                if (!is_dir(dirname($target)) && !mkdir(dirname($target), 0700, true) && !is_dir(dirname($target))) throw new \RuntimeException('Unable to create encrypted object directory.');
                $input = fopen($source, 'rb');
                $destination = @fopen($target, 'xb');
                if ($input === false || $destination === false) {
                    if (is_resource($input)) fclose($input);
                    if (is_resource($destination)) fclose($destination);
                    throw new \RuntimeException('Unable to open a source segment or create its encrypted output.');
                }
                try {
                    $this->encryptor->encryptStream($input, $destination, $keyMaterial, $shortEdgePixels, $segmentSequence);
                } catch (\Throwable $error) {
                    fclose($input);
                    fclose($destination);
                    @unlink($target);
                    throw $error;
                }
                fclose($input);
                fclose($destination);
                $line = '/' . $relative;
                $objects[] = $target;
                ++$segmentSequence;
                $hasExtInf = false;
            }
            $rewritten[] = $line;
        }
        if (!$hasEndList || $hasExtInf || $objects === []) throw new \UnexpectedValueException('Only complete non-empty VOD playlists ending in EXT-X-ENDLIST can be packaged.');

        $playlistRelative = self::relativeUri($sourceRoot, $sourcePlaylist);
        $playlistTarget = $outputRoot . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $playlistRelative);
        self::writeExclusive($playlistTarget, implode("\n", $rewritten) . "\n");
        if (file_exists($finalOutputRoot) || !rename($outputRoot, $finalOutputRoot)) throw new \RuntimeException('Unable to publish the immutable package output.');
        return [
            'playlist' => str_replace($outputRoot, $finalOutputRoot, $playlistTarget),
            'objects' => array_map(static function (string $path) use ($outputRoot, $finalOutputRoot): string { return str_replace($outputRoot, $finalOutputRoot, $path); }, $objects),
        ];
        } catch (\Throwable $error) {
            self::removeDirectory($outputRoot);
            throw $error;
        }
    }

    /**
     * Package all video renditions for one asset with the same KeyMaterial.
     * Each item has `playlist` (source path) and `shortEdgePixels` (integer).
     * The caller can assemble its master playlist from the returned playlist map.
     *
     * @param array<int,array{playlist:string,shortEdgePixels:int}> $renditions
     * @return array{playlists:array<int,string>,objects:array<int,string>}
     */
    public function packageRenditions(array $renditions, string $outputRoot, string $versionId, KeyMaterial $keyMaterial): array
    {
        if ($renditions === []) throw new \InvalidArgumentException('At least one media rendition is required.');
        if (file_exists($outputRoot)) throw new \InvalidArgumentException('The package output root must not already exist.');
        $parent = realpath(dirname($outputRoot));
        if ($parent === false || !is_dir($parent)) throw new \InvalidArgumentException('The output parent directory must already exist.');
        $outputRoot = $parent . DIRECTORY_SEPARATOR . basename($outputRoot);
        $stage = $outputRoot . '.staging-' . bin2hex(random_bytes(8));
        $parts = $stage . '.parts';
        if (!mkdir($stage, 0700) || !mkdir($parts, 0700)) {
            self::removeDirectory($stage);
            throw new \RuntimeException('Unable to create a rendition package staging directory.');
        }
        $playlistPaths = [];
        $objectPaths = [];
        $seenEdges = [];
        try {
            foreach ($renditions as $rendition) {
                if (!isset($rendition['playlist'], $rendition['shortEdgePixels']) || !is_int($rendition['shortEdgePixels'])) throw new \InvalidArgumentException('Each rendition requires a playlist path and integer shortEdgePixels.');
                $edge = $rendition['shortEdgePixels'];
                if (isset($seenEdges[$edge])) throw new \InvalidArgumentException('Each packaged rendition must use a unique short-edge pixel value.');
                $seenEdges[$edge] = true;
                $partRoot = $parts . DIRECTORY_SEPARATOR . (string) $edge;
                mkdir($partRoot, 0700);
                $result = $this->package($rendition['playlist'], $partRoot . DIRECTORY_SEPARATOR . 'package', $versionId, $edge, $keyMaterial);
                $packageRoot = $partRoot . DIRECTORY_SEPARATOR . 'package';
                $this->mergeDirectory($packageRoot . DIRECTORY_SEPARATOR . 'media', $stage . DIRECTORY_SEPARATOR . 'media');
                $renditionRoot = $stage . DIRECTORY_SEPARATOR . 'renditions' . DIRECTORY_SEPARATOR . (string) $edge;
                $this->mergeDirectory($packageRoot, $renditionRoot, ['media']);
                $playlistPaths[$edge] = $outputRoot . DIRECTORY_SEPARATOR . 'renditions' . DIRECTORY_SEPARATOR . (string) $edge . DIRECTORY_SEPARATOR . basename($result['playlist']);
                foreach ($result['objects'] as $object) {
                    $objectPaths[] = $outputRoot . DIRECTORY_SEPARATOR . str_replace($packageRoot . DIRECTORY_SEPARATOR, '', $object);
                }
                self::removeDirectory($partRoot);
            }
            if (file_exists($outputRoot) || !rename($stage, $outputRoot)) throw new \RuntimeException('Unable to publish the immutable rendition package.');
            self::removeDirectory($parts);
            return ['playlists' => $playlistPaths, 'objects' => $objectPaths];
        } catch (\Throwable $error) {
            self::removeDirectory($stage);
            self::removeDirectory($parts);
            throw $error;
        }
    }

    /** Merge a package tree without overwriting any path; `$excluded` excludes top-level names. */
    private function mergeDirectory(string $source, string $destination, array $excluded = []): void
    {
        if (!is_dir($source)) return;
        if (!is_dir($destination) && !mkdir($destination, 0700, true) && !is_dir($destination)) throw new \RuntimeException('Unable to create merged rendition directory.');
        foreach (scandir($source) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..' || in_array($entry, $excluded, true)) continue;
            $sourcePath = $source . DIRECTORY_SEPARATOR . $entry;
            $destinationPath = $destination . DIRECTORY_SEPARATOR . $entry;
            if (is_dir($sourcePath)) {
                $this->mergeDirectory($sourcePath, $destinationPath);
            } else {
                $input = fopen($sourcePath, 'rb');
                if ($input === false) throw new \RuntimeException('Unable to open package artifact for merge.');
                $output = @fopen($destinationPath, 'xb');
                if ($output === false) { fclose($input); throw new \RuntimeException('Refusing to overwrite a merged package artifact.'); }
                $copied = stream_copy_to_stream($input, $output);
                fclose($input);
                fclose($output);
                if ($copied === false) { @unlink($destinationPath); throw new \RuntimeException('Unable to merge package artifact.'); }
            }
        }
    }

    private static function attribute(string $line, string $name): string
    {
        if (!preg_match('/(?:^|,)\s*' . preg_quote($name, '/') . '="([^"]+)"/', substr($line, strpos($line, ':') + 1), $matches)) throw new \UnexpectedValueException('EXT-X-MAP must contain a quoted URI.');
        return $matches[1];
    }

    private static function resolveLocal(string $root, string $uri): string
    {
        if ($uri === '' || strpos($uri, '?') !== false || strpos($uri, '#') !== false || preg_match('/^[a-z][a-z0-9+.-]*:/i', $uri) || strpos($uri, '\\') !== false) throw new \UnexpectedValueException('Only unsigned local playlist URIs are supported by the packager.');
        $path = realpath($root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, rawurldecode($uri)));
        if ($path === false || !is_file($path) || strpos($path, $root . DIRECTORY_SEPARATOR) !== 0) throw new \UnexpectedValueException('A playlist resource is missing or escapes its source directory.');
        return $path;
    }

    private static function relativeUri(string $root, string $path): string
    {
        return str_replace(DIRECTORY_SEPARATOR, '/', substr($path, strlen($root) + 1));
    }

    private static function copyExclusive(string $source, string $target): void
    {
        $bytes = file_get_contents($source);
        if ($bytes === false) throw new \RuntimeException('Unable to read the initialization segment.');
        self::writeExclusive($target, $bytes);
    }

    private static function writeExclusive(string $path, string $bytes): void
    {
        $directory = dirname($path);
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) throw new \RuntimeException('Unable to create package directory.');
        $stream = @fopen($path, 'xb');
        if ($stream === false) throw new \RuntimeException('Refusing to overwrite an existing package object.');
        try {
            $written = 0;
            while ($written < strlen($bytes)) {
                $count = fwrite($stream, substr($bytes, $written));
                if ($count === false || $count === 0) throw new \RuntimeException('Unable to write package output.');
                $written += $count;
            }
        } catch (\Throwable $error) {
            fclose($stream);
            @unlink($path);
            throw $error;
        }
        fclose($stream);
    }

    private static function removeDirectory(string $directory): void
    {
        if (!is_dir($directory)) return;
        foreach (scandir($directory) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            $path = $directory . DIRECTORY_SEPARATOR . $entry;
            if (is_dir($path)) self::removeDirectory($path); else @unlink($path);
        }
        @rmdir($directory);
    }

    private static function assetIdHex(string $assetId): string
    {
        return bin2hex(Encryptor::uint64be($assetId));
    }
}
