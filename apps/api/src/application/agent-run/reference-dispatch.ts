import { createHash } from "node:crypto";
import { ModelCallError, type ModelCallInput, type ReferenceDispatchFact } from "./ports";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
type Message = { readonly role: string; readonly content: unknown };
function invalid(): never { throw new ModelCallError("MODEL_CALL_FAILED", "reference_dispatch_mismatch"); }

/** Validate the frozen input slot; when supplied, also verify the actual serialized message slot. */
export function verifyReferenceDispatch(input: ModelCallInput, messages?: readonly Message[], historyOffset = 0): void {
  const observer = input.referenceDispatchObserver;
  if (!observer) return;
  if (!Number.isSafeInteger(observer.historyIndex) || observer.historyIndex < 0 || !/^[a-f0-9]{64}$/.test(observer.contentSha256)) invalid();
  const source = input.history?.[observer.historyIndex];
  if (!source || source.role !== "user" || hash(source.content) !== observer.contentSha256) invalid();
  if (messages) {
    const actual = messages[historyOffset + observer.historyIndex];
    if (!actual || actual.role !== "user" || typeof actual.content !== "string" || hash(actual.content) !== observer.contentSha256) invalid();
    if (observer.maxSerializedMessageBytes !== undefined && (!Number.isSafeInteger(observer.maxSerializedMessageBytes) || observer.maxSerializedMessageBytes < 1 || Buffer.byteLength(JSON.stringify(actual), "utf8") > observer.maxSerializedMessageBytes)) invalid();
  }
}

/** Authorization errors propagate before dispatch. Never retry a request here. */
export async function revalidateReferenceDispatch(input: ModelCallInput): Promise<void> {
  await input.referenceDispatchObserver?.beforeDispatch();
}

/** A missing receipt must not turn an accepted remote request into another paid invocation. */
export async function observeReferenceDispatch(input: ModelCallInput, fact: Omit<ReferenceDispatchFact, "contentSha256">): Promise<void> {
  const observer = input.referenceDispatchObserver;
  if (!observer) return;
  try { await observer.onDispatched({ ...fact, contentSha256: observer.contentSha256 }); } catch { /* Receipt stays unknown; the transport is not replayed. */ }
}
