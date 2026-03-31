class BrowserClockProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const processorOptions = options?.processorOptions ?? {};
    this.channels = Math.max(1, Number(processorOptions.channels) || 2);
    this.capacityFrames = Math.max(1, Number(processorOptions.capacityFrames) || 1);
    this.sampleBuffer = new Float32Array(processorOptions.sampleBuffer);
    this.stateBuffer = new Int32Array(processorOptions.stateBuffer);
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

    for (let frameIndex = 0; frameIndex < outputFrameCount; frameIndex += 1) {
      if (frameIndex < framesToConsume) {
        const ringFrame = (readFrame + frameIndex) % this.capacityFrames;
        const sampleBase = ringFrame * this.channels;
        for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
          const sourceChannel = Math.min(channelIndex, this.channels - 1);
          output[channelIndex][frameIndex] = this.sampleBuffer[sampleBase + sourceChannel] ?? 0;
        }
        continue;
      }

      for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
        output[channelIndex][frameIndex] = 0;
      }
    }

    Atomics.store(this.stateBuffer, 0, readFrame + framesToConsume);
    if (framesToConsume < outputFrameCount) {
      Atomics.add(this.stateBuffer, 2, 1);
    }

    return true;
  }
}

registerProcessor("browser-clock-processor", BrowserClockProcessor);
