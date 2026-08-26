/**
 * DA-16 -- the real producer for DA-15's `file_created` CUSTOM event
 * (`@repo/contracts/agui-state-events`'s `AguiFileCreatedValue`, declared 2026-08-23 as a
 * contract with "目前没有真实生产者" -- see that file's own header).
 *
 * ## Which "files" this is, and which it is deliberately NOT
 *
 * The task that asked for this (issue body, `.harness/state/deepagent-eval/2026-08-23-
 * 3d327c13/sse-and-thread-state-evidence-v2/02-thread-state.json`) pointed at
 * `GET /threads/:id/state`'s `.values.files` -- the deepagents `FilesystemMiddleware`'s OWN
 * ephemeral virtual filesystem (arbitrary in-sandbox paths like `/large_tool_results/
 * <call_id>`, see `deep-agent-model-provider.ts`'s `ThreadStateFileData` doc). That channel
 * is NOT what this module reads, on purpose: its keys are not stable ids in ANY of this
 * deployment's own domains (`vfs-uri.ts`'s `VFS_DOMAINS`), a large fraction of its entries
 * are tool-result-eviction scratch data never meant to be user-visible files, and there is
 * no existing write path that promotes an arbitrary entry of it into a durable, addressable
 * record -- fabricating a `vfs://` id for one would be exactly the kind of invented fact
 * this codebase's own discipline forbids (`AGENTS.md` "没有证据 = 没有完成"; `agui-state-
 * events.ts`'s own "不发编造的" rule for `parse*` failures).
 *
 * What DOES already exist, durable and addressable: `agent_runs.model_output_files` --
 * `run-skill-script.ts`'s sandbox loop output -- lands in `chat_message_attachments` in the
 * SAME transaction that writes the run's result message (`AgentRunStore.commitWriteback`,
 * #1624; see `vfs-uri.ts`'s file head, "三套文件存储" second bullet). That table already has
 * a stable primary key, a real `vfs://attachment/<id>` URI (`buildVfsUri`), and an EXISTING
 * authorized read path (`listThreadAttachments`) this module reuses rather than adding a
 * second one. This is also, verified by reading `chat-materials-panel.tsx` (issue body's
 * own ask, item 4): the SAME table the "材料" panel already lists from -- so a `file_created`
 * event fired from here describes something a human user can ALREADY see appear in that
 * panel today, just previously silent on the AG-UI wire.
 */
import type { ThreadAttachmentItem } from "../chat/list-thread-attachments";
import { buildVfsUri } from "../../domain/vfs/vfs-uri";
import { parseAguiFileCreatedValue, type AguiFileCreatedValue } from "@repo/contracts/agui-state-events";

/**
 * `items` -- the FULL result of `listThreadAttachments` for this run's Chat thread;
 * `resultMessageId` -- the run's own freshly-written assistant message id
 * (`AguiBridgeOutcome`'s `"succeeded"` branch `messageId`, itself a value that only ever
 * names a message that was just created THIS call -- see that type's own doc). Filtering by
 * it is therefore never a "which of the thread's many past attachments happen to match"
 * guess: every attachment whose `messageId` equals it was inserted by THIS run's own
 * `commitWriteback`, in the same transaction as the message itself.
 *
 * A run that produced no sandbox output files (the overwhelming common case -- no `run_script`
 * block, or a plain conversational turn) filters to an empty array here, same as before this
 * function existed: zero `file_created` events, not a fabricated "nothing happened" one.
 *
 * Each match is re-validated through `parseAguiFileCreatedValue` before being returned --
 * same "even data this module itself just built could still fail its own contract, and a
 * failure drops the event rather than sending something malformed" discipline `chat_message_id`
 * uses for its own parse step. In practice a `chat_message_attachments` row always has a
 * non-blank `filename` and an id `buildVfsUri` accepts (this deployment's own id factories,
 * per `vfs-uri.ts`'s `ID_PATTERN` comment) -- this is defence, not an expected failure path.
 */
export function buildFileCreatedEvents(
  items: readonly ThreadAttachmentItem[],
  resultMessageId: string,
): readonly AguiFileCreatedValue[] {
  const events: AguiFileCreatedValue[] = [];
  for (const item of items) {
    if (item.messageId !== resultMessageId) continue;
    let uri: string;
    try {
      uri = buildVfsUri("attachment", item.id);
    } catch {
      continue; // id not URI-safe -- fail closed, do not invent a mangled uri.
    }
    const parsed = parseAguiFileCreatedValue({
      uri,
      domain: "attachment",
      name: item.filename,
      mime: item.mime,
      bytes: item.bytes,
      // #1624's own write path -- see this file's own header for why every attachment that
      // can match `resultMessageId` (an AI-authored message) was necessarily produced this
      // way, never a user upload (a human never uploads onto an assistant's own message).
      source: "agent_run_output",
    });
    if (parsed !== null) events.push(parsed);
  }
  return events;
}
