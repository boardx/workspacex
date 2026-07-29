/**
 * 导出豁口的规则层（F17 / uc-0-5 R10 / V11）。纯函数，不碰 HTTP、SQL、socket。
 *
 * ## 这个文件里的每一条都是从 F16 的承诺**反推**出来的
 *
 * F16 说「最隐私的数据不出本机」，并把它做成了三层可断言的性质。F17 是唯一的豁口，
 * 所以这里要回答的不是「导出怎么做」，而是「一个豁口窄到什么程度才不算把承诺废掉」：
 *
 *   方向  只能本地 → 正式，且**没有反向操作**（不是「反向被拒」，是压根没有）
 *   范围  只对**被选中的那一组**打开，不是「导出期间守卫关掉」
 *   时效  「人确认过」必须是当下事实，不是历史声明
 *
 * ## 判定不在这里的部分，以及为什么
 *
 * 方向规则在这里有一份（`isExportDirectionAllowed`），在迁移 0016 也有一份
 * （`kernel_export_direction_ok`）。**这不是两份事实源**：两者都从
 * `isLocalOrgKind` 这条唯一判定推出，且它们守的是不同的写入者——
 * 这里守的是用例（给用户一个准确的失败码），数据库那份守的是**所有**写入者
 * （包括还没写出来的批量脚本）。同 0015 对 `local_org_endpoint_stays_local` 的说法。
 *
 * 而「范围只对选中项打开」**做不进这里**：一个纯函数拦不住一个 socket。
 * 它在 `infrastructure/egress/local-egress-guard.ts` 的 aperture 里。
 */
import { identity as C } from "@repo/contracts";
import { isLocalOrg, localObjectKeyPrefix } from "./local-org";

/** 目标侧条目的来源标注。契约生成，此处只转出——不在后端另拼一句。 */
export const localExportUnvettedNote = C.localExportUnvettedNote;

/** 预览令牌的有效期（毫秒）。契约常量。 */
export const LOCAL_EXPORT_PREVIEW_TTL_MS = C.LOCAL_EXPORT_PREVIEW_TTL_MS;

/**
 * 方向：**源是本地组织，目标不是**。两个条件都要。
 *
 * ⚠ 只查源会放过「本地 → 另一个本地」——把 A 的私有数据搬进 B 的私有组织，
 *   而 B 的本地组织对 A 恰恰是不可见的，所以这是一次没人能审计的转移。
 * ⚠ 只查目标会放过「正式 → 正式」——那不是本操作，它会绕过目标组织自己的入库审核，
 *   而目标侧那句「未经本组织入库审核」的标注正是为审核而存在的。
 */
export function isExportDirectionAllowed(
  fromOrgKind: string | null | undefined,
  toOrgKind: string | null | undefined,
): boolean {
  if (fromOrgKind === null || fromOrgKind === undefined) return false;
  if (toOrgKind === null || toOrgKind === undefined) return false;
  return isLocalOrg(fromOrgKind) && !isLocalOrg(toOrgKind);
}

/**
 * 副本在目标组织里的对象键。
 *
 * ⚠ **必须换前缀**，而且这不是整洁问题：`local/<orgId>/` 是「哪些字节不许出本机」的
 *   可指认集合（F16 guarantee 3），迁移 0015 的触发器**两个方向都挡**——
 *   正式组织的行写进 `local/` 会被拒。所以一次「复制」如果沿用源键，
 *   它在数据库层根本写不进去，而那是对的：副本不再受那条承诺保护，
 *   它必须住在目标组织自己的键空间里。
 *
 * ⚠ 也因此，导出**必然涉及一次真实的字节搬运**。这正是豁口需要网络层守卫的原因：
 *   跨部署时那次搬运就是出网。
 */
export function targetObjectKey(input: {
  readonly toOrgId: string;
  readonly targetArtifactId: string;
  readonly targetVersionId: string;
}): string {
  return `${input.toOrgId}/imported/${input.targetArtifactId}/${input.targetVersionId}`;
}

/** 源键是否确实在本地组织的受保护前缀下。导出前的一致性自检。 */
export function isUnderLocalPrefix(orgId: string, objectStorageKey: string): boolean {
  return objectStorageKey.startsWith(localObjectKeyPrefix(orgId));
}

/**
 * 令牌还新鲜吗。
 *
 * ⚠ 一次性由数据库的条件 UPDATE 保证，**不在这里**。这里只答新鲜度，
 *   因为「这个令牌用过没有」在并发下不是一个纯函数能回答的问题——
 *   check-then-act 的那一版会让两个并发导出各自看到「没用过」。
 */
export function isPreviewFresh(issuedAtMs: number, nowMs: number): boolean {
  return nowMs >= issuedAtMs && nowMs - issuedAtMs <= LOCAL_EXPORT_PREVIEW_TTL_MS;
}

/**
 * 请求的这一组成果，与令牌冻结的那一组，是不是**同一组**。
 *
 * ⚠ 用集合相等而不是「请求 ⊆ 令牌」。子集看起来更安全（导得更少），
 *   实际上它把「人确认过的那份清单」变成了一个可以事后裁剪的东西——
 *   而清单的意义在于人看到的和发生的是同一件事。少导一件也要重新看一眼。
 */
export function sameSelection(
  requested: readonly string[],
  approved: readonly string[],
): boolean {
  if (requested.length !== approved.length) return false;
  const a = new Set(requested);
  if (a.size !== requested.length) return false; // 请求里有重复 ⇒ 不是同一组
  for (const id of approved) {
    if (!a.has(id)) return false;
  }
  return true;
}
