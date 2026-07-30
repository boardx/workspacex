/**
 * `skill` 束的 application 层端口（F61）。
 *
 * 洋葱中层：**只依赖 domain**，不知道 HTTP、不知道 PostgreSQL。
 * `infrastructure` 实现这些端口（依赖倒置），`interface` 调用用例。
 *
 * ## ⚠ 这里刻意**没有**的端口（缺了是结论，不是遗漏）
 *
 * · **没有 `SkillRuntime` / `Sandbox` / `CodeLoader`** —— D-06 已裁 phase-1 无沙箱、
 *   不执行任意代码。留一个空接口等于给下一个人一个入口（同契约文件头的措辞）。
 * · **没有数据库端口以外的取数通路** —— I-25：skill 运行时读上下文**只能**向
 *   Context API 请求 Context Pack。所以本文件只有 `ContextApiPort` 一个取数端口，
 *   而 `lint-skill-context-api-only.mjs` 机械保证 skill 模块的 import 图里
 *   没有 pg / 向量库客户端。**契约上唯一 ＋ 结构上唯一**，两条都要：
 *   只有前者时，加一行 `import pg` 就能绕过。
 */
import type { DataScopeKey } from "../../domain/skill/data-scope";
import type { SecurityScanResult } from "../../domain/skill/security-gate";
import type { DeclarativeContract } from "../../domain/skill/declarative-contract";

/**
 * 提交人**当时**持有的数据范围（I-12 的上界）。
 *
 * 是端口而不是入参，因为「当时」这个词有内容：E6 要求操作过程中权限被撤回时
 * 立即终止后续写操作，那需要一次真实的、可在中途重问的解析。
 */
export interface SubmitterGrantsPort {
  grantsOf(principalId: string): Promise<readonly DataScopeKey[]>;
}

/**
 * 安全扫描器（门禁第一道，自动）。
 *
 * 扫的是**声明式内容本身**，所以入参是契约文本而不是一个版本 id 加一次装载。
 */
export interface SecurityScannerPort {
  scan(contract: DeclarativeContract): Promise<SecurityScanResult>;
}

/**
 * **Context API —— skill 运行时唯一的取数通路**（I-25 / I-24）。
 *
 * ⚠ 返回值里 `packId` 不是装饰：I-24 要求每一次 skill 运行**留下一条
 *   `context_packs` 记录**且可重放。一个不返回 pack 标识的取数端口，
 *   事后无法回答「这条结论当时看了什么」。
 */
export interface ContextApiPort {
  requestContextPack(input: {
    readonly runId: string;
    readonly orgId: string;
    readonly principalId: string;
    readonly query: string;
  }): Promise<{
    readonly packId: string;
    /** Context Pack **实际返回**的数据范围项。有效范围 ＝ 声明范围 ∩ 本项（I-24） */
    readonly returnedScopes: readonly DataScopeKey[];
  }>;
}

/** 草稿落库。⚠ 静态校验/越权检查**失败即不入库**，所以它只在成功路径上被调用。 */
export interface SkillDraftStorePort {
  saveDraft(input: {
    readonly orgId: string;
    readonly name: string;
    readonly duty: string;
    readonly contract: DeclarativeContract;
    readonly source: string;
    readonly submitterId: string;
  }): Promise<{ readonly skillId: string; readonly versionId: string }>;
}

/**
 * 安全审计。⚠ I-23 逐字要求绕过尝试**写审计**——
 * 一次没有留痕的拒绝，事后无法与「从未发生」区分。
 */
export interface SecurityAuditPort {
  record(event: {
    readonly kind: "skill-gate-bypass-attempt" | "skill-source-tag-write-attempt";
    readonly principalId: string;
    readonly detail: string;
  }): Promise<void>;
}
