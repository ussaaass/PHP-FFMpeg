<?php

require dirname(__DIR__, 2) . '/vendor/autoload.php';

use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyMaterial;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyProviderInterface;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyRequest;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyUriResolverInterface;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\PlaylistEncryptor;

$temporaryMaster = null;
if ($argc === 4 && $argv[1] === '--hevc-720p') {
    $clearPlaylist = realpath($argv[2]);
    if ($clearPlaylist === false || !is_file($clearPlaylist)) {
        fwrite(STDERR, "The HEVC media playlist must be an existing local file.\n");
        exit(2);
    }
    $temporaryMaster = dirname($clearPlaylist) . DIRECTORY_SEPARATOR . '.phpffmpeg-ctr-hevc-' . bin2hex(random_bytes(6)) . '.m3u8';
    file_put_contents($temporaryMaster, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720,CODECS=\"hev1.1.6.L93.B0\"\n" . basename($clearPlaylist) . "\n");
    $masterPlaylist = $temporaryMaster;
    $outputDirectory = $argv[3];
} elseif ($argc === 3) {
    $masterPlaylist = $argv[1];
    $outputDirectory = $argv[2];
} else {
    fwrite(STDERR, "Usage: php package-fixture.php [--hevc-720p] CLEAR_MASTER_OR_MEDIA_M3U8 OUTPUT_DIRECTORY\n");
    exit(2);
}

// Test-only key shared with worker-interop.mjs. Never use this value outside tests.
$fixtureKey = hex2bin('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
$provider = new class($fixtureKey) implements KeyProviderInterface {
    private string $key;

    public function __construct(string $key)
    {
        $this->key = $key;
    }

    public function getKeyMaterial(KeyRequest $request): KeyMaterial
    {
        return new KeyMaterial('interop-test-key', $this->key);
    }
};
$uriResolver = new class implements KeyUriResolverInterface {
    public function getKeyUri(KeyRequest $request, KeyMaterial $keyMaterial): string
    {
        return 'https://keys.example.test/' . rawurlencode($keyMaterial->getKeyId());
    }
};

try {
    $result = (new PlaylistEncryptor($provider, $uriResolver))
        ->encryptMasterPlaylist($masterPlaylist, $outputDirectory, 'worker-interop-fixture');
    fwrite(STDOUT, sprintf("Packaged %d encrypted VOD segments to %s\n", count($result->getSegments()), $result->getOutputDirectory()));
} finally {
    if ($temporaryMaster !== null) {
        unlink($temporaryMaster);
    }
}
