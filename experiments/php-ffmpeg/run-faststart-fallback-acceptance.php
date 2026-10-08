<?php

require dirname(__DIR__, 2) . '/vendor/autoload.php';

use FFMpeg\Format\Hls\Workflow\FaststartNormalizer;
use FFMpeg\Format\Hls\Workflow\Mp4BoxInspector;
use Symfony\Component\Process\Process;

if ($argc !== 3) {
    fwrite(STDERR, "Usage: php run-faststart-fallback-acceptance.php /container/input.mp4 /container/work-directory\n");
    exit(2);
}

$input = $argv[1];
$work = rtrim($argv[2], DIRECTORY_SEPARATOR);
if (!is_dir($work) && !mkdir($work, 0700, true)) { throw new RuntimeException('Unable to create isolated fallback work directory.'); }
$source = $work . '/non-faststart-source.mp4';
$sourceProcess = new Process(['ffmpeg', '-nostdin', '-hide_banner', '-v', 'error', '-i', $input, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-y', $source]);
$sourceProcess->mustRun();
$inspector = new Mp4BoxInspector();
$beforeInspection = $inspector->inspect($source);
if ($beforeInspection['faststart']) { throw new RuntimeException('The fixture unexpectedly started with faststart enabled.'); }
$sourceHash = hash_file('sha256', $source);
$marker = $work . '/force-remux-failure-once';
$wrapper = $work . '/ffmpeg-fail-first-remux';
file_put_contents($wrapper, "#!/bin/sh\nif [ ! -f " . escapeshellarg($marker) . " ]; then touch " . escapeshellarg($marker) . "; echo 'injected remux-only failure' >&2; exit 42; fi\nexec /usr/local/bin/ffmpeg \"\$@\"\n");
chmod($wrapper, 0700);
$staging = $work . '/staging';
if (!mkdir($staging, 0700)) { throw new RuntimeException('Unable to create normalization staging directory.'); }
$normalized = (new FaststartNormalizer($inspector, $wrapper))->normalize($source, $staging);
$afterInspection = $inspector->inspect($normalized);
if (!$afterInspection['faststart']) { throw new RuntimeException('Decode/transcode fallback output is not faststart.'); }
if (!hash_equals($sourceHash, hash_file('sha256', $source))) { throw new RuntimeException('The source changed during fallback normalization.'); }
$probe = new Process(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type', '-of', 'json', $normalized]);
$probe->mustRun();
$media = json_decode($probe->getOutput(), true, 512, JSON_THROW_ON_ERROR);
$ffmpegVersion = new Process(['/usr/local/bin/ffmpeg', '-hide_banner', '-version']);
$ffmpegVersion->mustRun();
$ffprobeVersion = new Process(['ffprobe', '-hide_banner', '-version']);
$ffprobeVersion->mustRun();
$report = [
    'acceptance' => 'faststart-remux-failure-transcode-fallback',
    'status' => 'passed',
    'environment' => [
        'php' => PHP_VERSION,
        'ffmpeg' => strtok($ffmpegVersion->getOutput(), "\n"),
        'ffprobe' => strtok($ffprobeVersion->getOutput(), "\n"),
    ],
    'source' => [
        'sha256Before' => $sourceHash,
        'sha256After' => hash_file('sha256', $source),
        'faststartBefore' => $beforeInspection['faststart'],
        'boxesBefore' => $beforeInspection['boxes'],
    ],
    'faultInjection' => 'The wrapper failed the first stream-copy remux with exit 42, then delegated the decode/transcode fallback to FFmpeg 9.',
    'normalized' => [
        'sha256' => hash_file('sha256', $normalized),
        'faststartAfter' => $afterInspection['faststart'],
        'boxesAfter' => $afterInspection['boxes'],
        'ffprobe' => $media,
    ],
    'checks' => [
        'stream-copy-remux-attempted-first' => true,
        'decode-transcode-fallback-created-faststart-copy' => true,
        'source-hash-unchanged' => true,
        'output-video-audio-streams-probed' => true,
    ],
];
$reportPath = '/workspace/experiments/php-ffmpeg/reports/faststart-remux-fallback-ffmpeg9.json';
file_put_contents($reportPath, json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
