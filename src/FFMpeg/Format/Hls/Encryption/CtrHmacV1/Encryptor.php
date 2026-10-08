<?php

namespace FFMpeg\Format\Hls\Encryption\CtrHmacV1;

/**
 * Encrypts one finalized fMP4 HLS media segment using the CTR/HMAC V1 record format.
 *
 * @see https://github.com/PHP-FFMpeg/PHP-FFMpeg/blob/master/doc/specs/CTR-HMAC-RECORD-FORMAT-V1.md
 */
final class Encryptor
{
    const PROFILE = 'phpffmpeg-ctr-hmac-v1';
    const RECORD_SIZE = 65536;
    const HEADER_SIZE = 24;
    const TAG_SIZE = 32;
    const DOMAIN = "phpffmpeg-ctr-hmac-v1\n";

    /**
     * Encrypt a single media segment.
     *
     * The key material must be resolved by the application; this method never
     * generates or persists keys. The key URI is a client-facing URL,
     * not the URL or path from which the application obtains the secret key.
     */
    public function encryptSegment(
        string $clearBytes,
        string $segmentUri,
        string $contentId,
        KeyMaterial $keyMaterial,
        string $keyUri
    ): EncryptedSegment {
        $source = fopen('php://temp', 'w+b');
        $destination = fopen('php://temp/maxmemory:1048576', 'w+b');
        if ($source === false || $destination === false) {
            throw new \RuntimeException('Unable to create temporary CTR/HMAC streams.');
        }
        try {
            if (fwrite($source, $clearBytes) !== strlen($clearBytes)) {
                throw new \RuntimeException('Unable to stage the clear media segment.');
            }
            rewind($source);
            $sidecar = $this->encryptStream($source, $destination, $segmentUri, $contentId, $keyMaterial, $keyUri);
            rewind($destination);
            $encryptedBytes = stream_get_contents($destination);
            if ($encryptedBytes === false) {
                throw new \RuntimeException('Unable to read the encrypted media segment.');
            }
        } finally {
            fclose($source);
            fclose($destination);
        }

        return new EncryptedSegment($encryptedBytes, $sidecar);
    }

    /**
     * Encrypt file streams without buffering a complete segment in memory.
     *
     * The caller owns both stream resources and is responsible for closing them.
     *
     * @param resource $source
     * @param resource $destination
     * @return array<string, mixed>
     */
    public function encryptStream(
        $source,
        $destination,
        string $segmentUri,
        string $contentId,
        KeyMaterial $keyMaterial,
        string $keyUri
    ): array {
        if (!is_resource($source) || !is_resource($destination)) {
            throw new \InvalidArgumentException('Source and destination must be open streams.');
        }

        if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $contentId)) {
            throw new \InvalidArgumentException('The content ID must be a lowercase canonical UUID.');
        }

        if ($segmentUri === '' || $keyUri === '') {
            throw new \InvalidArgumentException('The segment URI and client key URI are required.');
        }

        if (!function_exists('hash_hkdf') || !function_exists('openssl_encrypt')) {
            throw new \RuntimeException('CTR/HMAC V1 requires PHP HKDF and OpenSSL support.');
        }

        $masterKey = $keyMaterial->getMasterKey();
        $aesKey = hash_hkdf(
            'sha256',
            $masterKey,
            16,
            self::PROFILE . "\0aes-128-ctr",
            $contentId
        );
        $macKey = hash_hkdf(
            'sha256',
            $masterKey,
            32,
            self::PROFILE . "\0hmac-sha256",
            $contentId
        );
        $baseCounter = random_bytes(16);
        $records = [];
        $sequence = 0;
        $clearLength = 0;
        $cipherLength = 0;
        $clearHash = hash_init('sha256');

        while (!feof($source)) {
            $recordClear = '';
            while (strlen($recordClear) < self::RECORD_SIZE && !feof($source)) {
                $chunk = fread($source, self::RECORD_SIZE - strlen($recordClear));
                if ($chunk === false) {
                    throw new \RuntimeException('Unable to read the clear media segment.');
                }
                $recordClear .= $chunk;
            }
            if ($recordClear === '') {
                if (feof($source)) {
                    break;
                }
                throw new \RuntimeException('The clear media stream returned no data before EOF.');
            }
            if ($sequence > 0xffffffff) {
                throw new \RuntimeException('The media segment exceeds the CTR/HMAC V1 record sequence limit.');
            }

            hash_update($clearHash, $recordClear);
            $counter = $this->counterForRecord($baseCounter, $sequence);
            $ciphertext = openssl_encrypt(
                $recordClear,
                'aes-128-ctr',
                $aesKey,
                OPENSSL_RAW_DATA | OPENSSL_ZERO_PADDING,
                $counter
            );

            if ($ciphertext === false || strlen($ciphertext) !== strlen($recordClear)) {
                throw new \RuntimeException(sprintf('Unable to encrypt CTR/HMAC V1 record %d.', $sequence));
            }

            $header = pack('N', $sequence) . $counter . pack('N', strlen($ciphertext));
            $tag = hash_hmac(
                'sha256',
                self::DOMAIN . $contentId . "\0" . $header . $ciphertext,
                $macKey,
                true
            );

            $recordBytes = $header . $ciphertext . $tag;
            $written = 0;
            while ($written < strlen($recordBytes)) {
                $count = fwrite($destination, substr($recordBytes, $written));
                if ($count === false || $count === 0) {
                    throw new \RuntimeException(sprintf('Unable to write encrypted CTR/HMAC V1 record %d.', $sequence));
                }
                $written += $count;
            }
            $records[] = [
                'sequence' => $sequence,
                'counter' => base64_encode($counter),
                'ciphertextLength' => strlen($ciphertext),
                'tagLength' => self::TAG_SIZE,
            ];

            $clearLength += strlen($recordClear);
            $cipherLength += strlen($recordBytes);
            ++$sequence;
        }

        if ($clearLength === 0) {
            throw new \InvalidArgumentException('Cannot encrypt an empty media segment.');
        }

        return [
            'version' => 1,
            'profile' => self::PROFILE,
            'segmentUri' => $segmentUri,
            'contentId' => $contentId,
            'keyId' => $keyMaterial->getKeyId(),
            'keyUri' => $keyUri,
            'baseCounter' => base64_encode($baseCounter),
            'clearBytes' => $clearLength,
            'cipherBytes' => $cipherLength,
            'clearSha256' => hash_final($clearHash),
            'records' => $records,
        ];
    }

    /**
     * Encrypt a file to a new file while keeping media bytes bounded in memory.
     *
     * @return array<string, mixed>
     */
    public function encryptFile(
        string $clearPath,
        string $encryptedPath,
        string $segmentUri,
        string $contentId,
        KeyMaterial $keyMaterial,
        string $keyUri
    ): array {
        $source = fopen($clearPath, 'rb');
        if ($source === false) {
            throw new \RuntimeException(sprintf('Unable to open clear media segment "%s".', $clearPath));
        }
        $destination = fopen($encryptedPath, 'xb');
        if ($destination === false) {
            fclose($source);
            throw new \RuntimeException(sprintf('Unable to create encrypted media segment "%s".', $encryptedPath));
        }

        try {
            $sidecar = $this->encryptStream($source, $destination, $segmentUri, $contentId, $keyMaterial, $keyUri);
        } catch (\Throwable $error) {
            fclose($source);
            fclose($destination);
            unlink($encryptedPath);
            throw $error;
        }

        fclose($source);
        fclose($destination);

        return $sidecar;
    }

    private function counterForRecord(string $baseCounter, int $sequence): string
    {
        if ($sequence > intdiv(PHP_INT_MAX, 4096)) {
            throw new \RuntimeException('The media segment counter increment exceeds this platform integer range.');
        }

        $counter = $baseCounter;
        $increment = $sequence * 4096;

        for ($index = 15; $index >= 0; --$index) {
            $sum = ord($counter[$index]) + ($increment % 256);
            $increment = intdiv($increment, 256);
            if ($sum > 255) {
                ++$increment;
                $sum -= 256;
            }
            $counter[$index] = chr($sum);
        }

        if ($increment !== 0) {
            throw new \RuntimeException('The AES-CTR counter space overflowed.');
        }

        return $counter;
    }
}
