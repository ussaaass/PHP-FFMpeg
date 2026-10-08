<?php

require $argv[4];

use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyMaterial;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyProviderInterface;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyRequest;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyUriResolverInterface;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\PlaylistEncryptor;

$provider = new class implements KeyProviderInterface {
    public function getKeyMaterial(KeyRequest $request): KeyMaterial
    {
        return new KeyMaterial('parallel-video-key', str_repeat("\x42", 32));
    }
};
$resolver = new class implements KeyUriResolverInterface {
    public function getKeyUri(KeyRequest $request, KeyMaterial $keyMaterial): string
    {
        return 'https://keys.example.test/parallel-video-key';
    }
};
$result = (new PlaylistEncryptor($provider, $resolver))->encryptMasterPlaylist($argv[1], $argv[2], 'same-video-asset');
$contentIds = [];
$counterSets = [];
foreach ($result->getSegments() as $segment) {
    $sidecarPath = $result->getOutputDirectory() . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $segment['segmentUri']) . '.json';
    $sidecar = json_decode((string) file_get_contents($sidecarPath), true, 512, JSON_THROW_ON_ERROR);
    $contentIds[] = $sidecar['contentId'];
    $counterSets[] = array_column($sidecar['records'], 'counter');
}
file_put_contents($argv[3], json_encode(['contentIds' => $contentIds, 'counterSets' => $counterSets], JSON_THROW_ON_ERROR));
