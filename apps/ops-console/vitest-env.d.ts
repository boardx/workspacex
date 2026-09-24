import type { Env as OpsEnv } from "./src/index";

declare module "cloudflare:test" {
  interface ProvidedEnv extends OpsEnv {}
}
