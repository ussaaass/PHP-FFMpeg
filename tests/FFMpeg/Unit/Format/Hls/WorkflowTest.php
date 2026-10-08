<?php

namespace Tests\FFMpeg\Unit\Format\Hls;

use FFMpeg\Format\Hls\Workflow\HlsOutput;
use FFMpeg\Format\Hls\Workflow\AudioGain;
use FFMpeg\Format\Hls\Workflow\Crop;
use FFMpeg\Format\Hls\Workflow\FaststartNormalizer;
use FFMpeg\Format\Hls\Workflow\Mp4BoxInspector;
use FFMpeg\Format\Hls\Workflow\Rendition;
use FFMpeg\Format\Hls\Workflow\WorkflowPlan;
use FFMpeg\Format\Hls\Workflow\WorkflowRunner;
use FFMpeg\Format\Hls\Workflow\WorkflowVerifier;
use FFMpeg\Format\Hls\Workflow\Transpose;
use FFMpeg\Format\Hls\Workflow\Trim;
use FFMpeg\Format\Hls\Workflow\Rotation;
use FFMpeg\Format\Hls\Workflow\Timecode;
use FFMpeg\Format\Hls\Workflow\Value\ContainerPath;
use FFMpeg\Format\Hls\Workflow\Value\EncryptionProfile;
use FFMpeg\Format\Hls\Workflow\Value\InputId;
use FFMpeg\Format\Hls\Workflow\Value\RenditionId;
use FFMpeg\Format\Hls\Workflow\Value\SegmentContainer;
use FFMpeg\Format\Hls\Workflow\Value\VideoAssetId;
use FFMpeg\Format\Hls\Workflow\Value\VideoCodec;
use PHPUnit\Framework\TestCase;

final class WorkflowTest extends TestCase
{
    public function testTransformStepsExposeOnlyClosedTypedFilters(): void
    {
        self::assertSame('crop=640:360', Crop::centered(640, 360)->videoFilter());
        self::assertSame('transpose=1', Transpose::using(Rotation::clockwise())->videoFilter());
        self::assertSame('volume=-3dB', AudioGain::decibels(-3)->audioFilter());
        self::assertNull(AudioGain::decibels(2)->videoFilter());
        self::assertSame(['start' => 1.0, 'duration' => 2.0], Trim::between(Timecode::seconds(1), Timecode::seconds(3))->trim());
    }

    public function testAudioGainRejectsUnboundedAndNonFiniteValues(): void
    {
        foreach ([-60.01, 24.01, INF, NAN] as $gain) {
            try {
                AudioGain::decibels($gain);
                self::fail('Out-of-range and non-finite audio gain must be rejected.');
            } catch (\InvalidArgumentException $error) {
                self::assertStringContainsString('between -60 and 24 dB', $error->getMessage());
            }
        }
    }

    public function testFfmpegFailureLeavesNoPublishedOutputOrStagingDirectory(): void
    {
        $root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-workflow-failure-' . bin2hex(random_bytes(5));
        mkdir($root, 0700, true);
        $input = $root . DIRECTORY_SEPARATOR . 'input.bin';
        $tool = $root . DIRECTORY_SEPARATOR . 'fake-tool';
        $outputPath = $root . DIRECTORY_SEPARATOR . 'output';
        file_put_contents($input, 'test input');
        file_put_contents($tool, "#!/bin/sh\ncase \"\$*\" in\n  *-encoders*) echo libx264 ;;\n  *-muxers*) echo ' E hls HLS' ;;\n  *-version*) echo 'fake tool version' ;;\n  *-select_streams\\ a:0*) echo 1 ;;\n  *-select_streams\\ v:0*) echo 0 ;;\n  *-show_entries\\ stream=codec_type*) echo '{\"streams\":[{\"codec_type\":\"video\"}]}' ;;\n  *avg_frame_rate*) echo 24/1 ;;\n  *) echo 'injected ffmpeg failure' >&2; exit 7 ;;\nesac\n");
        chmod($tool, 0700);
        try {
            $output = HlsOutput::create(ContainerPath::from($outputPath))
                ->rendition(Rendition::create(RenditionId::named('360p'), 640, 360, 800000));
            $plan = WorkflowPlan::create()
                ->input(InputId::named('video'), ContainerPath::from($input))
                ->output($output);
            try {
                (new WorkflowRunner(null, $tool, $tool))->execute($plan);
                self::fail('Injected FFmpeg failure must abort workflow execution.');
            } catch (\RuntimeException $error) {
                self::assertStringContainsString('exit 7', $error->getMessage());
            }
            self::assertDirectoryDoesNotExist($outputPath);
            self::assertSame([], glob($root . DIRECTORY_SEPARATOR . '.output.clear-*') ?: []);
        } finally {
            @unlink($tool);
            @unlink($input);
            @rmdir($root);
        }
    }

    public function testSeparateTrackInputsAreRejectedBeforeToolProbes(): void
    {
        $root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-multiple-inputs-' . bin2hex(random_bytes(5));
        mkdir($root, 0700, true);
        $video = $root . DIRECTORY_SEPARATOR . 'video.bin';
        $audio = $root . DIRECTORY_SEPARATOR . 'audio.bin';
        $marker = $root . DIRECTORY_SEPARATOR . 'tool-started';
        $tool = $root . DIRECTORY_SEPARATOR . 'fake-tool';
        file_put_contents($video, 'video');
        file_put_contents($audio, 'audio');
        file_put_contents($tool, "#!/bin/sh\nprintf started >> " . escapeshellarg($marker) . "\nexit 0\n");
        chmod($tool, 0700);
        try {
            $output = HlsOutput::create(ContainerPath::from($root . DIRECTORY_SEPARATOR . 'output'))
                ->rendition(Rendition::create(RenditionId::named('360p'), 640, 360, 800000));
            $plan = WorkflowPlan::create()
                ->input(InputId::named('video'), ContainerPath::from($video))
                ->input(InputId::named('audio'), ContainerPath::from($audio))
                ->output($output);
            try {
                (new WorkflowRunner(null, $tool, $tool))->execute($plan);
                self::fail('Separate audio input must fail preflight.');
            } catch (\InvalidArgumentException $error) {
                self::assertStringContainsString('MULTIPLE_INPUTS_UNSUPPORTED', $error->getMessage());
            }
            self::assertFileDoesNotExist($marker);
        } finally {
            @unlink($marker);
            @unlink($tool);
            @unlink($video);
            @unlink($audio);
            @rmdir($root);
        }
    }

    public function testInputWithoutVideoStreamIsRejectedBeforeFfmpegCapabilityProbe(): void
    {
        $root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-video-probe-' . bin2hex(random_bytes(5));
        mkdir($root, 0700, true);
        $input = $root . DIRECTORY_SEPARATOR . 'audio-only.bin';
        $ffprobe = $root . DIRECTORY_SEPARATOR . 'fake-ffprobe';
        $ffmpeg = $root . DIRECTORY_SEPARATOR . 'fake-ffmpeg';
        $marker = $root . DIRECTORY_SEPARATOR . 'ffmpeg-started';
        file_put_contents($input, 'audio-only fixture');
        file_put_contents($ffprobe, "#!/bin/sh\ncase \"\$*\" in\n  *-version*) echo 'fake ffprobe version' ;;\n  *-show_entries\\ stream=codec_type*) echo '{\"streams\":[]}' ;;\n  *) exit 1 ;;\nesac\n");
        file_put_contents($ffmpeg, "#!/bin/sh\nprintf started >> " . escapeshellarg($marker) . "\nexit 0\n");
        chmod($ffprobe, 0700);
        chmod($ffmpeg, 0700);
        try {
            $output = HlsOutput::create(ContainerPath::from($root . DIRECTORY_SEPARATOR . 'output'))
                ->rendition(Rendition::create(RenditionId::named('360p'), 640, 360, 800000));
            $plan = WorkflowPlan::create()
                ->input(InputId::named('video'), ContainerPath::from($input))
                ->output($output);
            $report = (new WorkflowRunner(null, $ffmpeg, $ffprobe))->verify($plan);
            $codes = array_map(static function ($finding) { return $finding->code(); }, $report->findings());
            self::assertContains('VIDEO_STREAM_REQUIRED', $codes);
            self::assertFileDoesNotExist($marker);
        } finally {
            @unlink($marker);
            @unlink($ffprobe);
            @unlink($ffmpeg);
            @unlink($input);
            @rmdir($root);
        }
    }

    public function testUnsupportedEmbeddedTracksAreRejectedBeforeFfmpegCapabilityProbe(): void
    {
        $root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-subtitle-probe-' . bin2hex(random_bytes(5));
        mkdir($root, 0700, true);
        $input = $root . DIRECTORY_SEPARATOR . 'with-subtitle.bin';
        $ffprobe = $root . DIRECTORY_SEPARATOR . 'fake-ffprobe';
        $ffmpeg = $root . DIRECTORY_SEPARATOR . 'fake-ffmpeg';
        $marker = $root . DIRECTORY_SEPARATOR . 'ffmpeg-started';
        file_put_contents($input, 'unsupported embedded tracks fixture');
        file_put_contents($ffprobe, "#!/bin/sh\ncase \"\$*\" in\n  *-version*) echo 'fake ffprobe version' ;;\n  *-show_entries\\ stream=codec_type*) echo '{\"streams\":[{\"codec_type\":\"video\"},{\"codec_type\":\"video\"},{\"codec_type\":\"audio\"},{\"codec_type\":\"audio\"},{\"codec_type\":\"subtitle\"}]}' ;;\n  *) exit 1 ;;\nesac\n");
        file_put_contents($ffmpeg, "#!/bin/sh\nprintf started >> " . escapeshellarg($marker) . "\nexit 0\n");
        chmod($ffprobe, 0700);
        chmod($ffmpeg, 0700);
        try {
            $output = HlsOutput::create(ContainerPath::from($root . DIRECTORY_SEPARATOR . 'output'))
                ->rendition(Rendition::create(RenditionId::named('360p'), 640, 360, 800000));
            $plan = WorkflowPlan::create()
                ->input(InputId::named('video'), ContainerPath::from($input))
                ->output($output);
            $report = (new WorkflowRunner(null, $ffmpeg, $ffprobe))->verify($plan);
            $codes = array_map(static function ($finding) { return $finding->code(); }, $report->findings());
            self::assertContains('AUXILIARY_MEDIA_STREAMS_UNSUPPORTED', $codes);
            self::assertContains('MULTIPLE_VIDEO_STREAMS_UNSUPPORTED', $codes);
            self::assertFileDoesNotExist($marker);
        } finally {
            @unlink($marker);
            @unlink($ffprobe);
            @unlink($ffmpeg);
            @unlink($input);
            @rmdir($root);
        }
    }

    public function testPlanIsImmutableAndRejectsDuplicateInputIds(): void
    {
        $path = ContainerPath::from('/workspace/input.mp4');
        $empty = WorkflowPlan::create();
        $populated = $empty->input(InputId::named('video'), $path);

        self::assertSame([], $empty->inputs());
        self::assertSame('/workspace/input.mp4', $populated->inputs()['video']->value());
        $this->expectException(\InvalidArgumentException::class);
        $populated->input(InputId::named('video'), $path);
    }

    public function testWorkflowPlanCanBeSerializedAndRestoredWithoutChangingTypedSteps(): void
    {
        $plan = WorkflowPlan::create()
            ->input(InputId::named('video'), ContainerPath::from('/workspace/input.mp4'))
            ->step(AudioGain::decibels(-2.5))
            ->output(HlsOutput::create(ContainerPath::from('/workspace/output'))
                ->rendition(Rendition::create(RenditionId::named('720p'), 1280, 720, 2500000)));

        $restored = unserialize(serialize($plan));
        self::assertInstanceOf(WorkflowPlan::class, $restored);
        self::assertSame('/workspace/input.mp4', $restored->inputs()['video']->value());
        self::assertSame('volume=-2.5dB', $restored->steps()[0]->audioFilter());
        self::assertSame('720p', $restored->outputs()[0]->renditions()[0]->id()->value());
    }

    public function testContainerPathsAreAbsoluteAndCannotEscapeByParentTraversal(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        ContainerPath::from('/workspace/media/../secret.mp4');
    }

    public function testVerifierRejectsHevcTsAndRequiresAssetScopedCtrConfiguration(): void
    {
        $root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-workflow-' . bin2hex(random_bytes(5));
        mkdir($root, 0700, true);
        $input = $root . DIRECTORY_SEPARATOR . 'input.mp4';
        file_put_contents($input, 'fixture');
        try {
            $output = HlsOutput::create(ContainerPath::from($root . DIRECTORY_SEPARATOR . 'out'))
                ->codec(VideoCodec::hevc())
                ->segmentContainer(SegmentContainer::mpegTs())
                ->encryption(EncryptionProfile::ctrHmacV1())
                ->rendition(Rendition::create(RenditionId::named('720p'), 1280, 720, 2500000));
            $plan = WorkflowPlan::create()->input(InputId::named('video'), ContainerPath::from($input))->output($output);
            $report = (new WorkflowVerifier())->verify($plan);
            $codes = array_map(static function ($finding) { return $finding->code(); }, $report->findings());
            self::assertContains('HEVC_TS_UNSUPPORTED', $codes);
            self::assertContains('CTR_HMAC_REQUIRES_FMP4', $codes);
            self::assertContains('VIDEO_ASSET_ID_REQUIRED', $codes);
        } finally {
            @unlink($input);
            @rmdir($root);
        }
    }

    public function testMissingCtrKeyProviderBlocksBeforeStartingFfmpegOrFfprobe(): void
    {
        $root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-preflight-' . bin2hex(random_bytes(5));
        mkdir($root, 0700, true);
        $input = $root . DIRECTORY_SEPARATOR . 'input.mp4';
        $marker = $root . DIRECTORY_SEPARATOR . 'tool-started';
        $tool = $root . DIRECTORY_SEPARATOR . 'fake-tool';
        file_put_contents($input, pack('N', 8) . 'ftyp' . pack('N', 8) . 'moov' . pack('N', 8) . 'mdat');
        file_put_contents($tool, "#!/bin/sh\nprintf started >> " . escapeshellarg($marker) . "\nexit 0\n");
        chmod($tool, 0700);
        try {
            $output = HlsOutput::create(ContainerPath::from($root . DIRECTORY_SEPARATOR . 'output'))
                ->asset(VideoAssetId::named('test-video'))
                ->encryption(EncryptionProfile::ctrHmacV1())
                ->rendition(Rendition::create(RenditionId::named('360p'), 640, 360, 800000));
            $plan = WorkflowPlan::create()
                ->input(InputId::named('video'), ContainerPath::from($input))
                ->output($output);
            try {
                (new WorkflowRunner(null, $tool, $tool))->execute($plan);
                self::fail('Execution should reject encrypted HLS without application key services.');
            } catch (\InvalidArgumentException $error) {
                self::assertStringContainsString('KEY_PROVIDER_REQUIRED', $error->getMessage());
            }
            self::assertFileDoesNotExist($marker);
        } finally {
            @unlink($marker);
            @unlink($tool);
            @unlink($input);
            @rmdir($root);
        }
    }

    public function testInspectorRecognizesMoovBeforeMdatIncludingExtendedBoxSizes(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'mp4-box-');
        $extendedMoov = pack('N', 1) . 'moov' . pack('N2', 0, 16);
        file_put_contents($path, pack('N', 8) . 'ftyp' . $extendedMoov . pack('N', 8) . 'mdat');
        try {
            $result = (new Mp4BoxInspector())->inspect($path);
            self::assertTrue($result['faststart']);
            self::assertSame(['ftyp', 'moov', 'mdat'], $result['boxes']);
        } finally {
            @unlink($path);
        }
    }

    public function testInspectorAcceptsSizeZeroForTheFinalTopLevelBox(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'mp4-box-');
        file_put_contents($path, pack('N', 8) . 'ftyp' . pack('N', 8) . 'moov' . pack('N', 0) . 'mdat' . 'payload');
        try {
            $result = (new Mp4BoxInspector())->inspect($path);
            self::assertTrue($result['faststart']);
            self::assertSame(['ftyp', 'moov', 'mdat'], $result['boxes']);
        } finally {
            @unlink($path);
        }
    }

    public function testInspectorRecognizesValidNonFaststartAndRejectsMissingRequiredBoxes(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'mp4-box-');
        try {
            file_put_contents($path, pack('N', 8) . 'ftyp' . pack('N', 8) . 'mdat' . pack('N', 8) . 'moov');
            self::assertFalse((new Mp4BoxInspector())->inspect($path)['faststart']);

            file_put_contents($path, pack('N', 8) . 'ftyp' . pack('N', 8) . 'mdat');
            $this->expectException(\UnexpectedValueException::class);
            (new Mp4BoxInspector())->inspect($path);
        } finally {
            @unlink($path);
        }
    }

    public function testInspectorRejectsMissingMdat(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'mp4-box-');
        try {
            file_put_contents($path, pack('N', 8) . 'ftyp' . pack('N', 8) . 'moov');
            $this->expectException(\UnexpectedValueException::class);
            (new Mp4BoxInspector())->inspect($path);
        } finally {
            @unlink($path);
        }
    }

    public function testInspectorRejectsTruncatedExtendedHeader(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'mp4-box-');
        try {
            file_put_contents($path, pack('N', 1) . 'moov' . pack('N', 0));
            $this->expectException(\UnexpectedValueException::class);
            (new Mp4BoxInspector())->inspect($path);
        } finally {
            @unlink($path);
        }
    }

    public function testInspectorRejectsSizeZeroBoxBeforeEndOfFile(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'mp4-box-');
        try {
            file_put_contents($path, pack('N', 0) . 'ftyp' . pack('N', 8) . 'moov' . pack('N', 8) . 'mdat');
            $this->expectException(\UnexpectedValueException::class);
            (new Mp4BoxInspector())->inspect($path);
        } finally {
            @unlink($path);
        }
    }

    public function testFaststartNormalizerReturnsAlreadyNormalizedSourceWithoutCallingFfmpeg(): void
    {
        $root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-faststart-' . bin2hex(random_bytes(5));
        mkdir($root, 0700, true);
        $source = $root . DIRECTORY_SEPARATOR . 'already-faststart.mp4';
        file_put_contents($source, pack('N', 8) . 'ftyp' . pack('N', 8) . 'moov' . pack('N', 8) . 'mdat');
        $before = hash_file('sha256', $source);
        try {
            $normalized = (new FaststartNormalizer(null, 'ffmpeg-must-not-be-called'))
                ->normalize($source, $root);
            self::assertSame(realpath($source), $normalized);
            self::assertSame($before, hash_file('sha256', $source));
            self::assertSame([$source], glob($root . DIRECTORY_SEPARATOR . '*.mp4'));
        } finally {
            @unlink($source);
            @rmdir($root);
        }
    }

    public function testFaststartNormalizerFallsBackToTranscodeWhenStreamCopyRemuxFails(): void
    {
        $root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-faststart-fallback-' . bin2hex(random_bytes(5));
        mkdir($root, 0700, true);
        $source = $root . DIRECTORY_SEPARATOR . 'non-faststart.mp4';
        $tool = $root . DIRECTORY_SEPARATOR . 'fake-ffmpeg';
        $marker = $root . DIRECTORY_SEPARATOR . 'remux-attempted';
        $trace = $root . DIRECTORY_SEPARATOR . 'arguments.log';
        file_put_contents($source, pack('N', 8) . 'ftyp' . pack('N', 12) . 'mdat' . 'data' . pack('N', 8) . 'moov');
        $sourceHash = hash_file('sha256', $source);
        file_put_contents($tool, "#!/bin/sh\nif [ ! -f " . escapeshellarg($marker) . " ]; then touch " . escapeshellarg($marker) . "; echo \"\$*\" >> " . escapeshellarg($trace) . "; echo remux-failed >&2; exit 7; fi\necho \"\$*\" >> " . escapeshellarg($trace) . "\nfor argument do target=\$argument; done\nprintf '\\000\\000\\000\\010ftyp\\000\\000\\000\\010moov\\000\\000\\000\\010mdat' > \"\$target\"\n");
        chmod($tool, 0700);
        try {
            $normalized = (new FaststartNormalizer(null, $tool))->normalize($source, $root);
            self::assertNotSame(realpath($source), $normalized);
            self::assertTrue((new Mp4BoxInspector())->inspect($normalized)['faststart']);
            self::assertSame($sourceHash, hash_file('sha256', $source));
            $arguments = file_get_contents($trace);
            self::assertStringContainsString('-c copy', $arguments);
            self::assertStringContainsString('libx264', $arguments);
        } finally {
            foreach (glob($root . DIRECTORY_SEPARATOR . '*') ?: [] as $file) { @unlink($file); }
            @rmdir($root);
        }
    }

    public function testFaststartNormalizerFailsClearlyOnMalformedInputBeforeRemux(): void
    {
        $root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'phpffmpeg-faststart-' . bin2hex(random_bytes(5));
        mkdir($root, 0700, true);
        $source = $root . DIRECTORY_SEPARATOR . 'truncated.mp4';
        file_put_contents($source, pack('N', 128) . 'mdat');
        try {
            $this->expectException(\UnexpectedValueException::class);
            (new FaststartNormalizer(null, 'ffmpeg-must-not-be-called'))->normalize($source, $root);
        } finally {
            @unlink($source);
            @rmdir($root);
        }
    }

    public function testInspectorRejectsTruncatedTopLevelBox(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'mp4-box-');
        file_put_contents($path, pack('N', 100) . 'mdat');
        try {
            $this->expectException(\UnexpectedValueException::class);
            (new Mp4BoxInspector())->inspect($path);
        } finally {
            @unlink($path);
        }
    }

    public function testInspectorRejectsOutOfBoundsTopLevelBox(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'mp4-box-');
        file_put_contents($path, pack('N', 9) . 'mdat');
        try {
            $this->expectException(\UnexpectedValueException::class);
            (new Mp4BoxInspector())->inspect($path);
        } finally {
            @unlink($path);
        }
    }
}
