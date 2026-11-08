import { PayloadTooLargeException } from "@nestjs/common";
import { json, type Express, type Request, type Response, type NextFunction } from "express";
import { AgentWrite, SkillWrite, operations } from "@repo/contracts/ai-catalog-admin";

// JSON can encode each UTF-16 code unit as six ASCII bytes. Derive the
// allowance from the canonical fields and reserve bounded envelope space.
export const AI_CATALOG_BODY_MAX_BYTES = Math.max(
  Object.values(SkillWrite.shape).reduce((sum, field) => sum + (field.maxLength ?? 0), 0),
  AgentWrite.shape.name.maxLength! + AgentWrite.shape.description.maxLength! +
    AgentWrite.shape.instructions.maxLength! + AgentWrite.shape.modelId.unwrap().maxLength!,
) * 6 + 16 * 1024;

export function registerAiCatalogBodyParsers(app: Pick<Express, "post" | "patch">): void {
  const parser = json({ limit: AI_CATALOG_BODY_MAX_BYTES });
  const parse = (req: Request, res: Response, next: NextFunction) => parser(req, res, (error?: unknown) => {
    if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
      next(new PayloadTooLargeException()); return;
    }
    next(error);
  });
  app.post(operations.create.path, parse);
  app.patch(operations.update.path, parse);
}
