/**
 * 版次在 API 侧的读取口。判定规则本身在契约（`@repo/contracts/deployment`）；
 * 这个文件只回答「从哪读」，好让组合根与基础设施层不各自写一遍 `process.env[...]`。
 */
import {
  DEPLOYMENT_CLOUD_URL_ENV, DEPLOYMENT_EDITION_ENV, parseCloudUrl, parseDeploymentEdition,
  type DeploymentEditionValue,
} from "@repo/contracts/deployment";

export function readDeploymentEdition(env: NodeJS.ProcessEnv = process.env): DeploymentEditionValue {
  return parseDeploymentEdition(env[DEPLOYMENT_EDITION_ENV]);
}

/** 在线正式系统的地址，没配或不合法 ⇒ `null`（判定规则在契约的 `parseCloudUrl`）。 */
export function readCloudUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return parseCloudUrl(env[DEPLOYMENT_CLOUD_URL_ENV]);
}
