/**
 * role-freeze.ts —— H3A-004：旧自由角色新增冻结策略。
 *
 * 完成契约原文："新增未登记角色 WARN，历史仍可读"。⚠ 注意措辞是 WARN 不是
 * 阻断——这条不是棘轮（同一批文件里没有"允许历史存在、只拦新增"的时间维度
 * 判断，那需要 git diff --name-only 之类的外层调用方配合，本函数不做），
 * 是**统一 WARN**：任何一个 `.harness/agents/roles/*.yaml` 文件的 `name`
 * 字段，如果在 `.harness/agents/registry.yaml` 的 `agents[].id` 列表里
 * 找不到，一律 WARN，历史条目和新条目一视同仁——因为 registry.yaml 自己的
 * 头部注释已经写明"改动走 PR review"，它才是身份的单一事实源
 * （H3A-002 inventory 现场核实过：registry.yaml 与 roles/*.yaml 之间已经
 * 有 6/6 一一对应，这条门槛不是新发明的规矩，是把已经在维持的纪律变成
 * 能被机器看见的东西）。
 *
 * 方向性说明（同样是 H3A-002 的发现）：registry.yaml 有 4 个身份
 * （coord-chat-e2e/coord-agent-auth/dev-platform-baseline/dev-auth）**没有**
 * 对应的 roles/*.yaml 文件——这是"已登记但还没生成 portable role 表面"，
 * 不是"未登记角色"，本函数不对这个方向报 WARN（那是不同性质的缺口，已经在
 * H3A-002 inventory 里如实记录，不在这里重复判定）。
 */

export interface RoleFile {
  /** 文件名，用于定位问题（不是 role 的 name 字段——name 缺失时仍要能定位）。 */
  sourceFile: string;
  /** roles/*.yaml 里的 `name:` 字段，缺失时为 null。 */
  name: string | null;
}

export interface RoleFreezeFinding {
  code: "H3A004-UNREGISTERED-ROLE";
  severity: "WARN";
  sourceFile: string;
  message: string;
}

/**
 * 判定核心：纯函数，喂"角色文件列表"+"registry 里的合法 id 集合"，
 * 不碰文件系统（IO 在 role-freeze-doctor.ts 里）。
 */
export function findUnregisteredRoles(
  roleFiles: readonly RoleFile[],
  registeredIds: ReadonlySet<string>,
): RoleFreezeFinding[] {
  const findings: RoleFreezeFinding[] = [];
  for (const file of roleFiles) {
    if (file.name === null) {
      findings.push({
        code: "H3A004-UNREGISTERED-ROLE",
        severity: "WARN",
        sourceFile: file.sourceFile,
        message: `缺少 name 字段，无法核对是否在 registry.yaml 里登记`,
      });
      continue;
    }
    if (!registeredIds.has(file.name)) {
      findings.push({
        code: "H3A004-UNREGISTERED-ROLE",
        severity: "WARN",
        sourceFile: file.sourceFile,
        message: `角色 "${file.name}" 不在 .harness/agents/registry.yaml 的 agents[].id 列表里——` +
          `新增角色必须先经 registry.yaml 的 PR review 登记，这条文件游离在单一事实源之外`,
      });
    }
  }
  return findings;
}

/* ────────────────────────────────────────────────────────────────────────
 * 角色元数据两处手写的一致性判定（2026-09-09 加）
 *
 * 现状：`kind` / `areas` / `reports_to` 在 `.harness/agents/registry.yaml` 与
 * `.harness/agents/roles/<name>.yaml` **各写一遍**，6 个 role 全部如此，而上面
 * 那条 `findUnregisteredRoles` 只核对 `name` 在不在——两份副本的**内容**从来
 * 没有被任何脚本比对过。同一事实声明在两处，本仓已五次因此漂移。
 *
 * 本函数只做**一致性断言**（不一致 ⇒ FAIL，不是 WARN：与 name 未登记不同，
 * 元数据漂移会让派工按错误的 areas/kind 走，是会直接产生错误行为的）。
 * 真正的收敛（registry 作单源、roles/*.yaml 由生成器产出）另案走 ADR。
 *
 * 语义细则（都是实测形状，不是假设）：
 *  · `reports_to` 缺省与显式 `null` 等价——coord-main 在 registry 里没有这个
 *    键、在 role 文件里写 `reports_to: null`，两者说的是同一件事。
 *  · `areas` 逐项按顺序比对：顺序不同也算漂移。两边都是人手写的短列表，
 *    要求顺序一致比"集合相等"更容易发现是谁改了一边忘了另一边。
 *  · role 文件的 name 不在 registry 里 ⇒ 不在这里报（那是 findUnregisteredRoles
 *    的 WARN 职责，重复报会让同一个缺口有两个严重度）。
 * ──────────────────────────────────────────────────────────────────────── */

/** 参与比对的字段值：kind/reports_to 是标量，areas 是列表。 */
export interface RoleMetadata {
  kind: string | null;
  areas: readonly string[] | null;
  reports_to: string | null;
}

export interface RoleMetadataFile extends RoleMetadata {
  sourceFile: string;
  name: string | null;
}

export interface RoleMetadataFinding {
  code: "ROLE-METADATA-DRIFT";
  severity: "FAIL";
  sourceFile: string;
  message: string;
}

const METADATA_FIELDS = ["kind", "areas", "reports_to"] as const;

function render(value: RoleMetadata[keyof RoleMetadata]): string {
  return value === null ? "（未声明）" : Array.isArray(value) ? `[${value.join(", ")}]` : String(value);
}

function equal(a: RoleMetadata[keyof RoleMetadata], b: RoleMetadata[keyof RoleMetadata]): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/**
 * 逐字段比对 roles/*.yaml 与 registry.yaml 的同名身份。
 * `registry` 是 id → 元数据 的映射；role 文件在 registry 里找不到时跳过（见上）。
 */
export function findRoleMetadataDrift(
  roleFiles: readonly RoleMetadataFile[],
  registry: ReadonlyMap<string, RoleMetadata>,
): RoleMetadataFinding[] {
  const findings: RoleMetadataFinding[] = [];
  for (const file of roleFiles) {
    if (file.name === null) continue; // 已由 findUnregisteredRoles 报
    const entry = registry.get(file.name);
    if (entry === undefined) continue; // 未登记：同上
    for (const field of METADATA_FIELDS) {
      if (equal(file[field], entry[field])) continue;
      findings.push({
        code: "ROLE-METADATA-DRIFT",
        severity: "FAIL",
        sourceFile: file.sourceFile,
        message:
          `${file.name} 的 ${field} 两处不一致——role 文件写 ${render(file[field])}，` +
          `registry.yaml 写 ${render(entry[field])}。同一事实不得声明在两处且漂移；` +
          `registry.yaml 是身份的单一事实源，改一边必须改另一边`,
      });
    }
  }
  return findings;
}
