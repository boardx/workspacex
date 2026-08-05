/**
 * #595 段 2 —— `importSkillFromUrl` 的**契约草案**形状。
 *
 * ## ⚠⚠ 这是草案，**尚未经人类签核**（ADR-023）
 *
 * 草案已登记在 issue #595 的评论里，**还没有人签**。coord-main 的派工逐字写着
 * 「不要等签核，先落地导入+编辑+后台测试最小集合」，ADR-023 也允许登记后先落地——
 * 所以本文件存在**不代表这个形状定稿了**。
 *
 * ⛔ **不要把这里的字段名当既成事实**，也不要在别处复制一份。
 *
 * ## 为什么整个草案形状挤在一个文件里
 *
 * 签核时人类**很可能改形状**（字段改名、拆字段、换错误码）。如果这些名字散进
 * 十几个文件，那次修改就会变成一场跨文件重命名，进而变成「改不动，于是不改」——
 * 草案就这样偷偷变成了定稿。**把它关在一个文件里，是为了让签核真的改得动。**
 *
 * ⇒ 用例、仓储、controller 一律 `import` 本文件的类型，**不重新声明字段名**。
 *
 * ## 落哪套模型
 *
 * **模型 A**：`skills` / `skill_versions` / `skill_version_files`——
 * 运行时唯一真读的那套（`pg-agent-run-repository.ts` 的 `FROM skill_version_files`）。
 * ⚠ 模型 B（`skill_contracts` 声明式）与 A 不连通，这笔债登记在 **#598**，
 *   **本轮不顺手收敛**（那是签核级动作）。
 */

/** 草案输入。⚠ 字段名未签核。 */
export interface ImportSkillFromUrlInput {
  readonly orgId: string;
  readonly actorId: string;
  /** 要导入的 https 地址；两道 SSRF 门都作用在它上面 */
  readonly sourceUrl: string;
  /** 导入后 skill 的显示名 */
  readonly name: string;
  /** 幂等键：同一个键重复提交只产生一次导入 */
  readonly idempotencyKey: string;
}

/** 草案输出。⚠ 字段名未签核。 */
export interface ImportSkillFromUrlResult {
  readonly skillId: string;
  readonly versionId: string;
  /** 落库的文件路径清单（已过 `normalizedPath`） */
  readonly filePaths: readonly string[];
  readonly contentDigest: string;
  /** 该 `idempotencyKey` 之前已经导入过，本次未重复落库 */
  readonly replayed: boolean;
}

/**
 * 草案错误码。⚠ 未签核。
 *
 * ⚠ 取回层自己的拒绝码（`IMPORT_URL_*` / `IMPORT_PAYLOAD_TOO_LARGE` …）
 *   定义在 `domain/skill/import-source.ts`，**不在这里重复一份**——
 *   它们是同一件事，第二份副本就是下一次漂移。
 */
export type ImportSkillFromUrlFailure =
  /** 取回到的内容不是可接受的 skill 定义（空、超出单文件上限、路径非法） */
  | "IMPORT_CONTENT_INVALID"
  /** 组织内已有同名 skill */
  | "IMPORT_NAME_CONFLICT"
  /** 同一 idempotencyKey 曾用不同输入提交过 */
  | "IMPORT_IDEMPOTENCY_CONFLICT"
  /**
   * 调用者不是本组织 admin。
   *
   * ⚠ 与 `import-skill-starter-pack.ts:38-39` 同一条门槛（`orgRole === "admin"`）。
   *   两条导入路径**通向同一批表**，门槛不同就等于开了条矮的。
   */
  | "IMPORT_NOT_ORG_ADMIN";

export class ImportSkillFromUrlError extends Error {
  constructor(readonly code: ImportSkillFromUrlFailure) {
    super(`import skill from url failed: ${code}`);
    this.name = "ImportSkillFromUrlError";
  }
}
