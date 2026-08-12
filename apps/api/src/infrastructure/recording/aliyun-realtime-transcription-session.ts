export interface FunAsrHandlers {
  onReady?(): void;
  onInterim(text: string): void;
  onFinal(result: { text: string; startMs: number; endMs: number }): void;
  onError(detail: string): void;
}
export interface FunAsrWire { taskId: string; model: string; send(value: string | Uint8Array): void; close(): void; }
type ProviderFrame = { header?: { event?: string; task_id?: string; error_message?: string }; payload?: {
  output?: { sentence?: { text?: string; begin_time?: number; end_time?: number; sentence_end?: boolean } };
  usage?: { duration?: number };
} };

export class FunAsrProtocolSession {
  private state: "created" | "starting" | "running" | "finishing" | "finished" | "failed" = "created";
  private readonly pending: Uint8Array[] = [];
  private finishResolve?: (usage: { durationSeconds: number }) => void;
  private finishReject?: (error: Error) => void;
  private startTimer: ReturnType<typeof setTimeout> | undefined;
  private finishTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly wire: FunAsrWire, private readonly handlers: FunAsrHandlers,
    private readonly timeouts = { startMs: 10_000, finishMs: 15_000 }) {}
  get taskId(): string { return this.wire.taskId; }
  start(): void {
    if (this.state !== "created") throw new Error("Fun-ASR task already started");
    this.state = "starting";
    this.wire.send(JSON.stringify({ header: { action: "run-task", task_id: this.wire.taskId, streaming: "duplex" },
      payload: { task_group: "audio", task: "asr", function: "recognition", model: this.wire.model,
        parameters: { format: "pcm", sample_rate: 16000 }, input: {} } }));
    this.startTimer = setTimeout(() => this.fail("Fun-ASR task start timed out"), this.timeouts.startMs);
  }
  pushAudio(frame: Uint8Array): void {
    if (this.state === "starting") { this.pending.push(frame); return; }
    if (this.state !== "running") throw new Error("Fun-ASR task is not accepting audio");
    this.wire.send(frame);
  }
  accept(frame: ProviderFrame): void {
    const event = frame.header?.event;
    if (event === "task-started" && this.state === "starting") {
      clearTimeout(this.startTimer);
      this.state = "running"; this.handlers.onReady?.(); for (const audio of this.pending.splice(0)) this.wire.send(audio); return;
    }
    if (event === "result-generated") {
      const sentence = frame.payload?.output?.sentence; const text = sentence?.text?.trim() ?? "";
      if (!text) return;
      if (sentence?.sentence_end) this.handlers.onFinal({ text, startMs: sentence.begin_time ?? 0, endMs: sentence.end_time ?? 0 });
      else this.handlers.onInterim(text);
      return;
    }
    if (event === "task-finished" && this.state === "finishing") {
      clearTimeout(this.finishTimer); this.state = "finished"; this.finishResolve?.({ durationSeconds: frame.payload?.usage?.duration ?? 0 }); this.wire.close(); return;
    }
    if (event === "task-failed") this.fail(frame.header?.error_message ?? "Fun-ASR task failed");
  }
  finish(): Promise<{ durationSeconds: number }> {
    if (this.state !== "running") return Promise.reject(new Error("Fun-ASR task is not running"));
    this.state = "finishing";
    this.wire.send(JSON.stringify({ header: { action: "finish-task", task_id: this.wire.taskId, streaming: "duplex" }, payload: { input: {} } }));
    return new Promise((resolve, reject) => { this.finishResolve = resolve; this.finishReject = reject;
      this.finishTimer = setTimeout(() => this.fail("Fun-ASR task finish timed out"), this.timeouts.finishMs); });
  }
  abort(): void { this.fail("Fun-ASR task aborted"); }
  private fail(detail: string): void { if(this.state==="failed"||this.state==="finished")return;
    clearTimeout(this.startTimer);clearTimeout(this.finishTimer);this.state = "failed"; this.handlers.onError(detail); this.finishReject?.(new Error(detail)); this.wire.close(); }
}
