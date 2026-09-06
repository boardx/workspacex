import type { ModelCallInput, ModelCallPort } from "../agent-run/ports";
import { ResearchRuntimeError, type ResearchRuntime, type RuntimeObserver } from "./guided-runtime-ports";
export type RuntimePersistence = (() => Promise<void>) & { requestId: string; observe: RuntimeObserver };

// Provider fragments are persisted before publication. The observer never owns execution.
export async function streamReport(model: ModelCallPort, input: ModelCallInput, state: ResearchRuntime, persist: RuntimePersistence) {
  state.report = null;
  state.completed = false;
  state.generatedNodes = state.generatedNodes.filter((node) => node !== "report");
  state.reportStream = { requestId: persist.requestId, sequence: 0, text: "", status: "streaming" };
  await persist();
  persist.observe({ type: "snapshot", state: structuredClone(state) });
  let pending = "";
  let chain = Promise.resolve();
  let failure: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const delta = pending;
    pending = "";
    if (!delta) return chain;
    chain = chain.then(async () => {
      if (failure) throw failure;
      const progress = state.reportStream!;
      progress.text += delta;
      progress.sequence += 1;
      await persist();
      persist.observe({ type: "report_delta", sessionId: state.sessionId, requestId: persist.requestId, version: state.version, sequence: progress.sequence, delta });
    });
    // Timer-triggered writes must not create unhandled rejections.
    void chain.catch((error: unknown) => { failure = error; });
    return chain;
  };
  try {
    const result = model.completeStream ? await model.completeStream(input, async (delta) => {
      if (failure) throw failure;
      if (state.reportStream!.text.length + pending.length + delta.length > 1048576) throw new ResearchRuntimeError("RESEARCH_NODE_STATE_INVALID");
      pending += delta;
      if (!state.reportStream!.sequence || pending.length >= 2048) await flush();
      else if (!timer) timer = setTimeout(() => { void flush(); }, 250);
    }) : await model.complete(input);
    await flush();
    if (failure) throw failure;
    return result;
  } catch (error) {
    await flush().catch(() => undefined);
    state.reportStream!.status = "failed";
    throw error;
  } finally { if (timer) clearTimeout(timer); }
}
