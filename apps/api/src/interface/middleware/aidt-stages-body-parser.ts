import { PayloadTooLargeException } from "@nestjs/common";
import { json, type Express, type Request, type Response, type NextFunction } from "express";
import { operations, STAGE_REQUEST_BODY_LIMIT_BYTES } from "@repo/contracts/aidt-stages";

/** Bound only the approved stage envelope. Existing endpoints retain their current limits. */
export function registerAidtStageBodyParser(app: Pick<Express, "put">): void {
  const parser = json({ limit: STAGE_REQUEST_BODY_LIMIT_BYTES });
  app.put(operations.save.path, (request: Request, response: Response, next: NextFunction) => {
    parser(request, response, (error?: unknown) => {
      if (typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large") {
        next(new PayloadTooLargeException({ reasonCode: "AIDT_STAGE_TOO_LARGE" })); return;
      }
      next(error);
    });
  });
}
