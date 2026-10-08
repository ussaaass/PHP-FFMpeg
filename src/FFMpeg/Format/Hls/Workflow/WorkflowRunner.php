<?php

namespace FFMpeg\Format\Hls\Workflow;

use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyProviderInterface;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\KeyUriResolverInterface;
use FFMpeg\Format\Hls\Encryption\CtrHmacV1\PlaylistEncryptor;
use FFMpeg\Format\Hls\Workflow\Value\FindingSeverity;
use Symfony\Component\Process\Process;

/** Docker-container workflow executor for finite fMP4 VOD packaging. */
final class WorkflowRunner
{
    private $verifier;
    private $ffmpegBinary;
    private $ffprobeBinary;
    private $keyProvider;
    private $keyUriResolver;

    public function __construct(?WorkflowVerifier $verifier = null, string $ffmpegBinary = 'ffmpeg', string $ffprobeBinary = 'ffprobe', ?KeyProviderInterface $keyProvider = null, ?KeyUriResolverInterface $keyUriResolver = null)
    {
        $this->verifier = $verifier ?: new WorkflowVerifier();
        $this->ffmpegBinary = $ffmpegBinary;
        $this->ffprobeBinary = $ffprobeBinary;
        $this->keyProvider = $keyProvider;
        $this->keyUriResolver = $keyUriResolver;
    }

    public function verify(WorkflowPlan $plan): VerificationReport
    {
        $report = $this->verifier->verify($plan);
        $findings = $report->findings();
        foreach ($plan->outputs() as $index => $output) {
            if (!$output instanceof HlsOutput || $output->encryptionProfile()->value() !== 'phpffmpeg-ctr-hmac-v1') { continue; }
            if ($this->keyProvider === null || $this->keyUriResolver === null) {
                $findings[] = new Finding('KEY_PROVIDER_REQUIRED', FindingSeverity::error(), 'CTR/HMAC requires an external KeyProvider and KeyUriResolver.', 'outputs.' . $index, 'Configure application-owned key services before execution.');
            }
        }
        foreach ($plan->inputs() as $id => $path) {
            if (!is_file($path->value())) { continue; }
            if (!in_array(strtolower(pathinfo($path->value(), PATHINFO_EXTENSION)), ['mp4', 'mov', 'm4v'], true)) { continue; }
            try {
                if (!(new Mp4BoxInspector())->inspect($path->value())['faststart']) {
                    $findings[] = new Finding('INPUT_FASTSTART_WILL_BE_NORMALIZED', FindingSeverity::info(), 'Input is not faststart; execution will create and verify a stream-copy intermediate.', 'inputs.' . $id);
                }
            } catch (\Throwable $error) {
                $findings[] = new Finding('INPUT_MP4_BOX_INVALID', FindingSeverity::error(), 'Input failed ISO BMFF box validation.', 'inputs.' . $id, 'Use a valid MP4/MOV file or remux it before running the workflow.');
            }
        }
        foreach ($findings as $finding) {
            if ($finding->severity()->value() === 'error') {
                return new VerificationReport($findings);
            }
        }
        try {
            $probe = new Process([$this->ffprobeBinary, '-version']);
            $probe->run();
            if (!$probe->isSuccessful()) {
                $findings[] = new Finding('FFPROBE_UNAVAILABLE', FindingSeverity::error(), 'FFprobe is unavailable in the execution container.', 'tools.ffprobe');
                return new VerificationReport($findings);
            }
            foreach ($plan->inputs() as $id => $path) {
                $streamProbe = new Process([$this->ffprobeBinary, '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', $path->value()]);
                $streamProbe->run();
                if (!$streamProbe->isSuccessful()) {
                    $findings[] = new Finding('INPUT_STREAM_PROBE_FAILED', FindingSeverity::error(), 'Unable to inspect the configured media streams.', 'inputs.' . $id, 'Use a readable media file with supported streams.');
                    continue;
                }
                $streamInfo = json_decode($streamProbe->getOutput(), true);
                if (!is_array($streamInfo) || !is_array($streamInfo['streams'] ?? null)) {
                    $findings[] = new Finding('INPUT_STREAM_PROBE_FAILED', FindingSeverity::error(), 'FFprobe returned an invalid stream description.', 'inputs.' . $id, 'Use a readable media file with supported streams.');
                    continue;
                }
                $streamCounts = ['video' => 0, 'audio' => 0, 'subtitle' => 0];
                foreach ($streamInfo['streams'] as $stream) {
                    $type = $stream['codec_type'] ?? null;
                    if (isset($streamCounts[$type])) { ++$streamCounts[$type]; }
                }
                if ($streamCounts['video'] === 0) {
                    $findings[] = new Finding('VIDEO_STREAM_REQUIRED', FindingSeverity::error(), 'The workflow requires a video stream; this V1 API selects the first video stream and optional embedded first audio stream.', 'inputs.' . $id, 'Provide a video file with an embedded audio stream if audio is required.');
                } elseif ($streamCounts['video'] > 1) {
                    $findings[] = new Finding('MULTIPLE_VIDEO_STREAMS_UNSUPPORTED', FindingSeverity::error(), 'The V1 workflow accepts exactly one video stream.', 'inputs.' . $id, 'Select or prepare a source containing one video stream.');
                }
                if ($streamCounts['audio'] > 1 || $streamCounts['subtitle'] > 0) {
                    $findings[] = new Finding('AUXILIARY_MEDIA_STREAMS_UNSUPPORTED', FindingSeverity::error(), 'The V1 workflow accepts at most one embedded audio stream and does not accept subtitle streams.', 'inputs.' . $id, 'Prepare one embedded audio stream and remove or separately package unsupported tracks.');
                }
            }
            foreach ($findings as $finding) {
                if ($finding->severity()->value() === 'error') {
                    return new VerificationReport($findings);
                }
            }
            $ffmpeg = new Process([$this->ffmpegBinary, '-hide_banner', '-encoders']);
            $ffmpeg->run();
            if (!$ffmpeg->isSuccessful()) { throw new \RuntimeException('FFmpeg encoder capability query failed.'); }
            $encoderOutput = $ffmpeg->getOutput();
            foreach ($plan->outputs() as $index => $output) {
                if (!$output instanceof HlsOutput) { continue; }
                $required = $output->videoCodec()->value() === 'hevc' ? 'libx265' : 'libx264';
                if (strpos($encoderOutput, $required) === false) {
                    $findings[] = new Finding('ENCODER_UNAVAILABLE', FindingSeverity::error(), sprintf('The configured FFmpeg image does not provide %s.', $required), 'outputs.' . $index, 'Use a Docker image with the selected encoder enabled.');
                }
            }
            $muxers = new Process([$this->ffmpegBinary, '-hide_banner', '-muxers']);
            $muxers->run();
            if (!$muxers->isSuccessful() || strpos($muxers->getOutput(), ' hls ') === false) {
                $findings[] = new Finding('HLS_MUXER_UNAVAILABLE', FindingSeverity::error(), 'The FFmpeg image does not provide the HLS muxer.', 'tools.ffmpeg');
            }
        } catch (\Throwable $error) {
            $findings[] = new Finding('FFMPEG_UNAVAILABLE', FindingSeverity::error(), 'Unable to inspect FFmpeg capabilities in the execution container.', 'tools.ffmpeg', 'Check the Docker image and configured binary names.');
        }
        return new VerificationReport($findings);
    }

    public function execute(WorkflowPlan $plan): WorkflowResult
    {
        $report = $this->verify($plan);
        if ($report->hasBlockingErrors()) {
            throw new \InvalidArgumentException($this->formatFindings($report));
        }
        if (count($plan->inputs()) !== 1 || count($plan->outputs()) !== 1) {
            throw new \InvalidArgumentException('The initial executor supports exactly one input and one HLS output per run.');
        }
        $selectedOutput = $plan->outputs()[0];
        if ($selectedOutput instanceof HlsOutput
            && $selectedOutput->encryptionProfile()->value() === 'phpffmpeg-ctr-hmac-v1'
            && ($this->keyProvider === null || $this->keyUriResolver === null)) {
            throw new \InvalidArgumentException('CTR/HMAC output requires an external KeyProvider and KeyUriResolver before FFmpeg can start.');
        }
        if ($selectedOutput instanceof HlsOutput
            && $selectedOutput->encryptionProfile()->value() === 'phpffmpeg-ctr-hmac-v1'
            && $selectedOutput->mode()->value() !== 'master') {
            throw new \InvalidArgumentException('The current CTR/HMAC publisher requires master-playlist mode.');
        }
        $trim = null;
        $steps = $plan->steps();
        foreach ($steps as $step) {
            if ($step->trim() !== null) {
                if ($trim !== null) { throw new \InvalidArgumentException('Only one trim step is supported per workflow.'); }
                $trim = $step->trim();
            }
        }
        $inputMap = $plan->inputs();
        $firstInput = reset($inputMap);
        $sourcePath = $firstInput->value();
        $output = $plan->outputs()[0];
        if (!$output instanceof HlsOutput) { throw new \LogicException('Verified output unexpectedly has an invalid type.'); }
        $directory = $output->directory()->value();
        $parent = dirname(rtrim($directory, DIRECTORY_SEPARATOR));
        $clearStage = $parent . DIRECTORY_SEPARATOR . '.' . basename($directory) . '.clear-' . bin2hex(random_bytes(8));
        if (!mkdir($clearStage, 0700, true)) { throw new \RuntimeException('Unable to create the HLS staging directory.'); }
        $published = false;
        $keyIds = [];
        try {
            $normalization = $this->normalizeInput($sourcePath, $clearStage);
            $sourcePath = $normalization->path();
            $hasAudio = $this->hasAudio($sourcePath);
            if (!$hasAudio) {
                foreach ($steps as $step) {
                    if ($step->audioFilter() !== null) {
                        throw new \InvalidArgumentException('Audio processing steps require an input audio stream.');
                    }
                }
            }
            $gopFrames = $this->gopFrames($sourcePath);
            $arguments = $this->buildArguments($sourcePath, $clearStage, $output, $hasAudio, $steps, $trim, $gopFrames);
            $process = new Process($arguments);
            $process->run();
            if (!$process->isSuccessful()) {
                throw new \RuntimeException(sprintf('FFmpeg HLS execution failed (exit %d): %s', $process->getExitCode(), trim($process->getErrorOutput())));
            }
            $master = $clearStage . DIRECTORY_SEPARATOR . 'master.m3u8';
            if ($output->mode()->value() === 'media') {
                $master = $clearStage . DIRECTORY_SEPARATOR . 'v0' . DIRECTORY_SEPARATOR . 'index.m3u8';
            }
            if ($output->mode()->value() === 'master') {
                $this->rewriteMasterCodecs($master, $clearStage, $output, $hasAudio);
            }
            $this->validatePlaylists($clearStage, $output, $hasAudio);
            $ffmpegVersion = $this->toolVersion($this->ffmpegBinary);
            $ffprobeVersion = $this->toolVersion($this->ffprobeBinary);
            $descriptor = null;
            $currentVersionPointer = null;
            $versionId = null;
            if ($output->encryptionProfile()->value() === 'phpffmpeg-ctr-hmac-v1') {
                if ($this->keyProvider === null || $this->keyUriResolver === null) {
                    throw new \InvalidArgumentException('CTR/HMAC output requires an external KeyProvider and KeyUriResolver.');
                }
                if ($output->mode()->value() !== 'master') {
                    throw new \InvalidArgumentException('The current CTR/HMAC publisher requires master-playlist mode.');
                }
                $encryptor = new PlaylistEncryptor($this->keyProvider, $this->keyUriResolver);
                $result = $output->publicationMode()->value() === 'versioned'
                    ? $encryptor->encryptMasterPlaylistVersioned($master, $directory, $output->assetId()->value())
                    : $encryptor->encryptMasterPlaylist($master, $directory, $output->assetId()->value());
                $directory = $result->getOutputDirectory();
                $descriptor = $result->getPlaybackDescriptor();
                $master = $result->getMasterPlaylist();
                $currentVersionPointer = $result->getCurrentVersionPointer();
                $versionId = $result->getVersionId();
                foreach ($result->getSegments() as $segment) { $keyIds[] = $segment['keyId']; }
            } else {
                if (!rename($clearStage, $directory)) { throw new \RuntimeException('Unable to atomically publish the HLS output directory.'); }
                $published = true;
                $master = $directory . substr($master, strlen($clearStage));
            }
            return new WorkflowResult($directory, $master, $descriptor, ['ffmpeg' => $ffmpegVersion, 'ffprobe' => $ffprobeVersion], $report, $this->listFiles($directory), $keyIds, $currentVersionPointer, $versionId, $this->commandSummary($output, $steps, $hasAudio, $normalization->summary()));
        } finally {
            if (!$published && is_dir($clearStage)) { $this->removeTree($clearStage); }
        }
    }

    private function commandSummary(HlsOutput $output, array $steps, bool $hasAudio, array $normalization): array
    {
        $renditions = [];
        foreach ($output->renditions() as $rendition) {
            $renditions[] = [
                'id' => $rendition->id()->value(),
                'width' => $rendition->width(),
                'height' => $rendition->height(),
                'videoBitrate' => $rendition->videoBitrate(),
                'audioBitrate' => $hasAudio ? $rendition->audioBitrate() : null,
            ];
        }
        $stepTypes = [];
        foreach ($steps as $step) { $stepTypes[] = substr(strrchr(get_class($step), '\\'), 1) ?: get_class($step); }
        return [
            'tool' => basename($this->ffmpegBinary),
            'operation' => 'hls-vod-transcode',
            'codec' => $output->videoCodec()->value(),
            'container' => $output->container()->value(),
            'playlistMode' => $output->mode()->value(),
            'audioPresent' => $hasAudio,
            'inputNormalization' => $normalization,
            'typedSteps' => $stepTypes,
            'renditions' => $renditions,
        ];
    }

    private function normalizeInput(string $source, string $staging): FaststartNormalizationResult
    {
        $extension = strtolower(pathinfo($source, PATHINFO_EXTENSION));
        if (!in_array($extension, ['mp4', 'mov', 'm4v'], true)) {
            return new FaststartNormalizationResult($source, [
                'method' => 'not-applicable',
                'sourceFaststart' => null,
                'outputFaststart' => null,
                'sourceUnchanged' => true,
                'remuxFallbackUsed' => false,
            ]);
        }
        return (new FaststartNormalizer(null, $this->ffmpegBinary))->normalizeWithReport($source, $staging);
    }

    private function hasAudio(string $source): bool
    {
        $process = new Process([$this->ffprobeBinary, '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', $source]);
        $process->run();
        if (!$process->isSuccessful()) { throw new \RuntimeException('Unable to probe input audio streams: ' . trim($process->getErrorOutput())); }
        return trim($process->getOutput()) !== '';
    }

    private function gopFrames(string $source): int
    {
        $process = new Process([$this->ffprobeBinary, '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate', '-of', 'csv=p=0', $source]);
        $process->run();
        if (!$process->isSuccessful()) { throw new \RuntimeException('Unable to probe video frame rate for aligned HLS GOP generation.'); }
        $rate = trim($process->getOutput());
        if (!preg_match('/^(\d+)\/(\d+)$/', $rate, $matches) || (int) $matches[2] === 0) { return 48; }
        $frames = (int) round(((int) $matches[1] / (int) $matches[2]) * 2);
        if ($frames < 1 || $frames > 1000) { throw new \UnexpectedValueException('Input frame rate is outside the supported GOP alignment range.'); }
        return $frames;
    }

    private function buildArguments(string $source, string $directory, HlsOutput $output, bool $hasAudio, array $steps, ?array $trim, int $gopFrames): array
    {
        $renditions = $output->renditions();
        $count = count($renditions);
        $args = [$this->ffmpegBinary, '-nostdin', '-hide_banner', '-v', 'error'];
        if ($trim !== null) { $args[] = '-ss'; $args[] = (string) $trim['start']; }
        $args[] = '-i'; $args[] = $source;
        if ($trim !== null) { $args[] = '-t'; $args[] = (string) $trim['duration']; }
        $filters = [];
        $audioFilters = [];
        foreach ($steps as $step) { if ($step->audioFilter() !== null) { $audioFilters[] = $step->audioFilter(); } }
        $splitOutputs = [];
        for ($i = 0; $i < $count; ++$i) { $splitOutputs[] = '[vsrc' . $i . ']'; }
        $filters[] = '[0:v:0]split=' . $count . implode('', $splitOutputs);
        foreach ($renditions as $i => $rendition) {
            $chain = [];
            foreach ($steps as $step) { if ($step->videoFilter() !== null) { $chain[] = $step->videoFilter(); } }
            $chain[] = 'scale=' . $rendition->width() . ':' . $rendition->height() . ':force_original_aspect_ratio=decrease';
            $chain[] = 'pad=' . $rendition->width() . ':' . $rendition->height() . ':(ow-iw)/2:(oh-ih)/2';
            $chain[] = 'setsar=1';
            $filters[] = '[vsrc' . $i . ']' . implode(',', $chain) . '[vout' . $i . ']';
        }
        if ($hasAudio && count($audioFilters) > 0) {
            $audioSplitOutputs = [];
            for ($i = 0; $i < $count; ++$i) { $audioSplitOutputs[] = '[asrc' . $i . ']'; }
            $filters[] = '[0:a:0]asplit=' . $count . implode('', $audioSplitOutputs);
            foreach ($renditions as $i => $rendition) {
                $filters[] = '[asrc' . $i . ']' . implode(',', $audioFilters) . '[aout' . $i . ']';
            }
        }
        $args[] = '-filter_complex';
        $args[] = implode(';', $filters);
        foreach ($renditions as $i => $rendition) {
            $args[] = '-map'; $args[] = '[vout' . $i . ']';
            if ($hasAudio) { $args[] = '-map'; $args[] = count($audioFilters) > 0 ? '[aout' . $i . ']' : '0:a:0'; }
            $args[] = '-c:v:' . $i; $args[] = $output->videoCodec()->value() === 'hevc' ? 'libx265' : 'libx264';
            $args[] = '-b:v:' . $i; $args[] = (string) $rendition->videoBitrate();
            $args[] = '-maxrate:v:' . $i; $args[] = (string) $rendition->videoBitrate();
            $args[] = '-bufsize:v:' . $i; $args[] = (string) ($rendition->videoBitrate() * 2);
            $args[] = '-g:v:' . $i; $args[] = (string) $gopFrames;
            $args[] = '-keyint_min:v:' . $i; $args[] = (string) $gopFrames;
            $args[] = '-sc_threshold:v:' . $i; $args[] = '0';
            $args[] = '-force_key_frames:v:' . $i; $args[] = 'expr:gte(t,n_forced*2)';
            if ($output->videoCodec()->value() === 'hevc') {
                $args[] = '-x265-params:v:' . $i;
                $args[] = 'keyint=' . $gopFrames . ':min-keyint=' . $gopFrames . ':scenecut=0';
            }
            if ($hasAudio) {
                $args[] = '-c:a:' . $i; $args[] = 'aac';
                $args[] = '-b:a:' . $i; $args[] = (string) $rendition->audioBitrate();
            }
        }
        $mapping = [];
        foreach ($renditions as $i => $rendition) {
            $mapping[] = 'v:' . $i . ($hasAudio ? ',a:' . $i : '') . ',name:' . $rendition->id()->value();
        }
        if ($output->mode()->value() === 'master') {
            $args[] = '-master_pl_name'; $args[] = 'master.m3u8';
            $args[] = '-var_stream_map'; $args[] = implode(' ', $mapping);
        } else {
            $args[] = '-var_stream_map'; $args[] = $mapping[0];
        }
        $args = array_merge($args, ['-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments']);
        $args[] = '-hls_segment_type'; $args[] = $output->container()->value() === 'fmp4' ? 'fmp4' : 'mpegts';
        $args[] = '-hls_fmp4_init_filename';
        $args[] = count($renditions) === 1 ? 'init_' . $renditions[0]->id()->value() . '.mp4' : 'init_%v.mp4';
        $args[] = '-hls_segment_filename'; $args[] = $directory . DIRECTORY_SEPARATOR . 'v%v' . DIRECTORY_SEPARATOR . 'segment_%05d.' . ($output->container()->value() === 'fmp4' ? 'm4s' : 'ts');
        $args[] = $directory . DIRECTORY_SEPARATOR . 'v%v' . DIRECTORY_SEPARATOR . 'index.m3u8';
        return $args;
    }

    private function validatePlaylists(string $stage, HlsOutput $output, bool $hasAudio): void
    {
        $paths = [];
        foreach (glob($stage . DIRECTORY_SEPARATOR . 'v*' . DIRECTORY_SEPARATOR . 'index.m3u8') ?: [] as $playlist) { $paths[] = $playlist; }
        if (count($paths) !== count($output->renditions())) { throw new \RuntimeException('Generated rendition playlist count does not match the workflow plan.'); }
        $timelines = [];
        foreach ($paths as $playlistIndex => $playlist) {
            $lines = file($playlist, FILE_IGNORE_NEW_LINES);
            if ($lines === false || !in_array('#EXT-X-ENDLIST', $lines, true)) { throw new \RuntimeException('Generated media playlist is incomplete or not VOD.'); }
            if ($output->container()->value() === 'fmp4') {
                $mapFound = false;
                foreach ($lines as $line) {
                    if (strpos($line, '#EXT-X-MAP:') !== 0) { continue; }
                    if (!preg_match('/(?:^|,)URI="([^"]+)"/', substr($line, strlen('#EXT-X-MAP:')), $mapMatch)) { throw new \RuntimeException('Generated fMP4 playlist has an invalid initialization map.'); }
                    $mapPath = dirname($playlist) . DIRECTORY_SEPARATOR . $mapMatch[1];
                    if (!is_file($mapPath)) { throw new \RuntimeException('Generated fMP4 playlist references a missing initialization segment.'); }
                    $mapFound = true;
                }
                if (!$mapFound) { throw new \RuntimeException('Generated fMP4 playlist has no initialization map.'); }
            }
            foreach ($lines as $line) {
                if (strpos($line, '#EXTINF:') === 0) {
                    $duration = (float) rtrim(substr($line, strlen('#EXTINF:')), ',');
                    if (!is_finite($duration) || $duration <= 0 || $duration > 2.1) {
                        throw new \RuntimeException(sprintf('Generated HLS segment duration %.6f is outside the 2-second alignment target.', $duration));
                    }
                    $timelines[$playlistIndex][] = $duration;
                }
                if ($line === '' || $line[0] === '#') { continue; }
                $segment = dirname($playlist) . DIRECTORY_SEPARATOR . $line;
                if (!is_file($segment)) { throw new \RuntimeException(sprintf('Playlist references missing media segment "%s".', $line)); }
            }
            $streamProbe = new Process([$this->ffprobeBinary, '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', $playlist]);
            $streamProbe->run();
            if (!$streamProbe->isSuccessful()) { throw new \RuntimeException('Unable to probe generated rendition stream mapping: ' . trim($streamProbe->getErrorOutput())); }
            $streamData = json_decode($streamProbe->getOutput(), true);
            $videoStreams = 0;
            $audioStreams = 0;
            foreach (is_array($streamData['streams'] ?? null) ? $streamData['streams'] : [] as $stream) {
                if (($stream['codec_type'] ?? null) === 'video') { ++$videoStreams; }
                if (($stream['codec_type'] ?? null) === 'audio') { ++$audioStreams; }
            }
            if ($videoStreams !== 1 || $audioStreams !== ($hasAudio ? 1 : 0)) {
                throw new \RuntimeException(sprintf('Generated rendition stream mapping is invalid: expected one video and %d audio streams, found %d video and %d audio streams.', $hasAudio ? 1 : 0, $videoStreams, $audioStreams));
            }
        }
            if (count($timelines) > 1) {
            $reference = reset($timelines);
            foreach ($timelines as $timeline) {
                if (count($timeline) !== count($reference)) { throw new \RuntimeException('HLS renditions do not have the same segment boundary count.'); }
                $referenceTime = 0.0;
                $candidateTime = 0.0;
                foreach ($reference as $index => $duration) {
                    $referenceTime += $duration;
                    $candidateTime += $timeline[$index];
                    if (abs($referenceTime - $candidateTime) > 0.05) { throw new \RuntimeException(sprintf('HLS rendition boundary %d is not aligned within 50 ms.', $index)); }
                }
            }
        }
        if ($output->mode()->value() === 'master' && !is_file($stage . DIRECTORY_SEPARATOR . 'master.m3u8')) {
            throw new \RuntimeException('FFmpeg did not generate the requested master playlist.');
        }
        if ($output->mode()->value() === 'master') {
            $masterLines = file($stage . DIRECTORY_SEPARATOR . 'master.m3u8', FILE_IGNORE_NEW_LINES) ?: [];
            $streamInfoCount = 0;
            foreach ($masterLines as $index => $line) {
                if (strpos($line, '#EXT-X-STREAM-INF:') === 0) {
                    ++$streamInfoCount;
                    if (!preg_match('/(?:^|,)CODECS="[^"]+"/', substr($line, strlen('#EXT-X-STREAM-INF:')))) {
                        throw new \RuntimeException('Master playlist variant is missing its RFC 6381 CODECS attribute.');
                    }
                }
                if ($line === '' || $line[0] === '#') { continue; }
                if (!is_file($stage . DIRECTORY_SEPARATOR . $line)) { throw new \RuntimeException(sprintf('Master playlist references missing media playlist "%s".', $line)); }
            }
            if ($streamInfoCount !== count($output->renditions())) { throw new \RuntimeException('Master playlist variant count does not match the configured renditions.'); }
        }
    }

    private function rewriteMasterCodecs(string $masterPath, string $stage, HlsOutput $output, bool $hasAudio): void
    {
        $lines = file($masterPath, FILE_IGNORE_NEW_LINES);
        if ($lines === false) { throw new \RuntimeException('Unable to read generated master playlist for codec validation.'); }
        $renditionIndex = 0;
        foreach ($lines as &$line) {
            if (strpos($line, '#EXT-X-STREAM-INF:') !== 0) { continue; }
            $codecList = null;
            if ($output->videoCodec()->value() === 'hevc') {
                $rendition = $output->renditions()[$renditionIndex] ?? null;
                if ($rendition === null) { throw new \RuntimeException('Master playlist contains an unexpected rendition.'); }
                $initPath = $stage . DIRECTORY_SEPARATOR . 'v' . $rendition->id()->value() . DIRECTORY_SEPARATOR . 'init_' . $rendition->id()->value() . '.mp4';
                $codecList = (new HevcCodecStringResolver())->resolve($initPath, $this->ffprobeBinary);
            } elseif (preg_match('/(?:^|,)CODECS="([^"]+)"/', substr($line, strlen('#EXT-X-STREAM-INF:')), $codecMatch)) {
                $codecList = $codecMatch[1];
            }
            if ($codecList === null || $codecList === '') { throw new \RuntimeException('Unable to determine output codec string for a master playlist variant.'); }
            if ($hasAudio && strpos($codecList, 'mp4a.40.2') === false) { $codecList .= ',mp4a.40.2'; }
            $line = preg_replace('/(?:^|,)CODECS="[^"]*"/', '', $line);
            $line .= ',CODECS="' . $codecList . '"';
            ++$renditionIndex;
        }
        unset($line);
        if ($renditionIndex !== count($output->renditions())) { throw new \RuntimeException('Unable to match generated master playlist variants to configured renditions.'); }
        $contents = implode("\n", $lines) . "\n";
        if (file_put_contents($masterPath, $contents, LOCK_EX) !== strlen($contents)) { throw new \RuntimeException('Unable to write validated codec attributes to master playlist.'); }
    }

    private function toolVersion(string $binary): string
    {
        $process = new Process([$binary, '-version']);
        $process->run();
        if (!$process->isSuccessful()) { throw new \RuntimeException(sprintf('Unable to query tool version for "%s".', $binary)); }
        $lines = preg_split('/\r?\n/', trim($process->getOutput()));
        return $lines[0] ?? 'unknown';
    }

    private function formatFindings(VerificationReport $report): string
    {
        $messages = [];
        foreach ($report->findings() as $finding) {
            if ($finding->severity()->value() === 'error') { $messages[] = $finding->code() . ': ' . $finding->message(); }
        }
        return implode("\n", $messages);
    }

    private function removeTree(string $path): void
    {
        if (!is_dir($path)) { return; }
        foreach (scandir($path) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') { continue; }
            $child = $path . DIRECTORY_SEPARATOR . $entry;
            if (is_dir($child) && !is_link($child)) { $this->removeTree($child); } else { @unlink($child); }
        }
        @rmdir($path);
    }

    private function listFiles(string $directory): array
    {
        $files = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($directory, \FilesystemIterator::SKIP_DOTS)) as $file) {
            if ($file->isFile()) { $files[] = $file->getPathname(); }
        }
        sort($files);
        return $files;
    }
}
