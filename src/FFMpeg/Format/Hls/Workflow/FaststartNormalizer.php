<?php

namespace FFMpeg\Format\Hls\Workflow;

use Symfony\Component\Process\Process;

/** Normalizes finite MP4/MOV inputs in a caller-provided task staging directory. */
final class FaststartNormalizer
{
    /** @var Mp4BoxInspector */
    private $inspector;
    /** @var string */
    private $ffmpegBinary;

    public function __construct(?Mp4BoxInspector $inspector = null, string $ffmpegBinary = 'ffmpeg')
    {
        $this->inspector = $inspector ?: new Mp4BoxInspector();
        $this->ffmpegBinary = $ffmpegBinary;
    }

    /** Returns the source path if already faststart, otherwise writes a verified copy into staging. */
    public function normalize(string $sourcePath, string $stagingDirectory): string
    {
        return $this->normalizeWithReport($sourcePath, $stagingDirectory)->path();
    }

    public function normalizeWithReport(string $sourcePath, string $stagingDirectory): FaststartNormalizationResult
    {
        $source = realpath($sourcePath);
        if ($source === false || !is_file($source)) {
            throw new \InvalidArgumentException('The source must be an existing local MP4/MOV file.');
        }
        $before = hash_file('sha256', $source);
        if ($before === false) {
            throw new \RuntimeException('Unable to hash the source media before normalization.');
        }
        $inspection = $this->inspector->inspect($source);
        if ($inspection['faststart']) {
            return new FaststartNormalizationResult($source, [
                'method' => 'already-faststart',
                'sourceFaststart' => true,
                'outputFaststart' => true,
                'sourceUnchanged' => true,
                'remuxFallbackUsed' => false,
            ]);
        }
        if (!is_dir($stagingDirectory) || !is_writable($stagingDirectory)) {
            throw new \InvalidArgumentException('The normalization staging directory must exist and be writable.');
        }
        $target = rtrim($stagingDirectory, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'faststart-' . bin2hex(random_bytes(8)) . '.' . strtolower(pathinfo($source, PATHINFO_EXTENSION));
        $process = new Process([$this->ffmpegBinary, '-nostdin', '-v', 'error', '-i', $source, '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-y', $target]);
        $process->run();
        $remuxFailure = $process->isSuccessful()
            ? null
            : sprintf('stream-copy remux failed (exit %d): %s', $process->getExitCode(), trim($process->getErrorOutput()));
        if ($remuxFailure === null) {
            try {
                if (!$this->inspector->inspect($target)['faststart']) {
                    $remuxFailure = 'stream-copy remux output failed faststart box-order verification';
                }
            } catch (\Throwable $error) {
                $remuxFailure = 'stream-copy remux output failed MP4 box inspection: ' . $error->getMessage();
            }
        }
        $fallbackUsed = $remuxFailure !== null;
        if ($fallbackUsed) {
            @unlink($target);
            $fallback = new Process([
                $this->ffmpegBinary, '-nostdin', '-v', 'error', '-i', $source,
                '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac',
                '-movflags', '+faststart', '-y', $target,
            ]);
            $fallback->run();
            if (!$fallback->isSuccessful()) {
                @unlink($target);
                throw new \RuntimeException(sprintf(
                    'Faststart normalization failed: %s; decode/transcode fallback failed (exit %d): %s',
                    $remuxFailure,
                    $fallback->getExitCode(),
                    trim($fallback->getErrorOutput())
                ));
            }
        }
        try {
            if (!$this->inspector->inspect($target)['faststart']) {
                throw new \RuntimeException('FFmpeg normalization output failed MP4 faststart box-order verification.');
            }
            $after = hash_file('sha256', $source);
            if ($after === false || !hash_equals($before, $after)) {
                throw new \RuntimeException('Source media changed during faststart normalization.');
            }
            return new FaststartNormalizationResult($target, [
                'method' => $fallbackUsed ? 'decode-transcode-h264-aac' : 'stream-copy-remux',
                'sourceFaststart' => false,
                'outputFaststart' => true,
                'sourceUnchanged' => true,
                'remuxFallbackUsed' => $fallbackUsed,
                'remuxOutcome' => $fallbackUsed ? 'failed-output-rejected' : 'passed',
                'fallbackOutcome' => $fallbackUsed ? 'passed' : 'not-needed',
            ]);
        } catch (\Throwable $error) {
            @unlink($target);
            throw $error;
        }
    }
}
