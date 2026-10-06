import { validateTextAttributes, type TextAttributes } from "@repo/whiteboard-core";
/** Standalone text uses Fabric's natural top baseline; sticky notes support vertical layout. */
export function boardTextAttributes(kind: "text" | "sticky", input: TextAttributes) {
  return validateTextAttributes(kind === "text" ? { ...input, verticalAlignment: "top" } : input);
}
