<?php

namespace FFMpeg\Format\Hls\Workflow;

use FFMpeg\Format\Hls\Workflow\Value\InputId;
use FFMpeg\Format\Hls\Workflow\Value\ContainerPath;

/** Immutable collection of workflow inputs and outputs. */
final class WorkflowPlan
{
    /** @var array<string, ContainerPath> */
    private $inputs;
    /** @var array<int, object> */
    private $steps;
    /** @var array<int, object> */
    private $outputs;

    private function __construct(array $inputs = [], array $steps = [], array $outputs = [])
    {
        $this->inputs = $inputs;
        $this->steps = $steps;
        $this->outputs = $outputs;
    }

    public static function create(): self { return new self(); }

    public function input(InputId $id, ContainerPath $path): self
    {
        $key = $id->value();
        if (isset($this->inputs[$key])) {
            throw new \InvalidArgumentException(sprintf('Input ID "%s" is already defined.', $key));
        }
        $inputs = $this->inputs;
        $inputs[$key] = $path;
        return new self($inputs, $this->steps, $this->outputs);
    }

    public function step(WorkflowStepInterface $step): self
    {
        $steps = $this->steps;
        $steps[] = $step;
        return new self($this->inputs, $steps, $this->outputs);
    }

    public function output(object $output): self
    {
        $outputs = $this->outputs;
        $outputs[] = $output;
        return new self($this->inputs, $this->steps, $outputs);
    }

    /** @return array<string, ContainerPath> */
    public function inputs(): array { return $this->inputs; }
    /** @return object[] */
    public function steps(): array { return $this->steps; }
    /** @return object[] */
    public function outputs(): array { return $this->outputs; }
}
