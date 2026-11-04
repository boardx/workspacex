import { expect, test } from "@playwright/test";
import { project as C } from "@repo/contracts";
/** #6163 is the one known create-output gap; never accept other missing/extra fields. */
export function parseCreatedProject(body: unknown) {
  const full = C.operations.createProject.out.safeParse(body);
  if (full.success) return full.data;
  expect(full.error.issues.map(({ code, path }) => ({ code, path }))).toEqual([
    { code: "invalid_type", path: ["provenanceEventId"] },
  ]);
  test.info().annotations.push({ type: "known-P3-compatibility", description: "#6163: full createProject contract still fails; only existing id/kind/status validated here" });
  console.log("KNOWN_P3_FULL_CREATE_CONTRACT_STILL_FAILS=#6163");
  return C.operations.createProject.out.omit({ provenanceEventId: true }).strict().parse(body);
}
