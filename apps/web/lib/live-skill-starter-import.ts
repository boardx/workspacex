import { wave2Runtime } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest } from "./api-client";

export type SkillStarterImportInput = z.infer<
  typeof wave2Runtime.operations.importSkillStarterPack.in
>;
export type SkillStarterImportResult = z.infer<
  typeof wave2Runtime.operations.importSkillStarterPack.out
>;

export function importSkillStarterPack(
  input: SkillStarterImportInput,
): Promise<SkillStarterImportResult> {
  return apiRequest<SkillStarterImportResult>(
    wave2Runtime.operations.importSkillStarterPack.path,
    { method: "POST", body: input },
  );
}
