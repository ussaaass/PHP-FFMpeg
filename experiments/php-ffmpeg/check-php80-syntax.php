<?php

require dirname(__DIR__, 2) . '/vendor/autoload.php';

$parser = (new PhpParser\ParserFactory())->createForVersion(PhpParser\PhpVersion::fromString('8.0'));
$roots = [
    'src/FFMpeg/Format/Hls',
    'tests/FFMpeg/Unit/Format/Hls',
    'src/FFMpeg/Format/ProgressListener/AbstractProgressListener.php',
    'tests/FFMpeg/Unit/Format/ProgressListener/VideoProgressListenerTest.php',
];
$files = [];
foreach ($roots as $root) {
    if (is_file($root)) {
        $files[] = $root;
        continue;
    }
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root));
    foreach ($iterator as $file) {
        if ($file->isFile() && substr($file->getFilename(), -4) === '.php') { $files[] = $file->getPathname(); }
    }
}
foreach ([
    'examples/hls-workflow.php',
    'experiments/php-ffmpeg/run-workflow-smoke.php',
    'experiments/php-ffmpeg/run-t4-transform-acceptance.php',
    'experiments/php-ffmpeg/run-t5-rendition-acceptance.php',
] as $file) { $files[] = $file; }
sort($files);
$hashes = [];
foreach ($files as $file) {
    $contents = file_get_contents($file);
    $parser->parse($contents);
    $hashes[$file] = hash('sha256', $contents);
}
$report = [
    'acceptance' => 'php80-source-syntax-compatibility',
    'status' => 'passed-static-grammar-only',
    'targetPhp' => '8.0',
    'runtimePhp' => PHP_VERSION,
    'parserVersion' => Composer\InstalledVersions::getPrettyVersion('nikic/php-parser'),
    'fileCount' => count($files),
    'filesSha256' => hash('sha256', json_encode($hashes, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)),
    'runtimeAcceptance' => 'passed; PHP 8.0.30 Docker ran the HLS unit suite (30 tests, 206 assertions) and progress monotonicity regression (4 tests, 30 assertions); see php80-runtime-hls.json',
];
$reportPath = '/workspace/experiments/php-ffmpeg/reports/php80-syntax-compatibility.json';
file_put_contents($reportPath, json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
echo json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
