<?php

namespace FFMpeg\Format\Hls\Encryption\CtrHmacV2;

/** Byte-level CTR/HMAC V2 object encoder. */
final class Encryptor
{
    const PROFILE = 'phpffmpeg-ctr-hmac-v2';
    const PREAMBLE_SIZE = 40;
    const HEADER_SIZE = 24;
    const TAG_SIZE = 32;
    const RECORD_MAX_BYTES = 65536;
    const DOMAIN = "phpffmpeg-ctr-hmac-v2\n";
    const FINAL_FLAG = 0x80000000;

    public function encrypt(string $clear, KeyMaterial $keyMaterial, int $shortEdgePixels, int $segmentSequence, ?string $contentId = null, ?string $baseCounter = null): string
    {
        if ($clear === '') throw new \InvalidArgumentException('Cannot encrypt an empty media object.');
        if ($shortEdgePixels < 1 || $shortEdgePixels > 65535) throw new \InvalidArgumentException('shortEdgePixels must be between 1 and 65535.');
        if ($segmentSequence < 0 || $segmentSequence > 65535) throw new \InvalidArgumentException('segmentSequence must be between 0 and 65535.');
        $contentId = $contentId ?? random_bytes(16);
        $baseCounter = $baseCounter ?? random_bytes(16);
        if (strlen($contentId) !== 16 || strlen($baseCounter) !== 16) throw new \InvalidArgumentException('contentId and baseCounter must each contain exactly 16 bytes.');

        return $this->encryptRecords(str_split($clear, self::RECORD_MAX_BYTES), $keyMaterial, $shortEdgePixels, $segmentSequence, $contentId, $baseCounter);
    }

    /** @param string[] $clearRecords Explicit record boundaries are primarily useful for streamed encoders and protocol vectors. */
    public function encryptRecords(array $clearRecords, KeyMaterial $keyMaterial, int $shortEdgePixels, int $segmentSequence, ?string $contentId = null, ?string $baseCounter = null): string
    {
        if ($clearRecords === []) throw new \InvalidArgumentException('Cannot encrypt an empty media object.');
        $clearRecords = array_values($clearRecords);
        if ($shortEdgePixels < 1 || $shortEdgePixels > 65535) throw new \InvalidArgumentException('shortEdgePixels must be between 1 and 65535.');
        if ($segmentSequence < 0 || $segmentSequence > 65535) throw new \InvalidArgumentException('segmentSequence must be between 0 and 65535.');
        $contentId = $contentId ?? random_bytes(16);
        $baseCounter = $baseCounter ?? random_bytes(16);
        if (strlen($contentId) !== 16 || strlen($baseCounter) !== 16) throw new \InvalidArgumentException('contentId and baseCounter must each contain exactly 16 bytes.');
        foreach ($clearRecords as $record) {
            if (!is_string($record) || $record === '' || strlen($record) > self::RECORD_MAX_BYTES) throw new \InvalidArgumentException('Each record must contain between 1 and 65536 bytes.');
        }

        [$preamble, $aesKey, $macKey] = $this->context($keyMaterial, $shortEdgePixels, $segmentSequence, $contentId);
        $output = $preamble;
        foreach ($clearRecords as $sequence => $recordClear) {
            $output .= $this->encodeRecord($recordClear, $sequence, $sequence === count($clearRecords) - 1, $baseCounter, $preamble, $aesKey, $macKey);
        }
        return $output;
    }

    /** Encrypt a media object from streams while keeping at most two 64 KiB clear records in memory. */
    public function encryptStream($source, $destination, KeyMaterial $keyMaterial, int $shortEdgePixels, int $segmentSequence): void
    {
        if (!is_resource($source) || !is_resource($destination)) throw new \InvalidArgumentException('Source and destination must be open streams.');
        if ($shortEdgePixels < 1 || $shortEdgePixels > 65535 || $segmentSequence < 0 || $segmentSequence > 65535) throw new \InvalidArgumentException('Invalid V2 rendition or segment sequence.');
        [$preamble, $aesKey, $macKey] = $this->context($keyMaterial, $shortEdgePixels, $segmentSequence, random_bytes(16));
        self::writeAll($destination, $preamble);
        $baseCounter = random_bytes(16);
        $pending = self::readRecord($source);
        if ($pending === '') throw new \InvalidArgumentException('Cannot encrypt an empty media object.');
        $sequence = 0;
        while (true) {
            $next = self::readRecord($source);
            $isFinal = $next === '';
            self::writeAll($destination, $this->encodeRecord($pending, $sequence, $isFinal, $baseCounter, $preamble, $aesKey, $macKey));
            if ($isFinal) break;
            $pending = $next;
            if ($sequence === 0xffffffff) throw new \OverflowException('V2 encrypted record sequence overflow.');
            ++$sequence;
        }
    }

    /** Authenticate and decrypt a complete V2 object, failing closed on every malformed boundary. */
    public function decrypt(string $object, KeyMaterial $keyMaterial): string
    {
        if (strlen($object) < self::PREAMBLE_SIZE + self::HEADER_SIZE + 1 + self::TAG_SIZE) throw new \UnexpectedValueException('Truncated CTR/HMAC V2 object.');
        $preamble = substr($object, 0, self::PREAMBLE_SIZE);
        self::validatePreamble($preamble);
        if (!hash_equals(self::uint64be($keyMaterial->getAssetId()), substr($preamble, 8, 8)) || unpack('n', substr($preamble, 16, 2))[1] !== $keyMaterial->getKeyId()) throw new \UnexpectedValueException('CTR/HMAC V2 object does not match supplied asset KeyMaterial.');
        [$aesKey, $macKey] = self::deriveKeys($keyMaterial->getMasterKey(), $preamble);
        $offset = self::PREAMBLE_SIZE;
        $sequence = 0;
        $baseCounter = null;
        $clear = '';
        $length = strlen($object);
        while ($offset < $length) {
            if ($length - $offset < self::HEADER_SIZE + 1 + self::TAG_SIZE) throw new \UnexpectedValueException('Truncated CTR/HMAC V2 record.');
            $header = substr($object, $offset, self::HEADER_SIZE);
            $recordSequence = unpack('N', substr($header, 0, 4))[1];
            $counter = substr($header, 4, 16);
            $lengthAndFlags = unpack('N', substr($header, 20, 4))[1];
            $final = ($lengthAndFlags & self::FINAL_FLAG) !== 0;
            $recordLength = $lengthAndFlags & 0x7fffffff;
            if ($recordLength < 1 || $recordLength > self::RECORD_MAX_BYTES || $recordSequence !== $sequence) throw new \UnexpectedValueException('Invalid CTR/HMAC V2 record sequence or length.');
            $total = self::HEADER_SIZE + $recordLength + self::TAG_SIZE;
            if ($total > $length - $offset) throw new \UnexpectedValueException('Truncated CTR/HMAC V2 record body.');
            if ($sequence === 0) $baseCounter = $counter;
            if (!hash_equals(self::counterFor($baseCounter, $sequence, $recordLength), $counter)) throw new \UnexpectedValueException('CTR/HMAC V2 record counter is inconsistent.');
            $cipher = substr($object, $offset + self::HEADER_SIZE, $recordLength);
            $tag = substr($object, $offset + self::HEADER_SIZE + $recordLength, self::TAG_SIZE);
            $expected = hash_hmac('sha256', self::DOMAIN . $preamble . $header . $cipher, $macKey, true);
            if (!hash_equals($expected, $tag)) throw new \UnexpectedValueException('CTR/HMAC V2 record authentication failed.');
            if ($final && $offset + $total !== $length) throw new \UnexpectedValueException('Data follows the CTR/HMAC V2 FINAL record.');
            $part = openssl_decrypt($cipher, 'aes-128-ctr', $aesKey, OPENSSL_RAW_DATA | OPENSSL_ZERO_PADDING, $counter);
            if (!is_string($part) || strlen($part) !== $recordLength) throw new \RuntimeException('AES-CTR decryption failed.');
            $clear .= $part;
            $offset += $total;
            ++$sequence;
            if ($final) return $clear;
        }
        throw new \UnexpectedValueException('CTR/HMAC V2 object ended without FINAL.');
    }

    /** @return array{0:string,1:string} */
    public static function deriveKeys(string $masterKey, string $preamble): array
    {
        if (strlen($masterKey) !== 32 || strlen($preamble) !== self::PREAMBLE_SIZE) throw new \InvalidArgumentException('Invalid V2 master key or preamble length.');
        self::validatePreamble($preamble);
        $salt = substr($preamble, 24, 16);
        $context = substr($preamble, 8, 14);
        $aesInfo = "phpffmpeg-ctr-hmac-v2\0aes-128-ctr\0" . $context;
        $macInfo = "phpffmpeg-ctr-hmac-v2\0hmac-sha256\0" . $context;
        return [hash_hkdf('sha256', $masterKey, 16, $aesInfo, $salt), hash_hkdf('sha256', $masterKey, 32, $macInfo, $salt)];
    }

    public static function validatePreamble(string $preamble): void
    {
        if (strlen($preamble) !== self::PREAMBLE_SIZE || substr($preamble, 0, 8) !== "PFFHLS2\n" || substr($preamble, 22, 2) !== "\0\0") throw new \UnexpectedValueException('Invalid CTR/HMAC V2 preamble.');
        $keyId = unpack('n', substr($preamble, 16, 2))[1];
        $shortEdge = unpack('n', substr($preamble, 18, 2))[1];
        if ($keyId > 1023 || $shortEdge === 0) throw new \UnexpectedValueException('Invalid CTR/HMAC V2 preamble fields.');
    }

    /** @return array{0:string,1:string,2:string} */
    private function context(KeyMaterial $keyMaterial, int $shortEdgePixels, int $segmentSequence, string $contentId): array
    {
        if (strlen($contentId) !== 16) throw new \InvalidArgumentException('contentId must contain exactly 16 bytes.');
        $preamble = "PFFHLS2\n" . self::uint64be($keyMaterial->getAssetId()) . pack('n3', $keyMaterial->getKeyId(), $shortEdgePixels, $segmentSequence) . "\0\0" . $contentId;
        if (strlen($preamble) !== self::PREAMBLE_SIZE) throw new \LogicException('Invalid V2 preamble size.');
        [$aesKey, $macKey] = self::deriveKeys($keyMaterial->getMasterKey(), $preamble);
        return [$preamble, $aesKey, $macKey];
    }

    private function encodeRecord(string $clear, int $sequence, bool $final, string $baseCounter, string $preamble, string $aesKey, string $macKey): string
    {
        $counter = self::counterFor($baseCounter, $sequence, strlen($clear));
        $cipher = openssl_encrypt($clear, 'aes-128-ctr', $aesKey, OPENSSL_RAW_DATA | OPENSSL_ZERO_PADDING, $counter);
        if (!is_string($cipher) || strlen($cipher) !== strlen($clear)) throw new \RuntimeException('AES-CTR encryption failed.');
        $header = pack('N', $sequence) . $counter . pack('N', strlen($cipher) | ($final ? self::FINAL_FLAG : 0));
        $tag = hash_hmac('sha256', self::DOMAIN . $preamble . $header . $cipher, $macKey, true);
        return $header . $cipher . $tag;
    }

    private static function readRecord($source): string
    {
        $bytes = '';
        while (strlen($bytes) < self::RECORD_MAX_BYTES && !feof($source)) {
            $chunk = fread($source, self::RECORD_MAX_BYTES - strlen($bytes));
            if ($chunk === false) throw new \RuntimeException('Unable to read clear media input.');
            if ($chunk === '') {
                if (feof($source)) break;
                continue;
            }
            $bytes .= $chunk;
        }
        return $bytes;
    }

    private static function writeAll($destination, string $bytes): void
    {
        $offset = 0;
        while ($offset < strlen($bytes)) {
            $written = fwrite($destination, substr($bytes, $offset));
            if ($written === false || $written === 0) throw new \RuntimeException('Unable to write encrypted media output.');
            $offset += $written;
        }
    }

    private static function counterFor(string $base, int $sequence, int $length): string
    {
        $counter = $base;
        $increment = $sequence * 4096;
        for ($i = 15; $i >= 0; --$i) {
            $sum = ord($counter[$i]) + ($increment & 255);
            $increment = intdiv($increment, 256);
            if ($sum > 255) { ++$increment; $sum -= 256; }
            $counter[$i] = chr($sum);
        }
        if ($increment !== 0) throw new \OverflowException('AES-CTR record counter overflow.');
        $blocks = intdiv($length + 15, 16) - 1;
        for ($i = 15; $i >= 0 && $blocks > 0; --$i) {
            $sum = ord($counter[$i]) + ($blocks & 255);
            $blocks = intdiv($blocks, 256);
            if ($sum > 255) { ++$blocks; $sum -= 256; }
            $counter[$i] = chr($sum);
        }
        if ($blocks !== 0) throw new \OverflowException('AES-CTR last block counter overflow.');
        return self::addSmall($base, $sequence * 4096);
    }

    private static function addSmall(string $base, int $value): string
    {
        $out = $base;
        for ($i = 15; $i >= 0 && $value > 0; --$i) {
            $sum = ord($out[$i]) + ($value & 255);
            $value = intdiv($value, 256);
            if ($sum > 255) { ++$value; $sum -= 256; }
            $out[$i] = chr($sum);
        }
        if ($value !== 0) throw new \OverflowException('AES-CTR record counter overflow.');
        return $out;
    }

    public static function uint64be(string $decimal): string
    {
        $hex = '';
        while ($decimal !== '0') {
            $quotient = ''; $remainder = 0;
            for ($i = 0, $length = strlen($decimal); $i < $length; ++$i) {
                $number = $remainder * 10 + (int) $decimal[$i];
                $digit = intdiv($number, 16); $remainder = $number % 16;
                if ($quotient !== '' || $digit > 0) $quotient .= (string) $digit;
            }
            $hex = dechex($remainder) . $hex;
            $decimal = $quotient === '' ? '0' : $quotient;
        }
        return hex2bin(str_pad($hex, 16, '0', STR_PAD_LEFT));
    }
}
