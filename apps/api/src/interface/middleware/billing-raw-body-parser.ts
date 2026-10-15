import { raw, type Express, type Request, type Response, type NextFunction } from "express";
import { operations } from "@repo/contracts/billing-credits";
/** Register before Nest's JSON parser; verification must consume the exact signed bytes. */
export function registerBillingRawBodyParser(server: Express): void {
  const parser = raw({ type: () => true, limit: "1mb", inflate: false });
  server.post(operations.wechatNotify.path, (req: Request, res: Response, next: NextFunction) => {
    parser(req, res, (error?: unknown) => {
      if (error) {
        const oversized = typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large";
        res.status(oversized ? 413 : 400).json({ code: "FAIL" }); return;
      }
      next();
    });
  });
}
