<?php

namespace FFMpeg\Format\Hls\Workflow;

use Symfony\Component\Process\Process;

/** Builds the RFC 6381 HEVC codec token from the generated hvcC configuration. */
final class HevcCodecStringResolver
{
    public function resolve(string $initSegmentPath, string $ffprobeBinary = 'ffprobe'): string
    {
        $process = new Process([$ffprobeBinary, '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,codec_tag_string,extradata', '-show_data', '-of', 'json', $initSegmentPath]);
        $process->run();
        if (!$process->isSuccessful()) { throw new \RuntimeException('Unable to inspect HEVC initialization-segment codec configuration.'); }
        $payload = json_decode($process->getOutput(), true, 512, JSON_THROW_ON_ERROR);
        $stream = $payload['streams'][0] ?? null;
        if (!is_array($stream) || ($stream['codec_name'] ?? '') !== 'hevc' || !isset($stream['codec_tag_string'], $stream['extradata'])) {
            throw new \UnexpectedValueException('HEVC initialization segment lacks a valid codec configuration record.');
        }
        $hex = '';
        foreach (preg_split('/\r?\n/', $stream['extradata']) as $line) {
            if (preg_match('/^\s*[0-9a-f]+:\s*((?:[0-9a-f]{4}\s+)+)/i', $line, $match)) {
                $hex .= preg_replace('/\s+/', '', $match[1]);
            }
        }
        $configuration = @hex2bin($hex);
        if ($configuration === false || strlen($configuration) < 13 || ord($configuration[0]) !== 1) {
            throw new \UnexpectedValueException('HEVC initialization segment contains a malformed hvcC record.');
        }
        $packedProfile = ord($configuration[1]);
        $profileSpace = ($packedProfile >> 6) & 0x03;
        $tier = ($packedProfile >> 5) & 0x01;
        $profileIdc = $packedProfile & 0x1f;
        $compatibility = unpack('Nvalue', substr($configuration, 2, 4))['value'];
        $reversedCompatibility = 0;
        for ($bit = 0; $bit < 32; ++$bit) {
            if (($compatibility & (1 << $bit)) !== 0) { $reversedCompatibility |= (1 << (31 - $bit)); }
        }
        $constraint = strtoupper(bin2hex(rtrim(substr($configuration, 6, 6), "\0")));
        $level = ord($configuration[12]);
        $space = ['', 'A', 'B', 'C'][$profileSpace];
        $codec = $stream['codec_tag_string'];
        if (!in_array($codec, ['hev1', 'hvc1'], true) || $profileIdc < 1 || $level < 1) {
            throw new \UnexpectedValueException('HEVC codec tag/profile/level is outside the supported RFC 6381 representation.');
        }
        $result = sprintf('%s.%s%d.%u.%s%d', $codec, $space, $profileIdc, $reversedCompatibility, $tier ? 'H' : 'L', $level);
        return $constraint === '' ? $result : $result . '.' . $constraint;
    }
}
