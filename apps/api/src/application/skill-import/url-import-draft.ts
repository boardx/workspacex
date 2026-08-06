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

/**
 * ## ⚠ 形状搬家了：草案的**字段名现在住在契约里**
 *
 * 本文件原本自己写 `interface`，理由写在文件头（「关在一个文件里，好让签核改得动」）。
 * 接 controller 时被一条机械门控推翻：`tests/contract-single-source.test.ts` 逐行禁止
 * `apps/api/src` 出现 `const X = z.object(`——因为「同一形状声明在两处」在本项目
 * 已经发生过两次（`"org"|"team"` vs `"org-wide"|"team-only"`；`status` vs `.state`）。
 *
 * ⇒ 形状**仍然只有一份**，只是那一份从这里搬到了
 *   `packages/contracts/src/wave2-runtime.ts` 的 `importSkillFromUrl`（仍标注未签核）。
 *   本文件从此**只派生，不声明**。原意图（让签核改得动）不但没丢，反而更强：
 *   现在改契约那一处，后端会被编译器逐个带过去。
 */
import type { z } from "zod";
import { wave2Runtime as C } from "@repo/contracts";

/**
 * 草案输入。⚠ 字段名未签核，且**派生自契约**。
 *
 * `orgId` / `actorId` 不在契约 body 里，因为它们来自 principal 而不是调用方——
 * 让调用方能自己填 `orgId` 就等于把授权决定交给了被授权者。
 */
export type ImportSkillFromUrlInput = z.infer<typeof C.operations.importSkillFromUrl.in> & {
  readonly orgId: string;
  readonly actorId: string;
};

/** 草案输出。⚠ 字段名未签核，且**派生自契约**。 */
export type ImportSkillFromUrlResult = z.infer<typeof C.operations.importSkillFromUrl.out>;

/**
 * 草案错误码里**属于用例层的那一部分**。⚠ 未签核。
 *
 * ⚠ 取回层自己的拒绝码（`IMPORT_URL_*` / `IMPORT_PAYLOAD_TOO_LARGE` …）
 *   定义在 `domain/skill/import-source.ts`，**不在这里重复一份**——
 *   它们是同一件事，第二份副本就是下一次漂移。
 *
 * ⚠ 用 `Extract` 而不是直接写联合：这样每一个码都必须**真的存在于契约枚举里**，
 *   拼错一个会塌成 `never` 并在 throw 处报错，而不是安静地多出一个契约不认识的码。
 *   `IMPORT_NOT_ORG_ADMIN` 与 `import-skill-starter-pack.ts:38-39` 同一条门槛
 *   （`orgRole === "admin"`）——两条导入路径通向同一批表，门槛不同就等于开了条矮的。
 */
export type ImportSkillFromUrlFailure = Extract<
  z.infer<typeof C.SkillUrlImportError>,
  "IMPORT_CONTENT_INVALID" | "IMPORT_NAME_CONFLICT" | "IMPORT_IDEMPOTENCY_CONFLICT" | "IMPORT_NOT_ORG_ADMIN"
>;

export class ImportSkillFromUrlError extends Error {
  constructor(readonly code: ImportSkillFromUrlFailure) {
    super(`import skill from url failed: ${code}`);
    this.name = "ImportSkillFromUrlError";
  }
}
