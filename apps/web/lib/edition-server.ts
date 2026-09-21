/**
 * 服务端读版次。**只在服务端组件里调用**（`app/layout.tsx`）——请求时求值，
 * 与 `next build` 的内联无关（理由见 `lib/edition.tsx` 头注）。
 */
import { DEPLOYMENT_EDITION_ENV, parseDeploymentEdition, type DeploymentEditionValue } from "@repo/contracts/deployment";

export function readDeploymentEdition(env: NodeJS.ProcessEnv = process.env): DeploymentEditionValue {
  return parseDeploymentEdition(env[DEPLOYMENT_EDITION_ENV]);
}
