<?php

namespace Tests\FFMpeg\Unit\Driver;

use Alchemy\BinaryDriver\Configuration;
use FFMpeg\Driver\FFMpegDriver;
use Symfony\Component\Process\ExecutableFinder;
use Tests\FFMpeg\Unit\TestCase;

class FFMpegDriverTest extends TestCase
{
    public function setUp(): void
    {
        $executableFinder = new ExecutableFinder();

        $found = false;
        foreach (['avconv', 'ffmpeg'] as $name) {
            if (null !== $executableFinder->find($name)) {
                $found = true;
                break;
            }
        }

        if (!$found) {
            $this->markTestSkipped('Neither ffmpeg or avconv found');
        }
    }

    public function testCreate()
    {
        $logger = $this->getLoggerMock();
        $ffmpeg = FFMpegDriver::create($logger, []);
        $this->assertInstanceOf('FFMpeg\Driver\FFMpegDriver', $ffmpeg);
        $this->assertEquals($logger, $ffmpeg->getProcessRunner()->getLogger());
    }

    public function testCreateWithConfig()
    {
        $conf = new Configuration();
        $ffmpeg = FFMpegDriver::create($this->getLoggerMock(), $conf);
        $this->assertEquals($conf, $ffmpeg->getConfiguration());
    }

    public function testCreateFailureThrowsAnException()
    {
        $this->expectException('\FFMpeg\Exception\ExecutableNotFoundException');
        FFMpegDriver::create($this->getLoggerMock(), ['ffmpeg.binaries' => '/path/to/nowhere']);
    }

    public function testGetVersionNumberNormalizesTaggedBuildVersion()
    {
        $ffmpeg = $this->getMockBuilder(FFMpegDriver::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['getVersion'])
            ->getMock();
        $ffmpeg->method('getVersion')->willReturn('n9.0.2-14-gebafaee10a-20260928');

        $this->assertSame('9.0.2', $ffmpeg->getVersionNumber());
    }

    public function testGetVersionNumberNormalizesDistributionSuffix()
    {
        $ffmpeg = $this->getMockBuilder(FFMpegDriver::class)
            ->disableOriginalConstructor()
            ->onlyMethods(['getVersion'])
            ->getMock();
        $ffmpeg->method('getVersion')->willReturn('5.1.9-0+deb12u1');

        $this->assertSame('5.1.9', $ffmpeg->getVersionNumber());
    }
}
