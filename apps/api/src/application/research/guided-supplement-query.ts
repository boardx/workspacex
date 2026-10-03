import { research as C } from "@repo/contracts";

const querySchema = C.GuidedResearchTask.shape.searchAttempts.unwrap().element.shape.query;
/** Derived search text has the same durable bound as every attempt. Keep the
 * confirmed task untouched; reserve space for subject scope and each component.
 */
export function supplementQuery(...parts: string[]): string {
  const values = parts.map((part) => part.trim()).filter(Boolean);
  const limit = querySchema.maxLength!;
  let remaining = limit - Math.max(0, values.length - 1);
  const bounded = values.map((part, index) => {
    const allocation = Math.floor(remaining / (values.length - index));
    const value = part.slice(0, allocation).trim();
    remaining -= value.length;
    return value;
  });
  return querySchema.parse(bounded.join(" "));
}
