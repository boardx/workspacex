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
