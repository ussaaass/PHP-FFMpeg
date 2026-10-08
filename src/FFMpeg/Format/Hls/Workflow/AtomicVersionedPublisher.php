<?php

namespace FFMpeg\Format\Hls\Workflow;

/** Publishes a complete immutable directory before atomically replacing its current pointer. */
class AtomicVersionedPublisher
{
    /**
     * @return array{versionId: string, directory: string, pointer: string}
     */
    public function publish(string $outputRoot, callable $build, callable $validate): array
    {
        $outputRoot = rtrim($outputRoot, DIRECTORY_SEPARATOR);
        if ($outputRoot === '' || preg_match('/[\r\n]/', $outputRoot)) {
            throw new \InvalidArgumentException('The versioned output root must be a non-empty single-line path.');
        }
        if (!is_dir($outputRoot) && !mkdir($outputRoot, 0700, true) && !is_dir($outputRoot)) {
            throw new \RuntimeException('Unable to create the versioned output root.');
        }

        $versionsDirectory = $outputRoot . DIRECTORY_SEPARATOR . 'versions';
        if (!is_dir($versionsDirectory) && !mkdir($versionsDirectory, 0700, true) && !is_dir($versionsDirectory)) {
            throw new \RuntimeException('Unable to create the immutable version directory.');
        }

        $versionId = gmdate('Ymd\THis\Z') . '-' . bin2hex(random_bytes(8));
        $stagingDirectory = $versionsDirectory . DIRECTORY_SEPARATOR . '.staging-' . bin2hex(random_bytes(8));
        $publishedDirectory = $versionsDirectory . DIRECTORY_SEPARATOR . $versionId;
        $pointerPath = $outputRoot . DIRECTORY_SEPARATOR . 'current.json';
        $pointerTemp = $pointerPath . '.tmp-' . bin2hex(random_bytes(8));
        if (!mkdir($stagingDirectory, 0700, true)) {
            throw new \RuntimeException('Unable to create the version staging directory.');
        }

        $versionPublished = false;
        try {
            $build($stagingDirectory);
            $validate($stagingDirectory);
            if (!rename($stagingDirectory, $publishedDirectory)) {
                throw new \RuntimeException('Unable to publish the validated immutable version directory.');
            }
            $versionPublished = true;

            $pointer = [
                'version' => $versionId,
                'directory' => 'versions/' . $versionId,
            ];
            $this->writePointer($pointerTemp, json_encode($pointer, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
            $this->commitPointer($pointerTemp, $pointerPath);

            return ['versionId' => $versionId, 'directory' => $publishedDirectory, 'pointer' => $pointerPath];
        } catch (\Throwable $error) {
            if (is_dir($stagingDirectory)) { $this->removeTree($stagingDirectory); }
            if (is_file($pointerTemp)) { @unlink($pointerTemp); }
            if ($versionPublished && is_dir($publishedDirectory)) { $this->removeTree($publishedDirectory); }
            throw $error;
        }
    }

    /** @internal Kept overridable so tests can inject an atomic-commit failure. */
    protected function commitPointer(string $temporaryPath, string $pointerPath): void
    {
        if (!rename($temporaryPath, $pointerPath)) {
            throw new \RuntimeException('Unable to atomically update the current-version pointer.');
        }
    }

    private function writePointer(string $path, string $contents): void
    {
        $stream = fopen($path, 'xb');
        if ($stream === false) { throw new \RuntimeException('Unable to create the temporary current-version pointer.'); }
        try {
            $written = 0;
            $length = strlen($contents);
            while ($written < $length) {
                $count = fwrite($stream, substr($contents, $written));
                if ($count === false || $count === 0) { throw new \RuntimeException('Unable to write the temporary current-version pointer.'); }
                $written += $count;
            }
            if (!fflush($stream)) { throw new \RuntimeException('Unable to flush the temporary current-version pointer.'); }
        } finally {
            fclose($stream);
        }
    }

    private function removeTree(string $directory): void
    {
        foreach (scandir($directory) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') { continue; }
            $path = $directory . DIRECTORY_SEPARATOR . $entry;
            if (is_dir($path) && !is_link($path)) { $this->removeTree($path); }
            else { @unlink($path); }
        }
        @rmdir($directory);
    }
}
