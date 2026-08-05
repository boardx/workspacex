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

/**
 * 生产取回器。**必须**是 `http-import-fetcher.ts` 的 `fetchImportSource` 本身，
 * 因为两道门（字面量门 + DNS 解析后门）都长在它里面。
 *
 * ⚠ 这里刻意**不包一层 wrapper**：包一层就无法用**同一性**断言证明绑对了，
 *   而「结构上看起来在调用它」和「绑的就是它」是两件事——
 *   今晚已经三次证明后者才是能被验证的那件（反证 ④ / ⑦ / ⑭）。
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
