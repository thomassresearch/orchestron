class BrowserClockProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options?.processorOptions ?? {};
    this.channels = Math.max(1, Number(processorOptions.channels) || 2);
    this.capacityFrames = Math.max(1, Number(processorOptions.capacityFrames) || 1);
    this.sampleBuffer = new Float32Array(processorOptions.sampleBuffer);
    this.stateBuffer = new Int32Array(processorOptions.stateBuffer);
    this.lowWaterFrames = 0;
    this.refillRequested = false;
    this.port.onmessage = (event) => {
      const message = event?.data;
      if (!message || message.type !== "set_refill_threshold") {
        return;
      }
      this.lowWaterFrames = Math.max(0, Number(message.low_water_frames) || 0);
      if (this.lowWaterFrames === 0) {
        this.refillRequested = false;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }

    const readFrame = Atomics.load(this.stateBuffer, 0);
    const writeFrame = Atomics.load(this.stateBuffer, 1);
    const availableFrames = Math.max(0, writeFrame - readFrame);
    const outputFrameCount = output[0]?.length ?? 0;
    const framesToConsume = Math.min(availableFrames, outputFrameCount);
    const channelCount = output.length;

    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      output[channelIndex].fill(0);
    }

    if (framesToConsume > 0) {
      let remainingFrames = framesToConsume;
      let outputOffset = 0;
      let ringFrame = readFrame % this.capacityFrames;

      if (channelCount === 2 && this.channels >= 2) {
        const left = output[0];
        const right = output[1];
        while (remainingFrames > 0) {
          const segmentFrames = Math.min(remainingFrames, this.capacityFrames - ringFrame);
          let sampleBase = ringFrame * this.channels;
          const segmentEnd = outputOffset + segmentFrames;
          for (let frameIndex = outputOffset; frameIndex < segmentEnd; frameIndex += 1) {
            left[frameIndex] = this.sampleBuffer[sampleBase];
            right[frameIndex] = this.sampleBuffer[sampleBase + 1];
            sampleBase += this.channels;
          }
          remainingFrames -= segmentFrames;
          outputOffset = segmentEnd;
          ringFrame = 0;
        }
      } else {
        while (remainingFrames > 0) {
          const segmentFrames = Math.min(remainingFrames, this.capacityFrames - ringFrame);
          let sampleBase = ringFrame * this.channels;
          const segmentEnd = outputOffset + segmentFrames;
          for (let frameIndex = outputOffset; frameIndex < segmentEnd; frameIndex += 1) {
            for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
              const sourceChannel = Math.min(channelIndex, this.channels - 1);
              output[channelIndex][frameIndex] = this.sampleBuffer[sampleBase + sourceChannel] ?? 0;
            }
            sampleBase += this.channels;
          }
          remainingFrames -= segmentFrames;
          outputOffset = segmentEnd;
          ringFrame = 0;
        }
      }
    }

    Atomics.store(this.stateBuffer, 0, readFrame + framesToConsume);
    const availableAfterConsume = Math.max(0, availableFrames - framesToConsume);
    if (framesToConsume < outputFrameCount) {
      Atomics.add(this.stateBuffer, 2, 1);
    }

    if (this.lowWaterFrames > 0) {
      if (availableAfterConsume > this.lowWaterFrames) {
        this.refillRequested = false;
      } else if (!this.refillRequested) {
        this.refillRequested = true;
        this.port.postMessage({
          type: "need_refill",
          available_frames: availableAfterConsume,
        });
      }
    }

    return true;
  }
}

registerProcessor("browser-clock-processor", BrowserClockProcessor);
