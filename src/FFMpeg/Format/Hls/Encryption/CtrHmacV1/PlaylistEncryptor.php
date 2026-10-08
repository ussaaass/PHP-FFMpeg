<?php

namespace FFMpeg\Format\Hls\Encryption\CtrHmacV1;

use FFMpeg\Format\Hls\Workflow\AtomicVersionedPublisher;

/**
 * Applies CTR/HMAC encryption to local fMP4 media playlists after FFmpeg has
 * completed the clear HLS package.
 */
final class PlaylistEncryptor
{
    /** @var KeyProviderInterface */
    private $keyProvider;

    /** @var KeyUriResolverInterface */
    private $keyUriResolver;

    /** @var Encryptor */
    private $encryptor;

    public function __construct(KeyProviderInterface $keyProvider, KeyUriResolverInterface $keyUriResolver, ?Encryptor $encryptor = null)
    {
        $this->keyProvider = $keyProvider;
        $this->keyUriResolver = $keyUriResolver;
        $this->encryptor = $encryptor ?: new Encryptor();
    }

    public function encryptMasterPlaylist(string $masterPlaylistPath, string $outputDirectory, string $outputId): EncryptionResult
    {
        $masterPlaylistPath = realpath($masterPlaylistPath) ?: '';
        if ($masterPlaylistPath === '' || !is_file($masterPlaylistPath)) {
            throw new \InvalidArgumentException('The master playlist must be an existing local file.');
        }
        if ($outputId === '' || preg_match('/[\r\n]/', $outputId)) {
            throw new \InvalidArgumentException('The output ID must be non-empty and single-line.');
        }

        $sourceRoot = dirname($masterPlaylistPath);
        $outputParent = realpath(dirname($outputDirectory));
        if ($outputParent === false || !is_dir($outputParent)) {
            throw new \InvalidArgumentException('The output parent directory must already exist.');
        }
        $outputDirectory = rtrim($outputParent, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . basename($outputDirectory);
        if (file_exists($outputDirectory)) {
            throw new \InvalidArgumentException('The encrypted output directory must not already exist.');
        }
        if ($outputDirectory === $sourceRoot || strpos($outputDirectory . DIRECTORY_SEPARATOR, $sourceRoot . DIRECTORY_SEPARATOR) === 0) {
            throw new \InvalidArgumentException('The encrypted output directory must be outside the clear HLS source directory.');
        }

        $masterRelative = basename($masterPlaylistPath);
        $masterLines = $this->readPlaylist($masterPlaylistPath);
        $variantPlaylists = $this->extractVideoPlaylists($masterLines);
        if ($variantPlaylists === []) {
            throw new \InvalidArgumentException('The master playlist does not reference any video media playlists.');
        }

        $stagingDirectory = $outputDirectory . '.staging-' . bin2hex(random_bytes(8));
        if (!mkdir($stagingDirectory, 0700, true)) {
            throw new \RuntimeException('Unable to create the encrypted HLS staging directory.');
        }

        $publishedSegments = [];
        $assetKeyIdentity = null;
        try {
            $this->writeFile($stagingDirectory . DIRECTORY_SEPARATOR . $masterRelative, implode("\n", $masterLines) . "\n");
            foreach ($variantPlaylists as $renditionId => $playlistUri) {
                $playlistRelative = $this->normalizeLocalUri($playlistUri);
                $sourcePlaylist = $this->resolveSourceFile($sourceRoot, $playlistRelative);
                $mediaLines = $this->readPlaylist($sourcePlaylist);
                $rewritten = $this->encryptMediaPlaylist(
                    $mediaLines,
                    dirname($playlistRelative),
                    $sourceRoot,
                    $stagingDirectory,
                    (string) $renditionId,
                    $outputId,
                    $assetKeyIdentity,
                    $publishedSegments
                );
                $this->writeFile($stagingDirectory . DIRECTORY_SEPARATOR . $playlistRelative, implode("\n", $rewritten) . "\n");
            }

            $descriptor = [
                'version' => 1,
                'profile' => Encryptor::PROFILE,
                'masterPlaylistUri' => $masterRelative,
                'keyProvider' => 'application',
                'segmentCount' => count($publishedSegments),
            ];
            $descriptorRelative = 'playback.json';
            $this->writeFile(
                $stagingDirectory . DIRECTORY_SEPARATOR . $descriptorRelative,
                json_encode($descriptor, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n"
            );

            if (!rename($stagingDirectory, $outputDirectory)) {
                throw new \RuntimeException('Unable to atomically publish the encrypted HLS directory.');
            }
        } catch (\Throwable $error) {
            $this->removeTree($stagingDirectory);
            throw $error;
        }

        return new EncryptionResult(
            $outputDirectory,
            $outputDirectory . DIRECTORY_SEPARATOR . $masterRelative,
            $outputDirectory . DIRECTORY_SEPARATOR . $descriptorRelative,
            $publishedSegments
        );
    }

    public function encryptMasterPlaylistVersioned(string $masterPlaylistPath, string $outputRoot, string $outputId, ?AtomicVersionedPublisher $publisher = null): EncryptionResult
    {
        $package = null;
        $publisher = $publisher ?: new AtomicVersionedPublisher();
        $publication = $publisher->publish(
            $outputRoot,
            function (string $stagingDirectory) use ($masterPlaylistPath, $outputId, &$package): void {
                $package = $this->encryptMasterPlaylist($masterPlaylistPath, $stagingDirectory . DIRECTORY_SEPARATOR . 'package', $outputId);
            },
            function (string $stagingDirectory) use (&$package): void {
                if (!$package instanceof EncryptionResult) {
                    throw new \UnexpectedValueException('The version staging directory has no encryption result.');
                }
                $packageDirectory = $stagingDirectory . DIRECTORY_SEPARATOR . 'package';
                $descriptorPath = $packageDirectory . DIRECTORY_SEPARATOR . 'playback.json';
                $masterPath = $packageDirectory . DIRECTORY_SEPARATOR . basename($package->getMasterPlaylist());
                if (!is_file($descriptorPath) || !is_file($masterPath)) {
                    throw new \UnexpectedValueException('The staged HLS version is missing its playback descriptor or master playlist.');
                }
                $descriptor = json_decode((string) file_get_contents($descriptorPath), true, 512, JSON_THROW_ON_ERROR);
                if (!is_array($descriptor) || ($descriptor['segmentCount'] ?? null) !== count($package->getSegments())) {
                    throw new \UnexpectedValueException('The staged HLS descriptor does not match its encrypted segment count.');
                }
                foreach ($package->getSegments() as $segment) {
                    $mediaPath = $packageDirectory . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $segment['segmentUri']);
                    $sidecarPath = $mediaPath . '.json';
                    if (!is_file($mediaPath) || !is_file($sidecarPath)) {
                        throw new \UnexpectedValueException('The staged HLS version is missing an encrypted segment or sidecar.');
                    }
                    $sidecar = json_decode((string) file_get_contents($sidecarPath), true, 512, JSON_THROW_ON_ERROR);
                    if (!is_array($sidecar) || ($sidecar['cipherBytes'] ?? null) !== filesize($mediaPath)) {
                        throw new \UnexpectedValueException('A staged encrypted segment does not match its sidecar byte count.');
                    }
                }
            }
        );

        $packageDirectory = $publication['directory'] . DIRECTORY_SEPARATOR . 'package';
        return new EncryptionResult(
            $packageDirectory,
            $packageDirectory . DIRECTORY_SEPARATOR . basename($package->getMasterPlaylist()),
            $packageDirectory . DIRECTORY_SEPARATOR . 'playback.json',
            $package->getSegments(),
            $publication['pointer'],
            $publication['versionId']
        );
    }

    /**
     * @param string[] $masterLines
     * @return array<string, string>
     */
    private function extractVideoPlaylists(array $masterLines): array
    {
        $playlists = [];
        $nextIsPlaylist = false;
        $renditionIndex = 0;
        foreach ($masterLines as $line) {
            if (strpos($line, '#EXT-X-MEDIA:') === 0 && preg_match('/(?:^|,)TYPE=(AUDIO|SUBTITLES)(?:,|$)/', substr($line, strlen('#EXT-X-MEDIA:')), $matches)) {
                throw new \InvalidArgumentException(sprintf('The first CTR/HMAC delivery is video-only; %s renditions are not supported.', strtolower($matches[1])));
            }
            if (strpos($line, '#EXT-X-MEDIA:') === 0 && preg_match('/(?:^|,)URI="/', substr($line, strlen('#EXT-X-MEDIA:')))) {
                throw new \InvalidArgumentException('URI-bearing EXT-X-MEDIA groups are not supported by the first CTR/HMAC delivery.');
            }
            if (strpos($line, '#') === 0 && preg_match('/(?:^|,)URI="/', $line) && strpos($line, '#EXT-X-MEDIA:') !== 0) {
                throw new \InvalidArgumentException('The first CTR/HMAC delivery does not support auxiliary URI-bearing master-playlist tags.');
            }
            if (strpos($line, '#EXT-X-STREAM-INF:') === 0) {
                $nextIsPlaylist = true;
                continue;
            }
            if ($nextIsPlaylist && $line !== '' && $line[0] !== '#') {
                $playlists['rendition-' . $renditionIndex] = $line;
                ++$renditionIndex;
                $nextIsPlaylist = false;
            }
        }

        return $playlists;
    }

    /**
     * @param string[] $lines
     * @param array<int, array<string, mixed>> $publishedSegments
     * @param array{keyId: string, keyFingerprint: string, keyUri: string}|null $assetKeyIdentity
     * @return string[]
     */
    private function encryptMediaPlaylist(
        array $lines,
        string $playlistDirectory,
        string $sourceRoot,
        string $stagingDirectory,
        string $renditionId,
        string $outputId,
        ?array &$assetKeyIdentity,
        array &$publishedSegments
    ): array {
        $rewritten = [];
        $sequence = 0;
        $endListSeen = false;
        foreach ($lines as $line) {
            if (strpos($line, '#EXT-X-BYTERANGE:') === 0) {
                throw new \InvalidArgumentException('Byte-range source playlists are not supported by CTR/HMAC packaging.');
            }
            if (strpos($line, '#EXT-X-KEY:') === 0) {
                if ($line !== '#EXT-X-KEY:METHOD=NONE') {
                    throw new \InvalidArgumentException('The source media playlist must not already declare encryption.');
                }
                continue;
            }
            if (strpos($line, '#') === 0 && strpos($line, '#EXT-X-MAP:') !== 0 && preg_match('/(?:^|,)URI="/', $line)) {
                throw new \InvalidArgumentException('Unsupported URI-bearing media-playlist tags cannot be copied into encrypted output.');
            }
            if (strpos($line, '#EXT-X-MAP:') === 0) {
                $line = $this->copyMapUri($line, $playlistDirectory, $sourceRoot, $stagingDirectory);
                $rewritten[] = $line;
                continue;
            }
            if ($line === '#EXT-X-ENDLIST') {
                $endListSeen = true;
            }
            if ($line === '' || $line[0] === '#') {
                $rewritten[] = $line;
                continue;
            }

            $sourceRelative = $this->joinPlaylistPath($playlistDirectory, $this->normalizeLocalUri($line));
            if (strtolower(pathinfo($sourceRelative, PATHINFO_EXTENSION)) !== 'm4s') {
                throw new \InvalidArgumentException('CTR/HMAC V1 accepts fMP4 .m4s media segments only.');
            }
            $sourceSegment = $this->resolveSourceFile($sourceRoot, $sourceRelative);
            $contentId = $this->uuidV4();
            $request = new KeyRequest($outputId, $renditionId, $sequence, $contentId);
            $keyMaterial = $this->keyProvider->getKeyMaterial($request);
            if (!$keyMaterial instanceof KeyMaterial) {
                throw new \RuntimeException('The key provider did not return valid key material.');
            }
            $keyUri = $this->keyUriResolver->getKeyUri($request, $keyMaterial);
            $this->assertPublicKeyUri($keyUri);
            $identity = [
                'keyId' => $keyMaterial->getKeyId(),
                'keyFingerprint' => hash('sha256', $keyMaterial->getMasterKey()),
                'keyUri' => $keyUri,
            ];
            if ($assetKeyIdentity === null) {
                $assetKeyIdentity = $identity;
            } elseif ($assetKeyIdentity['keyId'] !== $identity['keyId']
                || !hash_equals($assetKeyIdentity['keyFingerprint'], $identity['keyFingerprint'])
                || $assetKeyIdentity['keyUri'] !== $identity['keyUri']) {
                throw new \UnexpectedValueException('The key provider changed keyId, key material, or key URI within one video asset output.');
            }
            $outputRelative = $this->encryptedPath($sourceRelative);
            $outputPath = $stagingDirectory . DIRECTORY_SEPARATOR . $outputRelative;
            if (file_exists($outputPath) || file_exists($outputPath . '.json')) {
                throw new \InvalidArgumentException(sprintf('Encrypted segment path collision at "%s".', $outputRelative));
            }
            $outputParent = dirname($outputPath);
            if (!is_dir($outputParent) && !mkdir($outputParent, 0700, true) && !is_dir($outputParent)) {
                throw new \RuntimeException(sprintf('Unable to create encrypted rendition directory "%s".', $outputParent));
            }
            $sidecar = $this->encryptor->encryptFile(
                $sourceSegment,
                $outputPath,
                $this->relativePlaylistUri($playlistDirectory, $outputRelative),
                $contentId,
                $keyMaterial,
                $keyUri
            );
            $sidecar['mediaFragmentCount'] = $this->countMediaFragments($sourceSegment);
            $sidecarPath = $outputPath . '.json';
            $this->writeFile($sidecarPath, json_encode($sidecar, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");

            $rewritten[] = $this->relativePlaylistUri($playlistDirectory, $outputRelative);
            $publishedSegments[] = [
                'renditionId' => $renditionId,
                'sequence' => $sequence,
                'segmentUri' => $outputRelative,
                'sidecarUri' => $outputRelative . '.json',
                'keyId' => $keyMaterial->getKeyId(),
                'clearSha256' => $sidecar['clearSha256'],
            ];
            ++$sequence;
        }

        if (!$endListSeen || $sequence === 0) {
            throw new \InvalidArgumentException('CTR/HMAC V1 currently requires a non-empty VOD media playlist ending with EXT-X-ENDLIST.');
        }

        return $rewritten;
    }

    private function copyMapUri(string $line, string $playlistDirectory, string $sourceRoot, string $stagingDirectory): string
    {
        if (!preg_match('/(?:^|,)URI="([^"]+)"/', substr($line, strlen('#EXT-X-MAP:')), $matches)) {
            throw new \InvalidArgumentException('The EXT-X-MAP tag must contain a quoted local URI.');
        }
        $mapUri = $this->normalizeLocalUri($matches[1]);
        $sourceRelative = $this->joinPlaylistPath($playlistDirectory, $mapUri);
        $source = $this->resolveSourceFile($sourceRoot, $sourceRelative);
        $destination = $stagingDirectory . DIRECTORY_SEPARATOR . $sourceRelative;
        if (!is_file($destination)) {
            $contents = file_get_contents($source);
            if ($contents === false) {
                throw new \RuntimeException(sprintf('Unable to read initialization segment "%s".', $sourceRelative));
            }
            $this->writeFile($destination, $contents);
        }

        return $line;
    }

    private function countMediaFragments(string $path): int
    {
        $stream = fopen($path, 'rb');
        if ($stream === false) {
            throw new \RuntimeException(sprintf('Unable to inspect fMP4 media segment "%s".', $path));
        }

        $fileSize = filesize($path);
        if ($fileSize === false) {
            fclose($stream);
            throw new \RuntimeException(sprintf('Unable to determine fMP4 media segment size for "%s".', $path));
        }
        $fragmentCount = 0;
        $awaitingMdat = false;
        try {
            while (!feof($stream)) {
                $header = fread($stream, 8);
                if ($header === false) {
                    throw new \RuntimeException('Unable to read an ISO BMFF box header.');
                }
                if ($header === '') {
                    break;
                }
                if (strlen($header) !== 8) {
                    throw new \InvalidArgumentException('An fMP4 media segment ends with a truncated box header.');
                }

                $size = unpack('Nsize', substr($header, 0, 4))['size'];
                $type = substr($header, 4, 4);
                $headerSize = 8;
                if ($size === 1) {
                    $largeSizeBytes = fread($stream, 8);
                    if ($largeSizeBytes === false || strlen($largeSizeBytes) !== 8) {
                        throw new \InvalidArgumentException('An fMP4 media segment has a truncated extended box size.');
                    }
                    $parts = unpack('Nhigh/Nlow', $largeSizeBytes);
                    if ($parts['high'] > 0x7fffffff) {
                        throw new \InvalidArgumentException('An fMP4 box size exceeds the supported platform integer range.');
                    }
                    $size = ($parts['high'] * 4294967296) + $parts['low'];
                    $headerSize = 16;
                } elseif ($size === 0) {
                    throw new \InvalidArgumentException('Open-ended ISO BMFF boxes are not supported in HLS media segments.');
                }
                if ($size < $headerSize) {
                    throw new \InvalidArgumentException('An fMP4 media segment contains an invalid box size.');
                }
                $payloadBytes = $size - $headerSize;
                if ($type === 'moof') {
                    if ($awaitingMdat) {
                        throw new \InvalidArgumentException('An fMP4 media segment contains a moof without a matching mdat.');
                    }
                    $awaitingMdat = true;
                } elseif ($type === 'mdat') {
                    if (!$awaitingMdat) {
                        throw new \InvalidArgumentException('An fMP4 media segment contains an mdat without a preceding moof.');
                    }
                    $awaitingMdat = false;
                    ++$fragmentCount;
                }

                $payloadOffset = ftell($stream);
                if ($payloadOffset === false || $payloadBytes > $fileSize - $payloadOffset) {
                    throw new \InvalidArgumentException('An fMP4 media segment contains a truncated box payload.');
                }
                if ($payloadBytes > 0 && fseek($stream, $payloadBytes, SEEK_CUR) !== 0) {
                    throw new \RuntimeException('Unable to skip an fMP4 box payload.');
                }
            }
        } finally {
            fclose($stream);
        }

        if ($awaitingMdat || $fragmentCount === 0) {
            throw new \InvalidArgumentException('An fMP4 HLS media segment must contain one or more complete moof/mdat pairs.');
        }

        return $fragmentCount;
    }

    private function normalizeLocalUri(string $uri): string
    {
        $uri = rawurldecode(trim($uri));
        if ($uri === '' || strpos($uri, "\0") !== false || strpos($uri, "\n") !== false || strpos($uri, "\r") !== false
            || strpos($uri, '?') !== false || strpos($uri, '#') !== false || strpos($uri, '\\') !== false
            || preg_match('/^[a-z][a-z0-9+.-]*:/i', $uri) || substr($uri, 0, 1) === '/') {
            throw new \InvalidArgumentException('Only relative local HLS URIs without query or fragment are supported.');
        }
        foreach (explode('/', $uri) as $part) {
            if ($part === '' || $part === '.' || $part === '..') {
                throw new \InvalidArgumentException('HLS URIs must not contain empty, dot, or parent path components.');
            }
        }

        return $uri;
    }

    private function joinPlaylistPath(string $playlistDirectory, string $uri): string
    {
        return $playlistDirectory === '.' ? $uri : $playlistDirectory . '/' . $uri;
    }

    private function relativePlaylistUri(string $playlistDirectory, string $assetPath): string
    {
        $prefix = $playlistDirectory === '.' ? '' : $playlistDirectory . '/';
        if (strpos($assetPath, $prefix) !== 0) {
            throw new \RuntimeException('The encrypted segment path is outside its media playlist directory.');
        }

        return substr($assetPath, strlen($prefix));
    }

    private function encryptedPath(string $sourceRelative): string
    {
        $directory = dirname($sourceRelative);
        $filename = pathinfo($sourceRelative, PATHINFO_FILENAME) . '.enc.m4s';

        return $directory === '.' ? $filename : $directory . '/' . $filename;
    }

    private function assertPublicKeyUri(string $keyUri): void
    {
        if ($keyUri === '' || preg_match('/[\r\n]/', $keyUri)) {
            throw new \InvalidArgumentException('The client key URI must be non-empty and single-line.');
        }
        $parts = parse_url($keyUri);
        if ($parts === false || isset($parts['user']) || isset($parts['pass']) || isset($parts['fragment'])) {
            throw new \InvalidArgumentException('The client key URI must not contain user information or a fragment.');
        }
        if (isset($parts['query'])) {
            parse_str($parts['query'], $query);
            foreach (array_keys($query) as $name) {
                if (preg_match('/(?:token|auth|password|secret|signature|credential|api[_-]?key)/i', (string) $name)) {
                    throw new \InvalidArgumentException('Authentication secrets must be sent in request headers, not in a client key URI.');
                }
            }
        }
    }

    private function resolveSourceFile(string $sourceRoot, string $relativePath): string
    {
        $path = realpath($sourceRoot . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath));
        if ($path === false || !is_file($path) || strpos($path, rtrim($sourceRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR) !== 0) {
            throw new \InvalidArgumentException(sprintf('HLS asset "%s" is missing or escapes the source directory.', $relativePath));
        }

        return $path;
    }

    /** @return string[] */
    private function readPlaylist(string $path): array
    {
        $contents = file_get_contents($path);
        if ($contents === false) {
            throw new \RuntimeException(sprintf('Unable to read HLS playlist "%s".', $path));
        }
        $lines = preg_split('/\r\n|\n|\r/', $contents);
        $lines = array_map('trim', $lines === false ? [] : $lines);
        if (($lines[0] ?? null) !== '#EXTM3U') {
            throw new \InvalidArgumentException(sprintf('File "%s" is not an HLS playlist.', $path));
        }

        return $lines;
    }

    private function writeFile(string $path, string $contents): void
    {
        $directory = dirname($path);
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new \RuntimeException(sprintf('Unable to create output directory "%s".', $directory));
        }
        if (file_put_contents($path, $contents, LOCK_EX) === false) {
            throw new \RuntimeException(sprintf('Unable to write output file "%s".', $path));
        }
    }

    private function uuidV4(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);

        return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
    }

    private function removeTree(string $path): void
    {
        if (!is_dir($path) || is_link($path)) {
            if (file_exists($path) || is_link($path)) {
                unlink($path);
            }

            return;
        }
        foreach (scandir($path) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $this->removeTree($path . DIRECTORY_SEPARATOR . $entry);
        }
        rmdir($path);
    }
}
