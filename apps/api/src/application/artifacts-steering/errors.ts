/**
 * 契约束 `artifacts-steering` 的失败模式（F09 部分）。一一对应
 * `packages/contracts/src/artifacts-steering.ts` 的 `ArtifactError`。
 */

/** 调用者对该 Artifact 无可见权（同组织内有权限访问该 run 的用户才可见，R5）。 */
export class ArtifactNotVisibleError extends Error {}

/** `artifactId` 不存在。 */
export class ArtifactNotFoundError extends Error {}

/** E2：指定版本已不存在——拒绝，不允许默默使用最新版本代替（I-4）。 */
export class ArtifactVersionNotFoundError extends Error {}
