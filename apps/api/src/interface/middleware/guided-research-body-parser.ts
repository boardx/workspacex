import { PayloadTooLargeException } from "@nestjs/common";
import { json, type Express, type Request, type Response, type NextFunction } from "express";
import { GuidedResearchBrief, operations } from "@repo/contracts/research";

// JSON may escape each UTF-16 character as six ASCII bytes. Reserve bounded room
// for the surrounding command, metadata and JSON syntax, without widening other routes.
export const GUIDED_RESEARCH_BODY_MAX_BYTES =
  ((GuidedResearchBrief.shape.goal.maxLength ?? 0) + (GuidedResearchBrief.shape.focus.maxLength ?? 0)) * 6 + 64 * 1024;

export function registerGuidedResearchBodyParsers(app: Pick<Express, "post" | "put">): void {
  const parser = json({ limit: GUIDED_RESEARCH_BODY_MAX_BYTES });
  const parse = (req: Request, res: Response, next: NextFunction) => parser(req, res, (error?: unknown) => {
    if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
      next(new PayloadTooLargeException()); return;
    }
    next(error);
  });
  app.post([
    operations.createGuidedResearchSession.path,
    operations.executeGuidedResearchNode.path,
    operations.executeGuidedResearchRuntime.path,
    operations.streamGuidedResearchRuntime.path,
    operations.runGuidedResearchSkillTurn.path,
  ], parse);
  app.put(operations.confirmResearchBrief.path, parse);
}
