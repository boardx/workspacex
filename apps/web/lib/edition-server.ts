/**
 * 服务端读版次。**只在服务端组件里调用**（`app/layout.tsx`）——请求时求值，
 * 与 `next build` 的内联无关（理由见 `lib/edition.tsx` 头注）。
 */
import {
  DEPLOYMENT_CLOUD_URL_ENV, DEPLOYMENT_EDITION_ENV, parseCloudUrl, parseDeploymentEdition,
  type DeploymentEditionValue,
} from "@repo/contracts/deployment";

export function readDeploymentEdition(env: NodeJS.ProcessEnv = process.env): DeploymentEditionValue {
  return parseDeploymentEdition(env[DEPLOYMENT_EDITION_ENV]);
}

/**
 * 在线正式系统的地址。**没配就是 `null`**，界面据此如实说「这份安装包还没配在线地址」——
 * 不编一个域名（本仓里不存在一个已知的生产域名，编出来就是把用户送去错误的地方）。
 */
export function readCloudUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return parseCloudUrl(env[DEPLOYMENT_CLOUD_URL_ENV]);
}
