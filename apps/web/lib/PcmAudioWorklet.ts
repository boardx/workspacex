import { LiveRecordingError, classifyMediaError } from "./live-recording";

export const PCM_WORKLET_PROCESSOR_NAME = "boardx-pcm16-processor";
export const PCM_TARGET_SAMPLE_RATE = 16_000;

/** Pure conversion helper shared by the worklet algorithm and deterministic tests. */
export function downsampleToPcm16Le(
  channels: readonly Float32Array[],
  sourceRate: number,
  targetRate = PCM_TARGET_SAMPLE_RATE,
): ArrayBuffer {
  if (channels.length === 0 || channels[0]?.length === 0 || sourceRate <= 0 || targetRate <= 0) {
    return new ArrayBuffer(0);
  }
  const inputLength = Math.min(...channels.map((channel) => channel.length));
  const ratio = sourceRate / targetRate;
  const outputLength = Math.floor(inputLength / Math.max(1, ratio));
  const bytes = new ArrayBuffer(outputLength * 2);
  const view = new DataView(bytes);
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = Math.min(inputLength - 1, Math.floor(index * ratio));
    let mono = 0;
    for (const channel of channels) mono += channel[sourceIndex] ?? 0;
    mono = Math.max(-1, Math.min(1, mono / channels.length));
    const pcm = mono < 0 ? Math.round(mono * 0x8000) : Math.round(mono * 0x7fff);
    view.setInt16(index * 2, pcm, true);
  }
  return bytes;
}

/** Self-contained module loaded through audioWorklet.addModule(). */
export const PCM_AUDIO_WORKLET_SOURCE = `
class BoardxPcm16Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sourceIndex = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0 || channels[0].length === 0) return true;
    const inputLength = Math.min(...channels.map((channel) => channel.length));
    const ratio = sampleRate / ${PCM_TARGET_SAMPLE_RATE};
    const values = [];
    while (this.sourceIndex < inputLength) {
      const sourceIndex = Math.min(inputLength - 1, Math.floor(this.sourceIndex));
      let mono = 0;
      for (const channel of channels) mono += channel[sourceIndex] || 0;
      mono = Math.max(-1, Math.min(1, mono / channels.length));
      values.push(mono < 0 ? Math.round(mono * 0x8000) : Math.round(mono * 0x7fff));
      this.sourceIndex += Math.max(1, ratio);
    }
    this.sourceIndex -= inputLength;
    const bytes = new ArrayBuffer(values.length * 2);
    const view = new DataView(bytes);
    for (let index = 0; index < values.length; index += 1) view.setInt16(index * 2, values[index], true);
    if (bytes.byteLength > 0) this.port.postMessage(bytes, [bytes]);
    return true;
  }
}
registerProcessor("${PCM_WORKLET_PROCESSOR_NAME}", BoardxPcm16Processor);
`;

export interface PcmAudioWorkletHandle {
  readonly sourceSampleRate: number;
  onFrame(listener: (frame: ArrayBuffer) => void): void;
  stop(): Promise<void>;
}

export async function startPcmAudioWorklet(): Promise<PcmAudioWorkletHandle> {
  if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
    throw new LiveRecordingError({ kind: "capture-failed", message: "当前浏览器不支持麦克风采音。" });
  }
  let stream: MediaStream;
  try {
    stream = await globalThis.navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    throw new LiveRecordingError(classifyMediaError(error));
  }
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((track) => track.stop());
    throw new LiveRecordingError({ kind: "no-microphone", message: "没有找到可用的麦克风设备。" });
  }

  const AudioContextConstructor = globalThis.AudioContext
    ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor || typeof AudioWorkletNode === "undefined") {
    stream.getTracks().forEach((track) => track.stop());
    throw new LiveRecordingError({ kind: "capture-failed", message: "当前浏览器不支持 AudioWorklet 采音。" });
  }

  const context = new AudioContextConstructor();
  const source = context.createMediaStreamSource(stream);
  const moduleUrl = URL.createObjectURL(new Blob([PCM_AUDIO_WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } catch (error) {
    source.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await context.close();
    throw new LiveRecordingError(classifyMediaError(error));
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }

  const node = new AudioWorkletNode(context, PCM_WORKLET_PROCESSOR_NAME, {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
  });
  const silentGain = context.createGain();
  silentGain.gain.value = 0;
  source.connect(node);
  node.connect(silentGain);
  silentGain.connect(context.destination);
  const listeners = new Set<(frame: ArrayBuffer) => void>();
  node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    if (!(event.data instanceof ArrayBuffer) || event.data.byteLength === 0) return;
    for (const listener of listeners) listener(event.data);
  };

  return {
    sourceSampleRate: context.sampleRate,
    onFrame: (listener) => listeners.add(listener),
    stop: async () => {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      silentGain.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
    },
  };
}
