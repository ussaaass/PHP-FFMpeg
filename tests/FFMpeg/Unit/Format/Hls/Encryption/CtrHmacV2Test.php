<?php

namespace Tests\FFMpeg\Unit\Format\Hls\Encryption;

use FFMpeg\Format\Hls\Encryption\CtrHmacV2\Encryptor;
use FFMpeg\Format\Hls\Encryption\CtrHmacV2\KeyMaterial;
use FFMpeg\Format\Hls\Encryption\CtrHmacV2\MediaPlaylistPackager;
use PHPUnit\Framework\TestCase;

class CtrHmacV2Test extends TestCase
{
    private function vector(): array
    {
        return json_decode(file_get_contents(dirname(__DIR__, 6) . '/doc/vectors/CTR-HMAC-V2-001.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    private function material(array $vector): KeyMaterial
    {
        return new KeyMaterial($vector['fields']['assetIdDecimal'], $vector['fields']['keyId'], hex2bin($vector['inputs']['masterKeyHex']));
    }

    public function testFixedVectorMatchesByteForByteAndRoundTrips(): void
    {
        $vector = $this->vector();
        $clearRecords = array_map(static function (array $record): string { return hex2bin($record['hex']); }, $vector['inputs']['clearRecords']);
        $clear = implode('', $clearRecords);
        $object = (new Encryptor())->encryptRecords($clearRecords, $this->material($vector), $vector['fields']['shortEdgePixels'], $vector['fields']['segmentSequence'], hex2bin($vector['inputs']['contentIdHex']), hex2bin($vector['inputs']['baseCounterHex']));
        self::assertSame($vector['object']['hex'], bin2hex($object));
        self::assertSame($vector['object']['sha256'], hash('sha256', $object));
        self::assertSame($clear, (new Encryptor())->decrypt($object, $this->material($vector)));
    }

    public function testTamperedAndTruncatedObjectsFailClosed(): void
    {
        $vector = $this->vector();
        $object = hex2bin($vector['object']['hex']);
        $encryptor = new Encryptor();
        foreach ([0, 8, 16, 18, 20, 22, 40, 44, 64, 140, strlen($object) - 1] as $offset) {
            $tampered = $object;
            $tampered[$offset] = chr(ord($tampered[$offset]) ^ 1);
            try {
                $encryptor->decrypt($tampered, $this->material($vector));
                self::fail('Tampered V2 object must be rejected at byte ' . $offset);
            } catch (\UnexpectedValueException $expected) {
                self::assertNotSame('', $expected->getMessage());
            }
        }
        try {
            $encryptor->decrypt(substr($object, 0, -1), $this->material($vector));
            self::fail('Truncated V2 object must be rejected.');
        } catch (\UnexpectedValueException $expected) {
            self::assertStringContainsString('Truncated', $expected->getMessage());
        }
    }

    public function testUnsignedAssetIdAndCounterOverflowBoundaries(): void
    {
        self::assertSame('ffffffffffffffff', bin2hex(Encryptor::uint64be('18446744073709551615')));
        $this->expectException(\OverflowException::class);
        (new Encryptor())->encrypt(str_repeat('x', 17), new KeyMaterial('42', 7, str_repeat("\0", 32)), 720, 0, str_repeat("\0", 16), str_repeat("\xff", 16));
    }

    public function testMediaPlaylistPackagingRewritesUrisAndPreservesClearInitializationMap(): void
    {
        $root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-ctr-v2-' . bin2hex(random_bytes(6));
        $source = $root . DIRECTORY_SEPARATOR . 'source';
        mkdir($source . DIRECTORY_SEPARATOR . '720p', 0700, true);
        file_put_contents($source . DIRECTORY_SEPARATOR . '720p/init.mp4', 'clear-init');
        file_put_contents($source . DIRECTORY_SEPARATOR . '720p/seg.m4s', pack('N', 8) . 'moof' . pack('N', 9) . 'mdatx');
        file_put_contents($source . DIRECTORY_SEPARATOR . '720p/index.m3u8', "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:5.0,\nseg.m4s\n#EXT-X-ENDLIST\n");
        $output = $root . DIRECTORY_SEPARATOR . 'package';
        try {
            $result = (new MediaPlaylistPackager())->package($source . DIRECTORY_SEPARATOR . '720p/index.m3u8', $output, 'release-1', 720, new KeyMaterial('42', 7, str_repeat("\x11", 32)));
            $playlist = file_get_contents($result['playlist']);
            self::assertStringContainsString('#EXT-X-MAP:URI="init.mp4"', $playlist);
            self::assertStringContainsString('#EXTINF:5.0,', $playlist);
            self::assertStringContainsString('#EXT-X-ENDLIST', $playlist);
            self::assertStringNotContainsString('#EXT-X-KEY:', $playlist);
            self::assertStringContainsString('/media/000000000000002a/7/720/release-1/', $playlist);
            self::assertStringNotContainsString('.json', $playlist);
            self::assertSame('clear-init', file_get_contents($output . '/init.mp4'));
            self::assertCount(1, $result['objects']);
            self::assertSame(substr(md5('42-720-0'), 0, 3) . '-00000.m4s', basename($result['objects'][0]));
            self::assertFileDoesNotExist($result['objects'][0] . '.json');
            self::assertSame(pack('N', 8) . 'moof' . pack('N', 9) . 'mdatx', (new Encryptor())->decrypt(file_get_contents($result['objects'][0]), new KeyMaterial('42', 7, str_repeat("\x11", 32))));
            mkdir($source . '/360p', 0700, true);
            file_put_contents($source . '/360p/init.mp4', 'clear-init-360');
            file_put_contents($source . '/360p/seg.m4s', pack('N', 8) . 'moof' . pack('N', 9) . 'mdatx');
            file_put_contents($source . '/360p/index.m3u8', "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:5.0,\nseg.m4s\n#EXT-X-ENDLIST\n");
            $multi = (new MediaPlaylistPackager())->packageRenditions([
                ['playlist' => $source . '/720p/index.m3u8', 'shortEdgePixels' => 720],
                ['playlist' => $source . '/360p/index.m3u8', 'shortEdgePixels' => 360],
            ], $root . '/multi', 'release-2', new KeyMaterial('42', 7, str_repeat("\x11", 32)));
            self::assertCount(2, $multi['objects']);
            self::assertCount(2, $multi['playlists']);
            self::assertFileExists($multi['playlists'][360]);
            self::assertFileExists($multi['playlists'][720]);
            self::assertFileExists($root . '/multi/media/000000000000002a/7/360/release-2/' . substr(md5('42-360-0'), 0, 3) . '-00000.m4s');
            $this->expectException(\InvalidArgumentException::class);
            (new MediaPlaylistPackager())->package($source . DIRECTORY_SEPARATOR . '720p/index.m3u8', $output, 'release-1', 720, new KeyMaterial('42', 7, str_repeat("\x11", 32)));
        } finally {
            $this->removeDirectory($root);
        }
    }

    public function testMediaSequenceFilenameBoundariesAndOverflow(): void
    {
        $root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-ctr-v2-seq-' . bin2hex(random_bytes(6));
        $source = $root . DIRECTORY_SEPARATOR . 'source';
        mkdir($source, 0700, true);
        file_put_contents($source . '/init.mp4', 'init');
        file_put_contents($source . '/seg.m4s', pack('N', 8) . 'moof');
        $packager = new MediaPlaylistPackager();
        $material = new KeyMaterial('42', 7, str_repeat("\x22", 32));
        try {
            foreach ([17 => '00017', 65535 => '65535'] as $sequence => $filenameSequence) {
                file_put_contents($source . '/index.m3u8', "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXT-X-MEDIA-SEQUENCE:$sequence\n#EXTINF:5.0,\nseg.m4s\n#EXT-X-ENDLIST\n");
                $result = $packager->package($source . '/index.m3u8', $root . '/out-' . $sequence, 'release-boundary-' . $sequence, 720, $material);
                self::assertSame(substr(md5('42-720-' . $sequence), 0, 3) . '-' . $filenameSequence . '.m4s', basename($result['objects'][0]));
            }
            file_put_contents($source . '/index.m3u8', "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:65536\n#EXTINF:5.0,\nseg.m4s\n#EXT-X-ENDLIST\n");
            $this->expectException(\OutOfRangeException::class);
            $packager->package($source . '/index.m3u8', $root . '/out-overflow', 'release-overflow', 720, $material);
        } finally {
            $this->removeDirectory($root);
        }
    }

    private function removeDirectory(string $directory): void
    {
        if (!is_dir($directory)) return;
        foreach (scandir($directory) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') continue;
            $path = $directory . DIRECTORY_SEPARATOR . $entry;
            if (is_dir($path)) $this->removeDirectory($path); else unlink($path);
        }
        rmdir($directory);
    }
}
