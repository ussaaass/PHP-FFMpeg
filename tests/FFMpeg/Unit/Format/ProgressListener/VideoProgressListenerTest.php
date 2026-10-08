<?php

namespace Tests\FFMpeg\Unit\Format\ProgressListener;

use FFMpeg\FFProbe\DataMapping\Format;
use FFMpeg\Format\ProgressListener\VideoProgressListener;
use Tests\FFMpeg\Unit\TestCase;

class VideoProgressListenerTest extends TestCase
{
    /**
     * @dataProvider provideData
     */
    public function testHandle(
        $size,
        $duration,
        $newVideoDuration,
        $data,
        $expectedPercent,
        $expectedRemaining,
        $expectedRate,
        $data2,
        $expectedPercent2,
        $expectedRemaining2,
        $expectedRate2,
        $currentPass,
        $totalPass
    ) {
        $ffprobe = $this->getFFProbeMock();
        $ffprobe->expects($this->once())
            ->method('format')
            ->with(__FILE__)
            ->will($this->returnValue(new Format([
                'size' => $size,
                'duration' => $duration,
            ])));

        $listener = new class($ffprobe, __FILE__, $currentPass, $totalPass, $newVideoDuration) extends VideoProgressListener {
            private $timestamps = [100.0, 101.0, 102.0];

            protected function getClockTime(): float
            {
                return array_shift($this->timestamps);
            }
        };
        $phpunit = $this;
        $n = 0;
        $listener->on('progress', function ($percent, $remaining, $rate) use (&$n, $phpunit, $expectedPercent, $expectedRemaining, $expectedRate, $expectedPercent2, $expectedRemaining2, $expectedRate2) {
            if (0 === $n) {
                $phpunit->assertEquals($expectedPercent, $percent);
                $phpunit->assertEquals($expectedRemaining, $remaining);
                $phpunit->assertEquals($expectedRate, $rate);
            } elseif (1 === $n) {
                $phpunit->assertEquals($expectedPercent2, $percent);
                $phpunit->assertEquals($expectedRemaining2, $remaining);
                $phpunit->assertLessThan($expectedRate2 + 10, $rate);
                $phpunit->assertGreaterThan($expectedRate2 - 10, $rate);
            }
            ++$n;
        });
        // first one does not trigger progress event
        $listener->handle('any-type'.mt_rand(), $data);
        $listener->handle('any-type'.mt_rand(), $data);
        $listener->handle('any-type'.mt_rand(), $data2);
        $this->assertEquals(2, $n);
    }

    public function testProgressDoesNotMoveBackWhenFfmpegReportsAnEarlierTimestamp()
    {
        $ffprobe = $this->getFFProbeMock();
        $ffprobe->expects($this->once())
            ->method('format')
            ->with(__FILE__)
            ->will($this->returnValue(new Format([
                'size' => 102400,
                'duration' => 10,
            ])));

        $listener = new class($ffprobe, __FILE__, 1, 1) extends VideoProgressListener {
            private $timestamps = [100.0, 101.0, 102.0];

            protected function getClockTime(): float
            {
                return array_shift($this->timestamps);
            }
        };
        $progress = [];
        $listener->on('progress', function ($percent) use (&$progress) {
            $progress[] = $percent;
        });

        $listener->handle('err', 'frame= 10 fps=10 q=1.0 size=     100kB time=00:00:02.00 bitrate=1kbits/s');
        $listener->handle('err', 'frame= 20 fps=10 q=1.0 size=     200kB time=00:00:08.00 bitrate=1kbits/s');
        $listener->handle('err', 'frame= 15 fps=10 q=1.0 size=     250kB time=00:00:05.00 bitrate=1kbits/s');

        $this->assertSame([80.0, 80.0], $progress);
        $this->assertSame(8.0, $listener->getCurrentTime());
    }

    public static function provideData()
    {
        return [
            [
                147073958,
                281.147533,
                281.147533,
                'frame=  206 fps=202 q=10.0 size=     571kB time=00:00:07.12 bitrate= 656.8kbits/s dup=9 drop=0',
                2,
                0,
                0,
                'frame=  854 fps=113 q=20.0 size=    4430kB time=00:00:33.04 bitrate=1098.5kbits/s dup=36 drop=0',
                11,
                32,
                3868,
                1,
                1,
            ],
            [
                147073958,
                281.147533,
                281.147533,
                'frame=  206 fps=202 q=10.0 size=     571kB time=00:00:07.12 bitrate= 656.8kbits/s dup=9 drop=0',
                1,
                0,
                0,
                'frame=  854 fps=113 q=20.0 size=    4430kB time=00:00:33.04 bitrate=1098.5kbits/s dup=36 drop=0',
                5,
                32,
                3868,
                1,
                2,
            ],
            [
                147073958,
                281.147533,
                35,
                'frame=  206 fps=202 q=10.0 size=     571kB time=00:00:07.12 bitrate= 656.8kbits/s dup=9 drop=0',
                60,
                0,
                0,
                'frame=  854 fps=113 q=20.0 size=    4430kB time=00:00:33.04 bitrate=1098.5kbits/s dup=36 drop=0',
                97,
                0,
                3868,
                2,
                2,
            ],
        ];
    }
}
