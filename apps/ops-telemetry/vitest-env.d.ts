import type { Env as TelemetryEnv } from "./src/index";

declare module "cloudflare:test" {
  interface ProvidedEnv extends TelemetryEnv {}
}
