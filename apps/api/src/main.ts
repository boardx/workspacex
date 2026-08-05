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
import { attachAsrGateway } from "./interface/ws/asr-stream.gateway";
import { ASR_PROVIDER } from "./application/recording/asr-ports";
import { PRINCIPAL_RESOLVER_PORT } from "./application/ports/principal-resolver.port";
import { IDENTITY_REPOSITORY } from "./application/identity/ports";
import {
  RECORDING_ID_GENERATOR,
  RECORDING_UNIT_OF_WORK,
  TRANSCRIPTION_POLICY_PROVIDER,
} from "./application/recording/session-lifecycle-ports";

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

/**
 * #466 —— the WS surface, attached to the SAME http server the controllers run on.
 *
 * ## Why it is wired here and not as a Nest "gateway"
 *
 * `@nestjs/websockets` would add a second HTTP-adjacent framework to the composition (and a
 * second dependency, and a second lifecycle) for one route. `ws` with `noServer: true`
 * hooked onto the Express server's `upgrade` event IS the whole mechanism, and it keeps the
 * one thing that matters: the handshake authenticates through the same
 * `PrincipalResolverPort` instance every HTTP request does, so there is no second answer to
 * "who is this".
 *
 * ⚠ Attached after `listen()`, not inside `createApp()`: many kernel test files build an app
 *   without ever listening, and hanging a socket server off a server that never binds leaves
 *   a listener nobody closes.
 */
export function attachStreamingSurfaces(app: NestExpressApplication): void {
  attachAsrGateway(app.getHttpServer(), {
    principals: app.get(PRINCIPAL_RESOLVER_PORT),
    identities: app.get(IDENTITY_REPOSITORY),
    uow: app.get(RECORDING_UNIT_OF_WORK),
    policies: app.get(TRANSCRIPTION_POLICY_PROVIDER),
    ids: app.get(RECORDING_ID_GENERATOR),
    asr: app.get(ASR_PROVIDER),
  });
}

if (isProcessEntry()) {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3200);
  await app.listen(port);
  attachStreamingSurfaces(app);
  process.stdout.write(`api listening on ${port}\n`);
}
