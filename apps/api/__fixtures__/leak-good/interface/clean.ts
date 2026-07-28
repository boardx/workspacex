// Reverse counter-proof: these must NOT fire.
// `.message` and `.stack` on non-error objects are ordinary code, and a gate that
// flags them gets muted, which is worse than not having it.
export function ok(res: { json(x: unknown): void }, chat: { message: string }, frame: { stack: string[] }) {
  res.json({ error: "internal_error", note: chat.message, depth: frame.stack.length });
}
