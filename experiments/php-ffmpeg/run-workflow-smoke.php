<?php

require dirname(__DIR__, 2) . '/vendor/autoload.php';

use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyMaterial;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyProviderInterface;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyRequest;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyUriResolverInterface;
use FFMpeg\Format\Hls\Workflow\HlsOutput;
use FFMpeg\Format\Hls\Workflow\Rendition;
use FFMpeg\Format\Hls\Workflow\WorkflowPlan;
use FFMpeg\Format\Hls\Workflow\WorkflowRunner;
use FFMpeg\Format\Hls\Workflow\Value\ContainerPath;
use FFMpeg\Format\Hls\Workflow\Value\EncryptionProfile;
use FFMpeg\Format\Hls\Workflow\Value\InputId;
use FFMpeg\Format\Hls\Workflow\Value\PublicationMode;
use FFMpeg\Format\Hls\Workflow\Value\RenditionId;
use FFMpeg\Format\Hls\Workflow\Value\VideoAssetId;
use FFMpeg\Format\Hls\Workflow\Value\VideoCodec;

if ($argc < 3 || $argc > 5) {
    fwrite(STDERR, "Usage: php run-workflow-smoke.php /container/input.mp4 /container/output/video-version [hevc] [versioned]\n");
    exit(2);
}

$input = ContainerPath::from($argv[1]);
$outputPath = ContainerPath::from($argv[2]);
$parent = dirname($outputPath->value());
if (!is_dir($parent) && !mkdir($parent, 0770, true) && !is_dir($parent)) {
    throw new RuntimeException('Unable to create output parent directory.');
}

$testKey = hex2bin('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
$testKeyId = 'interop-test-key';
$provider = new class($testKey, $testKeyId) implements KeyProviderInterface {
    private $key;
    private $keyId;
    public function __construct(string $key, string $keyId) { $this->key = $key; $this->keyId = $keyId; }
    public function getKeyMaterial(KeyRequest $request): KeyMaterial { return new KeyMaterial($this->keyId, $this->key); }
};
$uriResolver = new class implements KeyUriResolverInterface {
    public function getKeyUri(KeyRequest $request, KeyMaterial $keyMaterial): string
    {
        return 'https://keys.example.test/videos/' . rawurlencode($request->getOutputId()) . '/' . rawurlencode($keyMaterial->getKeyId());
    }
};

$options = array_slice($argv, 3);
$hevc = in_array('hevc', $options, true);
$versioned = in_array('versioned', $options, true);
$output = HlsOutput::create($outputPath)
    ->asset(VideoAssetId::named('workflow-smoke-video'))
    ->codec($hevc ? VideoCodec::hevc() : VideoCodec::h264())
    ->encryption(EncryptionProfile::ctrHmacV1())
    ->rendition(Rendition::create(RenditionId::named('720p'), 1280, 720, 2800000))
    ->publication($versioned ? PublicationMode::versioned() : PublicationMode::directory());
if (!$hevc) {
    $output = HlsOutput::create($outputPath)
        ->asset(VideoAssetId::named('workflow-smoke-video'))
        ->encryption(EncryptionProfile::ctrHmacV1())
        ->rendition(Rendition::create(RenditionId::named('360p'), 640, 360, 800000))
        ->rendition(Rendition::create(RenditionId::named('480p'), 854, 480, 1400000))
        ->rendition(Rendition::create(RenditionId::named('720p'), 1280, 720, 2800000))
        ->publication($versioned ? PublicationMode::versioned() : PublicationMode::directory());
}
$plan = WorkflowPlan::create()
    ->input(InputId::named('video'), $input)
    ->output($output);
$result = (new WorkflowRunner(keyProvider: $provider, keyUriResolver: $uriResolver))->execute($plan);
echo json_encode([
    'directory' => $result->directory(),
    'masterPlaylist' => $result->masterPlaylist(),
    'descriptor' => $result->descriptor(),
    'currentVersionPointer' => $result->currentVersionPointer(),
    'versionId' => $result->versionId(),
    'toolVersions' => $result->toolVersions(),
    'findingCount' => count($result->verification()->findings()),
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
