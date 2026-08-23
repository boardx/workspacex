/**
 * #595 —— URL 导入在**生产**里到底被绑上了哪个取回器。
 *
 * ## 这个文件是为了堵我自己开的口子
 *
 * `ImportSkillFromUrlDeps.fetch` 是一个**端口**。做成端口是为了让用例可测，
 * 但它同时意味着：**任何人都可以绑一个不校验的取回器**，而两道 SSRF 门、
 * 十四条反证、全部测试**一层都不会红**——因为它们测的是
 * 「那个函数正确」「那道门被取回层调用」「用例不吞拒绝」，
 * **没有一条测的是「生产到底绑了谁」**。
 *
 * ⚠ 我在 #603 的未验证项里把这条标红过，原话是：
 *   「注释声明『生产只允许绑 `fetchImportSource`』，但**没有任何机械门控**保证这一点」。
 *   ⇒ 那是一条**写下时即为待办**的声明。本文件 + `url-import-binding-guard.test.ts`
 *     把它变成机械事实。
 *
 * ## 唯一装配点
 *
 * ⛔ **不要在别处组装 `ImportSkillFromUrlDeps`。** 守卫测试会扫 `src/`，
 *   发现第二处装配、或本文件绑了 `fetchImportSource` 以外的东西，**当场红**。
 */
import { fetchImportSource } from "./http-import-fetcher";
import { PgSkillUrlImportRepository } from "./pg-skill-url-import-repository";
import type { DatabasePort } from "../../application/ports/database.port";
import type { IdentityRepository } from "../../application/identity/ports";
import type {
  ImportSkillFromUrlDeps,
  ImportSourceFetcher,
} from "../../application/skill-import/import-skill-from-url";
import type { DiscoverSkillsFromUrlDeps } from "../../application/skill-import/discover-skills-from-url";

/**
 * 生产取回器。**必须**是 `http-import-fetcher.ts` 的 `fetchImportSource` 本身，
 * 因为两道门（字面量门 + DNS 解析后门）都长在它里面。
 *
 * ⛔ **不要包一层 wrapper，哪怕它看起来更整洁。**
 *
 * 写成 `(u, p) => fetchImportSource(u, p)` 读起来更「规整」，但那一层会让
 * `url-import-binding-guard.test.ts` 的**同一性**断言（`toBe`）写不出来，
 * 只能退回到「结构上看起来在调用它」——而**「看起来在调用它」和「绑的就是它」
 * 是两件事**：反证⑯ 实测过，包一层之后守卫当场红，正是因为它不再是同一个函数对象。
 *
 * ⚠ 这是**为了可断言性而约束实现写法**。下一个人若觉得 wrapper 更整洁而顺手加上，
 *   同一性断言就会悄悄退化成结构断言，而**结构断言挡不住换实现**
 *   （反证⑮：绑一个不校验的取回器，既有 42 条断言一条都不动）。
 */
export const PRODUCTION_IMPORT_FETCHER: ImportSourceFetcher = fetchImportSource;

export function composeImportSkillFromUrlDeps(input: {
  readonly db: DatabasePort;
  readonly identities: IdentityRepository;
  /** 该组织是否处于 personal-local 出站承诺下（I-9）。 */
  readonly localOnlyOrg: boolean;
}): ImportSkillFromUrlDeps {
  return {
    identities: input.identities,
    fetch: PRODUCTION_IMPORT_FETCHER,
    repository: new PgSkillUrlImportRepository(input.db),
    policy: { localOnlyOrg: input.localOnlyOrg },
  };
}

/**
 * #1865 —— 扫描用例的装配。**只读，不落库**，所以没有仓储字段——与
 * `composeImportSkillFromUrlDeps` 唯一的差别就是少了 `repository`，
 * `fetch` 仍然绑的是同一个 `fetchImportSource`（两道 SSRF 门同一套，不重新发明）。
 *
 * ⚠ 这个函数不参与 `url-import-binding-guard.test.ts` 的同一性/唯一装配点断言——
 *   那份守卫钉的是 `composeImportSkillFromUrlDeps`/`ImportSkillFromUrlDeps` 这组
 *   具体标识符，本函数是不同的名字、不同的 deps 形状，不是它要挡的"第二处装配"。
 */
export function composeDiscoverSkillsFromUrlDeps(input: {
  readonly identities: IdentityRepository;
  readonly localOnlyOrg: boolean;
}): DiscoverSkillsFromUrlDeps {
  return {
    identities: input.identities,
    fetch: PRODUCTION_IMPORT_FETCHER,
    policy: { localOnlyOrg: input.localOnlyOrg },
  };
}
