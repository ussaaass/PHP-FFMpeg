<?php

namespace Tests\FFMpeg\Unit\Format\Hls\Encryption;

use FFMpeg\Format\Hls\Workflow\AtomicVersionedPublisher;
use Symfony\Component\Process\Process;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\Encryptor;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyMaterial;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyProviderInterface;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyRequest;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyUriResolverInterface;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\PlaylistEncryptor;
use PHPUnit\Framework\TestCase;

class CtrHmacV1Test extends TestCase
{
    public function testConcurrentMultiRenditionPackagesDoNotReuseContentIdsOrRecordCounters(): void
    {
        $base = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-ctr-concurrent-' . bin2hex(random_bytes(6));
        $source = $base . DIRECTORY_SEPARATOR . 'clear';
        $firstOutput = $base . DIRECTORY_SEPARATOR . 'parallel-a';
        $secondOutput = $base . DIRECTORY_SEPARATOR . 'parallel-b';
        mkdir($source . DIRECTORY_SEPARATOR . '360p', 0700, true);
        mkdir($source . DIRECTORY_SEPARATOR . '720p', 0700, true);
        foreach (['360p', '720p'] as $rendition) {
            file_put_contents($source . DIRECTORY_SEPARATOR . $rendition . DIRECTORY_SEPARATOR . 'init.mp4', 'init-' . $rendition);
            foreach ([0, 1] as $index) {
                $payload = $rendition . $index;
                file_put_contents($source . DIRECTORY_SEPARATOR . $rendition . DIRECTORY_SEPARATOR . 'segment-' . $index . '.m4s', pack('N', 8) . 'moof' . pack('N', 8 + strlen($payload)) . 'mdat' . $payload);
            }
            file_put_contents($source . DIRECTORY_SEPARATOR . $rendition . DIRECTORY_SEPARATOR . 'index.m3u8', "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:2,\nsegment-0.m4s\n#EXTINF:2,\nsegment-1.m4s\n#EXT-X-ENDLIST\n");
        }
        file_put_contents($source . DIRECTORY_SEPARATOR . 'master.m3u8', "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=640x360\n360p/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=1280x720\n720p/index.m3u8\n");

        $projectRoot = dirname(__DIR__, 6);
        $worker = $projectRoot . DIRECTORY_SEPARATOR . 'tests' . DIRECTORY_SEPARATOR . 'fixtures' . DIRECTORY_SEPARATOR . 'ctr-hmac-concurrent-worker.php';
        $autoload = $projectRoot . DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR . 'autoload.php';
        $firstReport = $base . DIRECTORY_SEPARATOR . 'parallel-a.json';
        $secondReport = $base . DIRECTORY_SEPARATOR . 'parallel-b.json';
        try {
            $first = new Process([PHP_BINARY, $worker, $source . DIRECTORY_SEPARATOR . 'master.m3u8', $firstOutput, $firstReport, $autoload]);
            $second = new Process([PHP_BINARY, $worker, $source . DIRECTORY_SEPARATOR . 'master.m3u8', $secondOutput, $secondReport, $autoload]);
            $first->start();
            $second->start();
            $first->wait();
            $second->wait();
            self::assertTrue($first->isSuccessful(), $first->getErrorOutput());
            self::assertTrue($second->isSuccessful(), $second->getErrorOutput());
            $firstData = json_decode((string) file_get_contents($firstReport), true, 512, JSON_THROW_ON_ERROR);
            $secondData = json_decode((string) file_get_contents($secondReport), true, 512, JSON_THROW_ON_ERROR);
            self::assertCount(4, $firstData['contentIds']);
            self::assertCount(4, $secondData['contentIds']);
            self::assertCount(8, array_unique(array_merge($firstData['contentIds'], $secondData['contentIds'])), 'Concurrent publication must use a fresh HKDF content-ID domain for every segment.');
            foreach (array_merge($firstData['counterSets'], $secondData['counterSets']) as $counterSet) {
                self::assertCount(count(array_unique($counterSet)), $counterSet, 'CTR counters must be unique within each segment key domain.');
            }
            $reportPath = getenv('CTR_HMAC_CONCURRENT_REPORT');
            if (is_string($reportPath) && $reportPath !== '') {
                $report = [
                    'status' => 'passed',
                    'gitCommit' => getenv('CTR_HMAC_TEST_COMMIT') ?: null,
                    'workingTreeWasDirty' => true,
                    'dockerImageId' => getenv('CTR_HMAC_TEST_IMAGE_ID') ?: null,
                    'phpVersion' => PHP_VERSION,
                    'concurrentRuns' => 2,
                    'renditionsPerRun' => 2,
                    'segmentsPerRun' => count($firstData['contentIds']),
                    'contentIds' => array_merge($firstData['contentIds'], $secondData['contentIds']),
                    'contentIdsUniqueAcrossBothRuns' => true,
                    'recordCountersUniqueWithinEverySegment' => true,
                    'masterKeyMaterialRecorded' => false,
                ];
                file_put_contents($reportPath, json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
            }
        } finally {
            $this->removeDirectory($base);
        }
    }

    public function testVersionedPublisherKeepsThePreviousVersionWhenBuildingOrCommittingFails(): void
    {
        $root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-versioned-' . bin2hex(random_bytes(6));
        mkdir($root, 0700, true);
        try {
            $publisher = new AtomicVersionedPublisher();
            $first = $publisher->publish(
                $root,
                static function (string $stage): void { file_put_contents($stage . DIRECTORY_SEPARATOR . 'playlist.m3u8', '#EXTM3U'); },
                static function (string $stage): void { if (!is_file($stage . DIRECTORY_SEPARATOR . 'playlist.m3u8')) { throw new \RuntimeException('missing playlist'); } }
            );
            $pointerBefore = file_get_contents($first['pointer']);
            self::assertSame($first['versionId'], json_decode($pointerBefore, true, 512, JSON_THROW_ON_ERROR)['version']);
            self::assertFileExists($first['directory'] . DIRECTORY_SEPARATOR . 'playlist.m3u8');

            $failingPublisher = new class extends AtomicVersionedPublisher {
                protected function commitPointer(string $temporaryPath, string $pointerPath): void
                {
                    throw new \RuntimeException('injected pointer update failure');
                }
            };
            try {
                $failingPublisher->publish(
                    $root,
                    static function (string $stage): void { file_put_contents($stage . DIRECTORY_SEPARATOR . 'playlist.m3u8', '#EXTM3U-new'); },
                    static function (string $stage): void { if (!is_file($stage . DIRECTORY_SEPARATOR . 'playlist.m3u8')) { throw new \RuntimeException('missing playlist'); } }
                );
                self::fail('Injected pointer failure must abort publication.');
            } catch (\RuntimeException $error) {
                self::assertSame('injected pointer update failure', $error->getMessage());
            }
            self::assertSame($pointerBefore, file_get_contents($first['pointer']));
            self::assertFileExists($first['directory'] . DIRECTORY_SEPARATOR . 'playlist.m3u8');
            self::assertSame([], glob($root . DIRECTORY_SEPARATOR . 'versions' . DIRECTORY_SEPARATOR . '.staging-*') ?: []);
            self::assertCount(1, glob($root . DIRECTORY_SEPARATOR . 'versions' . DIRECTORY_SEPARATOR . '*') ?: []);

            try {
                $publisher->publish(
                    $root,
                    static function (): void { throw new \RuntimeException('injected build failure'); },
                    static function (): void {}
                );
                self::fail('Injected build failure must abort publication.');
            } catch (\RuntimeException $error) {
                self::assertSame('injected build failure', $error->getMessage());
            }
            self::assertSame($pointerBefore, file_get_contents($first['pointer']));
            self::assertSame([], glob($root . DIRECTORY_SEPARATOR . 'versions' . DIRECTORY_SEPARATOR . '.staging-*') ?: []);
        } finally {
            $this->removeDirectory($root);
        }
    }

    public function testFixedCrossLanguageVectorMatchesThePhpImplementation(): void
    {
        $fixturePath = dirname(__DIR__, 6) . '/tests/fixtures/ctr-hmac-v1.json';
        $vector = json_decode(file_get_contents($fixturePath), true, 512, JSON_THROW_ON_ERROR);
        $masterKey = hex2bin($vector['masterKeyHex']);
        $record = hex2bin($vector['recordHex']);
        $contentId = $vector['contentId'];
        $baseCounter = base64_decode($vector['baseCounterBase64'], true);
        $clear = $vector['clearUtf8'];
        $aesKey = hash_hkdf('sha256', $masterKey, 16, Encryptor::PROFILE . "\0aes-128-ctr", $contentId);
        $macKey = hash_hkdf('sha256', $masterKey, 32, Encryptor::PROFILE . "\0hmac-sha256", $contentId);
        $header = substr($record, 0, Encryptor::HEADER_SIZE);
        $ciphertext = substr($record, Encryptor::HEADER_SIZE, $vector['clearBytes']);
        $tag = substr($record, -Encryptor::TAG_SIZE);
        $expectedTag = hash_hmac('sha256', Encryptor::DOMAIN . $contentId . "\0" . $header . $ciphertext, $macKey, true);
        $decrypted = openssl_decrypt($ciphertext, 'aes-128-ctr', $aesKey, OPENSSL_RAW_DATA | OPENSSL_ZERO_PADDING, $baseCounter);

        self::assertSame(Encryptor::PROFILE, $vector['profile']);
        self::assertSame($vector['recordBytes'], strlen($record));
        self::assertSame($baseCounter, substr($header, 4, 16));
        self::assertSame($vector['clearBytes'], unpack('Nlength', substr($header, 20, 4))['length']);
        self::assertSame($vector['ciphertextHex'], bin2hex($ciphertext));
        self::assertSame($vector['tagHex'], bin2hex($tag));
        self::assertSame($expectedTag, $tag);
        self::assertSame($clear, $decrypted);
        self::assertSame($vector['clearSha256'], hash('sha256', $decrypted));
    }

    public function testSegmentRecordsCanBeAuthenticatedAndDecrypted(): void
    {
        $clear = str_repeat('fmp4-media-record-', 5000);
        $contentId = '00000000-0000-4000-8000-000000000001';
        $masterKey = hex2bin('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
        $keyMaterial = new KeyMaterial('test-key-1', $masterKey);
        $segment = (new Encryptor())->encryptSegment($clear, '360p/segment.enc.m4s', $contentId, $keyMaterial, 'https://keys.example.test/key-1');
        $sidecar = $segment->getSidecar();
        $ciphertext = $segment->getEncryptedBytes();
        $aesKey = hash_hkdf('sha256', $masterKey, 16, Encryptor::PROFILE . "\0aes-128-ctr", $contentId);
        $macKey = hash_hkdf('sha256', $masterKey, 32, Encryptor::PROFILE . "\0hmac-sha256", $contentId);
        $clearRecords = '';
        $offset = 0;

        self::assertCount(2, $sidecar['records']);
        self::assertSame(strlen($clear) + (2 * 56), $sidecar['cipherBytes']);
        self::assertSame(hash('sha256', $clear), $sidecar['clearSha256']);

        foreach ($sidecar['records'] as $record) {
            $recordLength = Encryptor::HEADER_SIZE + $record['ciphertextLength'] + Encryptor::TAG_SIZE;
            $recordBytes = substr($ciphertext, $offset, $recordLength);
            $header = substr($recordBytes, 0, Encryptor::HEADER_SIZE);
            $encryptedBytes = substr($recordBytes, Encryptor::HEADER_SIZE, $record['ciphertextLength']);
            $tag = substr($recordBytes, -Encryptor::TAG_SIZE);
            $expectedTag = hash_hmac('sha256', Encryptor::DOMAIN . $contentId . "\0" . $header . $encryptedBytes, $macKey, true);

            self::assertSame($record['sequence'], unpack('Nsequence', substr($header, 0, 4))['sequence']);
            self::assertSame(base64_decode($record['counter'], true), substr($header, 4, 16));
            self::assertSame($expectedTag, $tag);
            $clearRecord = openssl_decrypt($encryptedBytes, 'aes-128-ctr', $aesKey, OPENSSL_RAW_DATA | OPENSSL_ZERO_PADDING, substr($header, 4, 16));
            self::assertNotFalse($clearRecord);
            $clearRecords .= $clearRecord;
            $offset += $recordLength;
        }

        self::assertSame(strlen($ciphertext), $offset);
        self::assertSame($clear, $clearRecords);
        self::assertArrayNotHasKey('masterKey', $sidecar);
        self::assertArrayNotHasKey('aesKey', $sidecar);
    }

    public function testKeyMaterialCannotBeSerializedAndIsRedactedFromDebugOutput(): void
    {
        $material = new KeyMaterial('test-key-1', str_repeat("\x01", 32));

        self::assertSame('[redacted]', $material->__debugInfo()['masterKey']);
        $this->expectException(\LogicException::class);
        serialize($material);
    }

    public function testPlaylistEncryptorPublishesEncryptedRenditionsAndSidecars(): void
    {
        $base = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-ctr-v1-' . bin2hex(random_bytes(6));
        $source = $base . DIRECTORY_SEPARATOR . 'clear';
        $output = $base . DIRECTORY_SEPARATOR . 'encrypted';
        $repeatOutput = $base . DIRECTORY_SEPARATOR . 'encrypted-repeat';
        $otherAssetOutput = $base . DIRECTORY_SEPARATOR . 'encrypted-other-asset';
        $versionedOutput = $base . DIRECTORY_SEPARATOR . 'versioned';
        mkdir($source . DIRECTORY_SEPARATOR . '360p', 0700, true);
        mkdir($source . DIRECTORY_SEPARATOR . '720p', 0700, true);
        file_put_contents($source . DIRECTORY_SEPARATOR . 'master.m3u8', "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=640x360\n360p/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=1280x720\n720p/index.m3u8\n");

        foreach (['360p', '720p'] as $rendition) {
            file_put_contents($source . DIRECTORY_SEPARATOR . $rendition . DIRECTORY_SEPARATOR . 'init.mp4', 'clear-init-' . $rendition);
            file_put_contents($source . DIRECTORY_SEPARATOR . $rendition . DIRECTORY_SEPARATOR . 'segment-000.m4s', pack('N', 8) . 'moof' . pack('N', 9) . 'mdatx');
            file_put_contents($source . DIRECTORY_SEPARATOR . $rendition . DIRECTORY_SEPARATOR . 'segment-001.m4s', pack('N', 8) . 'moof' . pack('N', 9) . 'mdatx');
            file_put_contents(
                $source . DIRECTORY_SEPARATOR . $rendition . DIRECTORY_SEPARATOR . 'index.m3u8',
                "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:2.0,\nsegment-000.m4s\n#EXTINF:2.0,\nsegment-001.m4s\n#EXT-X-ENDLIST\n"
            );
        }

        $provider = new class implements KeyProviderInterface {
            public function getKeyMaterial(KeyRequest $request): KeyMaterial
            {
                $suffix = $request->getOutputId() === 'movie-1' ? '1' : '2';
                return new KeyMaterial('video-key-movie-' . $suffix, str_repeat($suffix === '1' ? "\x11" : "\x22", 32));
            }
        };
        $uriResolver = new class implements KeyUriResolverInterface {
            public function getKeyUri(KeyRequest $request, KeyMaterial $keyMaterial): string
            {
                return 'https://keys.example.test/' . rawurlencode($keyMaterial->getKeyId());
            }
        };

        try {
            $result = (new PlaylistEncryptor($provider, $uriResolver))->encryptMasterPlaylist($source . DIRECTORY_SEPARATOR . 'master.m3u8', $output, 'movie-1');
            $master = file_get_contents($result->getMasterPlaylist());
            $descriptor = json_decode(file_get_contents($result->getPlaybackDescriptor()), true, 512, JSON_THROW_ON_ERROR);

            self::assertCount(4, $result->getSegments());
            self::assertSame(array_fill(0, 4, 'video-key-movie-1'), array_column($result->getSegments(), 'keyId'));
            self::assertStringContainsString('360p/index.m3u8', $master);
            self::assertSame(Encryptor::PROFILE, $descriptor['profile']);
            self::assertSame(4, $descriptor['segmentCount']);
            $secret = str_repeat("\x11", 32);
            $secretEncodings = [$secret, bin2hex($secret), base64_encode($secret)];
            foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($output, \FilesystemIterator::SKIP_DOTS)) as $file) {
                if (!$file->isFile()) { continue; }
                $artifact = file_get_contents($file->getPathname());
                self::assertNotFalse($artifact);
                foreach ($secretEncodings as $encodedSecret) {
                    self::assertStringNotContainsString($encodedSecret, $artifact, 'Published artifacts must never contain master-key material.');
                }
            }
            self::assertFileExists($output . DIRECTORY_SEPARATOR . '360p' . DIRECTORY_SEPARATOR . 'init.mp4');
            self::assertFileDoesNotExist($output . DIRECTORY_SEPARATOR . '360p' . DIRECTORY_SEPARATOR . 'segment-000.m4s');

            $contentIds = [];
            foreach ($result->getSegments() as $segment) {
                $mediaPath = $output . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $segment['segmentUri']);
                $sidecarPath = $mediaPath . '.json';
                self::assertFileExists($mediaPath);
                self::assertFileExists($sidecarPath);
                $sidecar = json_decode(file_get_contents($sidecarPath), true, 512, JSON_THROW_ON_ERROR);
                self::assertSame(basename($segment['segmentUri']), $sidecar['segmentUri']);
                self::assertSame($segment['keyId'], $sidecar['keyId']);
                self::assertSame(1, $sidecar['mediaFragmentCount']);
                self::assertArrayNotHasKey('masterKey', $sidecar);
                $contentIds[] = $sidecar['contentId'];
                $counters = array_column($sidecar['records'], 'counter');
                self::assertCount(count(array_unique($counters)), $counters, 'Records in one segment must never reuse a CTR counter.');
            }

            self::assertCount(count(array_unique($contentIds)), $contentIds, 'Each rendition/segment must use its own HKDF key domain.');
            $repeat = (new PlaylistEncryptor($provider, $uriResolver))->encryptMasterPlaylist($source . DIRECTORY_SEPARATOR . 'master.m3u8', $repeatOutput, 'movie-1');
            foreach ($repeat->getSegments() as $segment) {
                $mediaPath = $repeatOutput . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $segment['segmentUri']);
                $sidecar = json_decode(file_get_contents($mediaPath . '.json'), true, 512, JSON_THROW_ON_ERROR);
                $contentIds[] = $sidecar['contentId'];
            }
            self::assertCount(8, array_unique($contentIds), 'Repeated publication must not reuse a contentId/key domain.');

            $otherAsset = (new PlaylistEncryptor($provider, $uriResolver))->encryptMasterPlaylist($source . DIRECTORY_SEPARATOR . 'master.m3u8', $otherAssetOutput, 'movie-2');
            self::assertSame(array_fill(0, 4, 'video-key-movie-2'), array_column($otherAsset->getSegments(), 'keyId'));
            self::assertNotSame($result->getSegments()[0]['keyId'], $otherAsset->getSegments()[0]['keyId']);

            $versionedEncryptor = new PlaylistEncryptor($provider, $uriResolver);
            $versionOne = $versionedEncryptor->encryptMasterPlaylistVersioned($source . DIRECTORY_SEPARATOR . 'master.m3u8', $versionedOutput, 'movie-1');
            $pointerOne = file_get_contents($versionOne->getCurrentVersionPointer());
            $versionTwo = $versionedEncryptor->encryptMasterPlaylistVersioned($source . DIRECTORY_SEPARATOR . 'master.m3u8', $versionedOutput, 'movie-1');
            $pointerTwo = json_decode(file_get_contents($versionTwo->getCurrentVersionPointer()), true, 512, JSON_THROW_ON_ERROR);
            self::assertNotSame($pointerOne, file_get_contents($versionTwo->getCurrentVersionPointer()));
            self::assertSame($versionTwo->getVersionId(), $pointerTwo['version']);
            self::assertSame('versions/' . $versionTwo->getVersionId(), $pointerTwo['directory']);
            self::assertFileExists($versionOne->getMasterPlaylist(), 'A new publication must leave the previous immutable version readable.');
            self::assertFileExists($versionTwo->getPlaybackDescriptor());
            self::assertCount(4, $versionTwo->getSegments());
        } finally {
            $this->removeDirectory($base);
        }
    }

    public function testPlaylistEncryptorRejectsAKeyChangeWithinOneVideoAsset(): void
    {
        $base = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-ctr-key-change-' . bin2hex(random_bytes(6));
        $source = $base . DIRECTORY_SEPARATOR . 'clear';
        $output = $base . DIRECTORY_SEPARATOR . 'encrypted';
        mkdir($source . DIRECTORY_SEPARATOR . 'v0', 0700, true);
        file_put_contents($source . DIRECTORY_SEPARATOR . 'master.m3u8', "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nv0/index.m3u8\n");
        file_put_contents($source . DIRECTORY_SEPARATOR . 'v0/init.mp4', 'init');
        file_put_contents($source . DIRECTORY_SEPARATOR . 'v0/a.m4s', pack('N', 8) . 'moof' . pack('N', 9) . 'mdatx');
        file_put_contents($source . DIRECTORY_SEPARATOR . 'v0/b.m4s', pack('N', 8) . 'moof' . pack('N', 9) . 'mdatx');
        file_put_contents($source . DIRECTORY_SEPARATOR . 'v0/index.m3u8', "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:2,\na.m4s\n#EXTINF:2,\nb.m4s\n#EXT-X-ENDLIST\n");
        $provider = new class implements KeyProviderInterface {
            private $calls = 0;
            public function getKeyMaterial(KeyRequest $request): KeyMaterial
            {
                ++$this->calls;
                return new KeyMaterial('video-key', str_repeat($this->calls === 1 ? "\x11" : "\x22", 32));
            }
        };
        $resolver = new class implements KeyUriResolverInterface {
            public function getKeyUri(KeyRequest $request, KeyMaterial $keyMaterial): string { return 'https://keys.example.test/video-key'; }
        };
        try {
            $this->expectException(\UnexpectedValueException::class);
            (new PlaylistEncryptor($provider, $resolver))->encryptMasterPlaylist($source . DIRECTORY_SEPARATOR . 'master.m3u8', $output, 'video-1');
        } finally {
            $this->removeDirectory($base);
        }
    }

    public function testPlaylistEncryptorRejectsCredentialBearingKeyUrlsAndCleansStaging(): void
    {
        $base = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-ctr-url-secret-' . bin2hex(random_bytes(6));
        $source = $base . DIRECTORY_SEPARATOR . 'clear';
        $output = $base . DIRECTORY_SEPARATOR . 'encrypted';
        mkdir($source . DIRECTORY_SEPARATOR . 'v0', 0700, true);
        file_put_contents($source . DIRECTORY_SEPARATOR . 'master.m3u8', "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nv0/index.m3u8\n");
        file_put_contents($source . DIRECTORY_SEPARATOR . 'v0/init.mp4', 'init');
        file_put_contents($source . DIRECTORY_SEPARATOR . 'v0/segment.m4s', pack('N', 8) . 'moof' . pack('N', 9) . 'mdatx');
        file_put_contents($source . DIRECTORY_SEPARATOR . 'v0/index.m3u8', "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:2,\nsegment.m4s\n#EXT-X-ENDLIST\n");
        $provider = new class implements KeyProviderInterface {
            public function getKeyMaterial(KeyRequest $request): KeyMaterial { return new KeyMaterial('video-key', str_repeat("\x22", 32)); }
        };
        $resolver = new class implements KeyUriResolverInterface {
            public function getKeyUri(KeyRequest $request, KeyMaterial $keyMaterial): string { return 'https://keys.example.test/video?access_token=fixture-secret'; }
        };
        try {
            try {
                (new PlaylistEncryptor($provider, $resolver))->encryptMasterPlaylist($source . DIRECTORY_SEPARATOR . 'master.m3u8', $output, 'video-1');
                self::fail('Credential-bearing key URLs must not be written to playlists or sidecars.');
            } catch (\InvalidArgumentException $error) {
                self::assertStringNotContainsString('fixture-secret', $error->getMessage());
            }
            self::assertDirectoryDoesNotExist($output);
            self::assertSame([], glob($output . '.staging-*') ?: []);
        } finally {
            $this->removeDirectory($base);
        }
    }

    private function removeDirectory(string $directory): void
    {
        if (!is_dir($directory)) {
            return;
        }
        foreach (scandir($directory) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $path = $directory . DIRECTORY_SEPARATOR . $entry;
            if (is_dir($path)) {
                $this->removeDirectory($path);
            } else {
                unlink($path);
            }
        }
        rmdir($directory);
    }
}
