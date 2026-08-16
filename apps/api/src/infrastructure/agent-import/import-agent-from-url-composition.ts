/**
 * #1415 —— agent 版的 `infrastructure/skill/url-import-composition.ts`。同一层、
 * 同一条纪律：`lint-arch-deps` 禁止 application 层 import infrastructure 层，
 * 所以"生产到底绑了谁"这件事必须活在这里，不能活在 `application/agent-import/`
 * ——哪怕组装的四个依赖里有三个本身来自别的 bounded context（skill 的取回层、
 * agent 既有的 create/instructions 仓储），装配动作本身仍然是 infrastructure 的事。
 *
 * ⚠ `ImportAgentFromUrlDepsFactory` 类型 + `IMPORT_AGENT_FROM_URL_DEPS_FACTORY`
 *   token **不**声明在本文件——它们声明在
 *   `application/agent-import/import-agent-from-url.ts`（同 skill 那份的分法）。
 *   controller 是 interface 层，只能 import application 层的类型/token，不能
 *   import 本文件；`kernel.module.ts` 才是把两头接起来的地方。
 *
 * ## 与 skill 那份唯一装配点同一条纪律
 *
 * `fetch` 绑的是 `infrastructure/skill/url-import-composition.ts` 导出的
 * `PRODUCTION_IMPORT_FETCHER`——**同一个函数对象**，不是再次 import
 * `fetchImportSource` 包一层。两条导入路径（skill 目录 / agent 单文件）共享同一套
 * SSRF 门与同一个生产绑定：哪天其中一条换了取回器而另一条没换，这里会因为复用同一个
 * 常量而在类型层面直接不通过，不是靠人自觉记得两处都要改。
 *
 * ⚠ 本文件暂无独立的同一性守卫测试（`url-import-binding-guard.test.ts` 目前只扫
 *   skill 那份）——复用同一个导出常量已经让"生产绑错取回器"这件事在字面上不可能
 *   发生，但"是否真的从 Nest 容器里解析出同一个函数对象"这件事和 skill 那条一样，
 *   目前只由类型系统与代码审阅保证，不是机械门控。这与 `AgentUrlImportRepository`
 *   已有 `agent-url-import-repo-guard.test.ts` 守卫是两件不同的事——那条守卫的是
 *   授权顺序与表名，不是取回器绑定本身。
 */
import { PRODUCTION_IMPORT_FETCHER } from "../skill/url-import-composition";
import { PgCreateAgentRepository, PgSetAgentInstructionsRepository } from "../agent/pg-create-agent-repository";
import { PgAgentUrlImportRepository } from "./pg-agent-url-import-repository";
import type { DatabasePort } from "../../application/ports/database.port";
import type { IdentityRepository } from "../../application/identity/ports";
import type { ImportAgentFromUrlDeps } from "../../application/agent-import/import-agent-from-url";

export function composeImportAgentFromUrlDeps(input: {
  readonly db: DatabasePort;
  readonly identities: IdentityRepository;
  /** 该组织是否处于 personal-local 出站承诺下（I-9）。逐请求推导，同 skill 那份。 */
  readonly localOnlyOrg: boolean;
}): ImportAgentFromUrlDeps {
  return {
    identities: input.identities,
    fetch: PRODUCTION_IMPORT_FETCHER,
    agents: new PgCreateAgentRepository(input.db),
    instructions: new PgSetAgentInstructionsRepository(input.db),
    imports: new PgAgentUrlImportRepository(input.db),
    policy: { localOnlyOrg: input.localOnlyOrg },
  };
}
