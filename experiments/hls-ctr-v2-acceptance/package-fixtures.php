<?php

require dirname(__DIR__, 2) . '/vendor/autoload.php';

use FFMpeg\Format\Hls\Encryption\CtrHmacV2\KeyMaterial;
use FFMpeg\Format\Hls\Encryption\CtrHmacV2\MediaPlaylistPackager;

$source = dirname(__DIR__) . '/hls-ctr-progressive-demo/output';
$output = __DIR__ . '/output';
$h264Output = $output . '/h264';
$hevcOutput = $output . '/hevc';
if (file_exists($h264Output) || file_exists($hevcOutput)) {
    throw new RuntimeException('Refusing to overwrite CTR V2 browser-test fixtures; remove the isolated output directories first.');
}

$key = hex2bin('00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff');
$packager = new MediaPlaylistPackager();
$h264 = $packager->packageRenditions([
    ['playlist' => $source . '/abrt-360p.m3u8', 'shortEdgePixels' => 360],
    ['playlist' => $source . '/abrt-480p.m3u8', 'shortEdgePixels' => 480],
    ['playlist' => $source . '/abrt-720p.m3u8', 'shortEdgePixels' => 720],
], $h264Output, 'v2-browser-h264-1', new KeyMaterial('42', 7, $key));
$hevc = $packager->package($source . '/hevc-crf-32.m3u8', $hevcOutput, 'v2-browser-hevc-1', 720, new KeyMaterial('43', 8, $key));

fwrite(STDOUT, json_encode([
    'h264Renditions' => array_keys($h264['playlists']),
    'h264Objects' => count($h264['objects']),
    'hevcObjects' => count($hevc['objects']),
], JSON_THROW_ON_ERROR) . PHP_EOL);
