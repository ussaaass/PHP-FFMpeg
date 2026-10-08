<?php

require dirname(__DIR__, 2) . '/vendor/autoload.php';

use FFMpeg\Format\Hls\Workflow\FaststartNormalizer;
use FFMpeg\Format\Hls\Workflow\Mp4BoxInspector;

$source = $argv[1] ?? null;
$staging = $argv[2] ?? null;
if (!is_string($source) || !is_string($staging)) {
    fwrite(STDERR, "Usage: php verify-faststart.php <source.mp4> <staging-directory>\n");
    exit(2);
}
if (!is_dir($staging) && !mkdir($staging, 0700, true) && !is_dir($staging)) {
    throw new RuntimeException('Unable to create the faststart test staging directory.');
}

$before = hash_file('sha256', $source);
$inspectionBefore = (new Mp4BoxInspector())->inspect($source);
if ($inspectionBefore['faststart']) {
    throw new RuntimeException('Fixture unexpectedly has faststart ordering.');
}

$normalized = (new FaststartNormalizer())->normalize($source, $staging);
$after = hash_file('sha256', $source);
$inspectionAfter = (new Mp4BoxInspector())->inspect($normalized);
if ($normalized === realpath($source) || !$inspectionAfter['faststart'] || !hash_equals($before, $after)) {
    throw new RuntimeException('Faststart normalization failed verification or changed the source.');
}

echo json_encode([
    'sourceFaststart' => $inspectionBefore['faststart'],
    'normalizedFaststart' => $inspectionAfter['faststart'],
    'sourceSha256Before' => $before,
    'sourceSha256After' => $after,
    'normalizedPath' => $normalized,
], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . PHP_EOL;
