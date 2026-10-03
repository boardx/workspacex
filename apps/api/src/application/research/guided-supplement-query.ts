import { research as C } from "@repo/contracts";

const querySchema = C.GuidedResearchTask.shape.searchAttempts.unwrap().element.shape.query;
/** Derived search text has the same durable bound as every attempt. Keep the
 * confirmed task untouched; reserve space for subject scope and each component.
 */
export function supplementQuery(...parts: string[]): string {
  const values = parts.map((part) => part.trim()).filter(Boolean);
  const limit = querySchema.maxLength!;
  let remaining = limit - Math.max(0, values.length - 1);
  const allocations = values.map(() => 0);
  let pending = values.map((_, index) => index);
  while (pending.length > 0) {
    const share = Math.floor(remaining / pending.length);
    const short = pending.filter((index) => values[index]!.length <= share);
    if (short.length === 0) {
      for (const index of pending) {
        const allocation = Math.floor(remaining / pending.length);
        allocations[index] = allocation;
        remaining -= allocation;
        pending = pending.filter((candidate) => candidate !== index);
      }
      break;
    }
    for (const index of short) {
      allocations[index] = values[index]!.length;
      remaining -= allocations[index]!;
    }
    pending = pending.filter((index) => !short.includes(index));
  }
  const bounded = values.map((part, index) => part.slice(0, allocations[index]).trim());
  return querySchema.parse(bounded.join(" "));
}
