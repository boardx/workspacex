import type { ThreadHistoryMessage } from "./ports";

/**
 * Drop the OLDEST messages first until the remaining, still-chronologically-ordered suffix
 * fits `maxChars` of combined `content` length. `messages` is already oldest-first (what
 * `readThreadHistory` returns); the result stays oldest-first so callers never have to
 * re-sort before splicing it into a `role`-ordered messages array.
 *
 * A single message longer than `maxChars` on its own is kept whole rather than truncated
 * mid-sentence -- cutting a stored message's text would make the model see words that were
 * never actually said in that message, which is a subtly different failure from "this turn
 * wasn't included at all". The budget is enforced by DROPPING turns, never by editing one.
 */
export function trimHistoryToBudget(
  messages: readonly ThreadHistoryMessage[],
  maxChars: number,
): readonly ThreadHistoryMessage[] {
  if (maxChars <= 0) return [];
  let total = 0;
  let firstKeptIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const next = total + messages[i]!.content.length;
    // The oldest kept message is allowed to push the running total over budget by itself
    // (see the doc comment: a single long message is kept whole, not truncated) -- but a
    // SECOND message would not be added once the budget is already spent.
    if (next > maxChars && total > 0) break;
    total = next;
    firstKeptIndex = i;
  }
  return messages.slice(firstKeptIndex);
}

