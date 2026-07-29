/**
 * Process entry point (the other half of the composition root). See the note at the top of
 * `kernel.module.ts` about why the composition root belongs to no layer.
 */
import "reflect-metadata";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { KernelModule } from "./kernel.module";
import { traceMiddleware } from "./interface/middleware/trace";

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(KernelModule, {
    logger: process.env.KERNEL_QUIET === "1" ? false : ["error", "warn"],
  });
  // Must sit outermost, ahead of the Guard: rejected requests need a traceId too
  // (see middleware/trace.ts).
  app.use(traceMiddleware);
  return app;
}

/**
 * Only listen when this file IS the process entry.
 *
 * It cannot be gated on an env var: ESM imports are hoisted, so a test that imports
 * `createApp` from here would have already started a listener before it got a chance to
 * set the variable -- leaving a stray server bound to the default port for the rest of
 * the run. Comparing against argv[1] has no such ordering hazard.
 */
function isProcessEntry(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isProcessEntry()) {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3200);
  await app.listen(port);
  process.stdout.write(`api listening on ${port}\n`);
}
