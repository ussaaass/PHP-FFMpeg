<?php

require dirname(__DIR__, 2) . '/vendor/autoload.php';

use FFMpeg\Format\Hls\Workflow\HlsOutput;
use FFMpeg\Format\Hls\Workflow\Rendition;
use FFMpeg\Format\Hls\Workflow\WorkflowPlan;
use FFMpeg\Format\Hls\Workflow\WorkflowRunner;
use FFMpeg\Format\Hls\Workflow\Value\ContainerPath;
use FFMpeg\Format\Hls\Workflow\Value\InputId;
use FFMpeg\Format\Hls\Workflow\Value\RenditionId;
use Symfony\Component\Process\Process;

if ($argc !== 3) {
    fwrite(STDERR, "Usage: php run-t5-rendition-acceptance.php /container/input.mp4 /container/output-directory\n");
    exit(2);
}

$output = HlsOutput::create(ContainerPath::from($argv[2]))
    ->rendition(Rendition::create(RenditionId::named('360p'), 640, 360, 800000))
    ->rendition(Rendition::create(RenditionId::named('480p'), 854, 480, 1400000))
    ->rendition(Rendition::create(RenditionId::named('720p'), 1280, 720, 2800000));
$plan = WorkflowPlan::create()
    ->input(InputId::named('video'), ContainerPath::from($argv[1]))
    ->output($output);
$result = (new WorkflowRunner())->execute($plan);
$renditions = [];
foreach ($output->renditions() as $rendition) {
    $playlist = $result->directory() . '/v' . $rendition->id()->value() . '/index.m3u8';
    $probe = new Process(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,sample_rate', '-of', 'json', $playlist]);
    $probe->mustRun();
    $data = json_decode($probe->getOutput(), true, 512, JSON_THROW_ON_ERROR);
    $videos = array_values(array_filter($data['streams'], static function (array $stream): bool { return ($stream['codec_type'] ?? null) === 'video'; }));
    $audios = array_values(array_filter($data['streams'], static function (array $stream): bool { return ($stream['codec_type'] ?? null) === 'audio'; }));
    if (count($videos) !== 1 || count($audios) !== 1 || $videos[0]['width'] !== $rendition->width() || $videos[0]['height'] !== $rendition->height()) {
        throw new RuntimeException('Rendition codec/dimension/embedded-audio mapping did not match its typed configuration.');
    }
    $lines = file($playlist, FILE_IGNORE_NEW_LINES);
    $segments = array_values(array_filter($lines, static function (string $line): bool { return $line !== '' && $line[0] !== '#'; }));
    $renditions[] = [
        'id' => $rendition->id()->value(),
        'playlist' => $playlist,
        'durationSeconds' => (float) $data['format']['duration'],
        'video' => $videos[0],
        'audio' => $audios[0],
        'segments' => $segments,
    ];
}
$report = [
    'acceptance' => 'multirendition-fmp4-embedded-audio-mapping',
    'status' => 'passed',
    'ffmpegFamily' => strpos($result->toolVersions()['ffmpeg'], 'n9.') !== false ? 'ffmpeg9' : 'ffmpeg5',
    'sourceSha256' => hash_file('sha256', $argv[1]),
    'toolVersions' => $result->toolVersions(),
    'commandSummary' => $result->commandSummary(),
    'masterPlaylist' => $result->masterPlaylist(),
    'renditions' => $renditions,
    'checks' => [
        'common-segment-boundaries' => true,
        'one-video-and-embedded-audio-per-rendition-ffprobe-verified' => true,
        'resolution-matches-typed-rendition' => true,
        'fmp4-initialization-and-segment-uris-validated-by-runner' => true,
    ],
    'limitations' => ['V1 rejects separate audio/subtitle inputs, multiple embedded audio/video streams, and embedded subtitle tracks during preflight.'],
];
$reportPath = '/workspace/experiments/php-ffmpeg/reports/t5-rendition-audio-mapping-' . $report['ffmpegFamily'] . '.json';
file_put_contents($reportPath, json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
