<?php

require dirname(__DIR__, 2) . '/vendor/autoload.php';

use FFMpeg\Format\Hls\Workflow\AudioGain;
use FFMpeg\Format\Hls\Workflow\Crop;
use FFMpeg\Format\Hls\Workflow\HlsOutput;
use FFMpeg\Format\Hls\Workflow\Rendition;
use FFMpeg\Format\Hls\Workflow\Rotation;
use FFMpeg\Format\Hls\Workflow\Timecode;
use FFMpeg\Format\Hls\Workflow\Transpose;
use FFMpeg\Format\Hls\Workflow\Trim;
use FFMpeg\Format\Hls\Workflow\WorkflowPlan;
use FFMpeg\Format\Hls\Workflow\WorkflowRunner;
use FFMpeg\Format\Hls\Workflow\Value\ContainerPath;
use FFMpeg\Format\Hls\Workflow\Value\InputId;
use FFMpeg\Format\Hls\Workflow\Value\RenditionId;
use Symfony\Component\Process\Process;

if ($argc !== 3) {
    fwrite(STDERR, "Usage: php run-t4-transform-acceptance.php /container/input.mp4 /container/output-directory\n");
    exit(2);
}

$input = $argv[1];
$outputDirectory = $argv[2];
$output = HlsOutput::create(ContainerPath::from($outputDirectory))
    ->rendition(Rendition::create(RenditionId::named('portrait'), 360, 640, 500000));
$plan = WorkflowPlan::create()
    ->input(InputId::named('video'), ContainerPath::from($input))
    ->step(Trim::between(Timecode::seconds(0), Timecode::seconds(3)))
    ->step(Crop::centered(320, 180))
    ->step(Transpose::using(Rotation::clockwise()))
    ->step(AudioGain::decibels(6))
    ->output($output);
$result = (new WorkflowRunner())->execute($plan);
$renditionPlaylist = glob($outputDirectory . '/v*/index.m3u8')[0] ?? null;
if ($renditionPlaylist === null) { throw new RuntimeException('T4 output has no rendition media playlist.'); }
$probe = new Process([
    'ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,sample_rate',
    '-of', 'json', $renditionPlaylist,
]);
$probe->mustRun();
$media = json_decode($probe->getOutput(), true, 512, JSON_THROW_ON_ERROR);
$video = null;
$audio = null;
foreach ($media['streams'] as $stream) {
    if (($stream['codec_type'] ?? null) === 'video') { $video = $stream; }
    if (($stream['codec_type'] ?? null) === 'audio') { $audio = $stream; }
}
if ($video === null || $video['width'] !== 360 || $video['height'] !== 640 || $audio === null) {
    throw new RuntimeException('T4 output probe did not find expected 360x640 video and audio streams.');
}
$duration = (float) $media['format']['duration'];
if ($duration < 2.8 || $duration > 3.2) { throw new RuntimeException('T4 output duration is outside the expected 3-second trim.'); }
$segments = glob(dirname($renditionPlaylist) . '/segment_*.m4s') ?: [];
if (count($segments) < 1) { throw new RuntimeException('T4 did not produce fMP4 media segments.'); }
$version = new Process(['ffmpeg', '-hide_banner', '-version']);
$version->mustRun();
$ffmpegLine = strtok($version->getOutput(), "\n");
$ffmpegFamily = strpos($ffmpegLine, 'n9.') !== false ? 'ffmpeg9' : 'ffmpeg5';
$report = [
    'acceptance' => 'typed-transform-graph-docker-ffmpeg',
    'status' => 'passed',
    'fixture' => [
        'derivedFrom' => '26.mp4',
        'originalSampleSha256' => 'aede768d644abe0d4252181b7186bb531578f84063a142277f0d3fd9d1def289',
        'audio' => 'The original sample has no audio; a synthetic 440 Hz AAC track was muxed in Docker for the AudioGain check.',
    ],
    'sourceSha256' => hash_file('sha256', $input),
    'environment' => ['php' => PHP_VERSION, 'ffmpeg' => $ffmpegLine],
    'ffmpegFamily' => $ffmpegFamily,
    'plan' => ['trimSeconds' => [0, 3], 'crop' => [320, 180], 'transpose' => 'clockwise', 'audioGainDb' => 6, 'rendition' => [360, 640]],
    'output' => ['masterPlaylist' => $result->masterPlaylist(), 'renditionPlaylist' => $renditionPlaylist, 'video' => $video, 'audio' => $audio, 'durationSeconds' => $duration, 'segmentCount' => count($segments), 'ffprobe' => $media],
    'toolVersions' => $result->toolVersions(),
    'commandSummary' => $result->commandSummary(),
    'checks' => ['crop-and-transpose-reflected-in-output-dimensions' => true, 'trim-duration-verified-by-ffprobe' => true, 'audio-stream-present-after-gain-step' => true, 'fmp4-segments-present' => true],
];
$reportPath = '/workspace/experiments/php-ffmpeg/reports/t4-transform-graph-' . $ffmpegFamily . '.json';
file_put_contents($reportPath, json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
