<?php

namespace FFMpeg\Format\Hls\Workflow;

use FFMpeg\Format\Hls\Workflow\Value\FindingSeverity;

final class WorkflowVerifier
{
    public function verify(WorkflowPlan $plan): VerificationReport
    {
        $findings = [];
        if ($plan->inputs() === []) {
            $findings[] = new Finding('INPUT_REQUIRED', FindingSeverity::error(), 'At least one media input is required.', 'inputs', 'Add a typed media input.');
        }
        if (count($plan->inputs()) > 1) {
            $findings[] = new Finding('MULTIPLE_INPUTS_UNSUPPORTED', FindingSeverity::error(), 'The first-release workflow accepts one video input with optional embedded audio; separate audio/subtitle inputs are not supported.', 'inputs', 'Provide one video file with embedded audio, or package separate tracks outside this workflow.');
        }
        if ($plan->outputs() === []) {
            $findings[] = new Finding('OUTPUT_REQUIRED', FindingSeverity::error(), 'At least one HLS output is required.', 'outputs', 'Add an HlsOutput.');
        }
        foreach ($plan->inputs() as $id => $path) {
            if (!is_file($path->value()) || !is_readable($path->value())) {
                $findings[] = new Finding('INPUT_NOT_READABLE', FindingSeverity::error(), 'Input is not a readable file in the current container.', 'inputs.' . $id, 'Check the Docker bind mount and container path.');
            }
        }
        $seen = [];
        foreach ($plan->outputs() as $index => $output) {
            if (!$output instanceof HlsOutput) {
                $findings[] = new Finding('OUTPUT_TYPE_UNSUPPORTED', FindingSeverity::error(), 'Workflow output must be an HlsOutput.', 'outputs.' . $index);
                continue;
            }
            $directory = rtrim($output->directory()->value(), DIRECTORY_SEPARATOR);
            if (isset($seen[$directory])) {
                $findings[] = new Finding('OUTPUT_PATH_COLLISION', FindingSeverity::error(), 'Multiple outputs target the same directory.', 'outputs.' . $index, 'Choose unique output directories.');
            }
            $seen[$directory] = true;
            $versioned = $output->publicationMode()->value() === 'versioned';
            if (file_exists($directory) && (!$versioned || !is_dir($directory) || !is_writable($directory))) {
                $findings[] = new Finding('OUTPUT_PATH_EXISTS', FindingSeverity::error(), 'Output directory already exists or is not writable for the selected publication mode.', 'outputs.' . $index, 'Use a new directory or a writable versioned output root.');
            }
            if ($versioned && is_dir($directory) && is_file($directory . DIRECTORY_SEPARATOR . 'current.json')) {
                $pointer = json_decode((string) file_get_contents($directory . DIRECTORY_SEPARATOR . 'current.json'), true);
                $versionId = is_array($pointer) ? ($pointer['version'] ?? null) : null;
                $expectedDirectory = is_string($versionId) ? 'versions/' . $versionId : null;
                if (!is_string($versionId) || !preg_match('/^[A-Za-z0-9TZ-]+$/', $versionId)
                    || ($pointer['directory'] ?? null) !== $expectedDirectory
                    || !is_dir($directory . DIRECTORY_SEPARATOR . $expectedDirectory)) {
                    $findings[] = new Finding('CURRENT_VERSION_POINTER_INVALID', FindingSeverity::error(), 'The existing current-version pointer does not reference a published version directory.', 'outputs.' . $index, 'Repair the pointer or select a new output root.');
                }
            }
            $parent = dirname($directory);
            if (!is_dir($parent) || !is_writable($parent)) {
                $findings[] = new Finding('OUTPUT_PARENT_NOT_WRITABLE', FindingSeverity::error(), 'Output parent directory must exist and be writable.', 'outputs.' . $index, 'Create or mount a writable parent directory in Docker.');
            }
            if ($output->videoCodec()->value() === 'hevc' && $output->container()->value() === 'mpegts') {
                $findings[] = new Finding('HEVC_TS_UNSUPPORTED', FindingSeverity::error(), 'The configured HEVC plus MPEG-TS delivery profile is not supported by this workflow.', 'outputs.' . $index, 'Use fragmented MP4 segments.');
            }
            if ($output->encryptionProfile()->value() === 'phpffmpeg-ctr-hmac-v1' && $output->container()->value() !== 'fmp4') {
                $findings[] = new Finding('CTR_HMAC_REQUIRES_FMP4', FindingSeverity::error(), 'CTR/HMAC V1 accepts fMP4 media segments only.', 'outputs.' . $index, 'Select the fMP4 segment container.');
            }
            if ($output->encryptionProfile()->value() === 'phpffmpeg-ctr-hmac-v1' && $output->assetId() === null) {
                $findings[] = new Finding('VIDEO_ASSET_ID_REQUIRED', FindingSeverity::error(), 'CTR/HMAC requires a stable video asset ID for the fixed-key contract.', 'outputs.' . $index, 'Set the output asset ID.');
            }
            if ($output->encryptionProfile()->value() === 'phpffmpeg-ctr-hmac-v1' && $output->mode()->value() !== 'master') {
                $findings[] = new Finding('CTR_HMAC_REQUIRES_MASTER_PLAYLIST', FindingSeverity::error(), 'The current CTR/HMAC publication API requires a master playlist.', 'outputs.' . $index, 'Select master playlist mode.');
            }
            if ($versioned && $output->encryptionProfile()->value() !== 'phpffmpeg-ctr-hmac-v1') {
                $findings[] = new Finding('VERSIONED_PUBLICATION_REQUIRES_CTR_HMAC', FindingSeverity::error(), 'Versioned publication is currently supported only for the CTR/HMAC HLS packager.', 'outputs.' . $index, 'Select the CTR/HMAC profile or directory publication mode.');
            }
            if ($output->renditions() === []) {
                $findings[] = new Finding('RENDITION_REQUIRED', FindingSeverity::error(), 'At least one rendition must be configured.', 'outputs.' . $index, 'Add one or more typed renditions.');
            }
            if ($output->mode()->value() === 'media' && count($output->renditions()) !== 1) {
                $findings[] = new Finding('MEDIA_PLAYLIST_REQUIRES_ONE_RENDITION', FindingSeverity::error(), 'A media playlist output must contain exactly one rendition.', 'outputs.' . $index);
            }
        }
        $trimCount = 0;
        foreach ($plan->steps() as $stepIndex => $step) {
            if (!$step instanceof WorkflowStepInterface) {
                $findings[] = new Finding('STEP_TYPE_UNSUPPORTED', FindingSeverity::error(), 'Workflow step does not implement the typed workflow-step contract.', 'steps.' . $stepIndex);
                continue;
            }
            if ($step->trim() !== null) { ++$trimCount; }
        }
        if ($trimCount > 1) {
            $findings[] = new Finding('MULTIPLE_TRIMS_UNSUPPORTED', FindingSeverity::error(), 'Only one trim operation is supported per workflow.', 'steps', 'Combine the requested interval into one trim step.');
        }
        return new VerificationReport($findings);
    }
}
