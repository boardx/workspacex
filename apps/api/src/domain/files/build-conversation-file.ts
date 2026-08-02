/**
 * F41 -- uc-22-3 R3 step 2 (conversation row) / V2: turns a session's message list into the
 * ONE `messages.jsonl` this feature's file-grain contract requires -- one line per message,
 * the whole session in one file, never one file per message (R7's explicit exclusion).
 *
 * Field names are R3's own list verbatim (`message_id` / `role` / `author` / `ts` /
 * `reply_to` / `content` / `tool_calls` / `attachments`), snake_case, because this is a file
 * on disk meant to be readable by tools outside this codebase (R7 "开放、可归档的格式") --
 * it is not a TS object serialized as a convenience, so it does not inherit this codebase's
 * own camelCase convention.
 */
export interface ConversationMessageForFile {
  readonly messageId: string;
  readonly role: string;
  readonly author: string;
  /** ISO-8601. */
  readonly ts: string;
  readonly replyTo?: string | null;
  readonly content: string;
  readonly toolCalls?: readonly unknown[];
  readonly attachments?: readonly unknown[];
}

/**
 * One JSON object per line, UTF-8, trailing newline. Each line is independently parseable
 * (R3 step 3's "JSONL 每行一个独立 JSON 对象") -- a reader does not need the rest of the file
 * to make sense of any one line.
 */
export function buildMessagesJsonl(messages: readonly ConversationMessageForFile[]): Uint8Array {
  const lines = messages.map((m) =>
    JSON.stringify({
      message_id: m.messageId,
      role: m.role,
      author: m.author,
      ts: m.ts,
      reply_to: m.replyTo ?? null,
      content: m.content,
      tool_calls: m.toolCalls ?? [],
      attachments: m.attachments ?? [],
    }),
  );
  const body = lines.length === 0 ? "" : lines.join("\n") + "\n";
  return new TextEncoder().encode(body);
}

/** The inverse of `buildMessagesJsonl` -- parses a materialized file back into rows, for
 *  tests and for anything downstream that reads the file rather than the live conversation. */
export function parseMessagesJsonl(bytes: Uint8Array): readonly Record<string, unknown>[] {
  const text = new TextDecoder().decode(bytes);
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
