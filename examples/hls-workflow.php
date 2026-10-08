<?php

require dirname(__DIR__) . '/vendor/autoload.php';

use FFMpeg\Format\Hls\Workflow\HlsOutput;
use FFMpeg\Format\Hls\Workflow\AudioGain;
use FFMpeg\Format\Hls\Workflow\Rendition;
use FFMpeg\Format\Hls\Workflow\WorkflowPlan;
use FFMpeg\Format\Hls\Workflow\WorkflowRunner;
use FFMpeg\Format\Hls\Workflow\Value\ContainerPath;
use FFMpeg\Format\Hls\Workflow\Value\InputId;
use FFMpeg\Format\Hls\Workflow\Value\RenditionId;

if ($argc !== 3) {
    fwrite(STDERR, "Usage: php examples/hls-workflow.php /container/input.mp4 /container/output/video-version\n");
    exit(2);
}

$outputPath = ContainerPath::from($argv[2]);
$parent = dirname($outputPath->value());
if (!is_dir($parent) && !mkdir($parent, 0770, true) && !is_dir($parent)) {
    throw new RuntimeException('Unable to create output parent directory.');
}

$output = HlsOutput::create($outputPath)
    ->rendition(Rendition::create(RenditionId::named('360p'), 640, 360, 800000))
    ->rendition(Rendition::create(RenditionId::named('480p'), 854, 480, 1400000))
    ->rendition(Rendition::create(RenditionId::named('720p'), 1280, 720, 2800000));
$plan = WorkflowPlan::create()
    ->input(InputId::named('video'), ContainerPath::from($argv[1]))
    ->step(AudioGain::decibels(-3))
    ->output($output);

$runner = new WorkflowRunner();
$verification = $runner->verify($plan);
foreach ($verification->findings() as $finding) {
    fwrite(STDERR, sprintf("%s [%s] %s\n", $finding->severity()->value(), $finding->code(), $finding->message()));
}
if ($verification->hasBlockingErrors()) {
    exit(1);
}

$result = $runner->execute($plan);
echo json_encode([
    'directory' => $result->directory(),
    'masterPlaylist' => $result->masterPlaylist(),
    'toolVersions' => $result->toolVersions(),
    'artifacts' => $result->artifacts(),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
