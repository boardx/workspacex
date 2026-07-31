/**
 * `skill` 束用例的测试替身（F61）。
 *
 * 每个替身都**记录被调用了什么**，而不只是返回一个值：F61 的几条判据是
 * 「不入库」「不进待审核队列」「写审计」——它们都是**没发生 / 发生了什么**，
 * 断言返回码证明不了。
 */
import type {
  ContextApiPort,
  SecurityAuditPort,
  SkillDraftStorePort,
  SubmitterGrantsPort,
} from "../../src/application/skill/ports";
import type { DeclarativeContract } from "../../src/domain/skill/declarative-contract";

export interface AuditSpy extends SecurityAuditPort {
  readonly events: { kind: string; principalId: string; detail: string }[];
}

export function collectAudit(): AuditSpy {
  const events: { kind: string; principalId: string; detail: string }[] = [];
  return {
    events,
    async record(e) {
      events.push({ kind: e.kind, principalId: e.principalId, detail: e.detail });
    },
  };
}

export interface DraftStoreSpy extends SkillDraftStorePort {
  /** ⚠ 「失败不入库」的判据就是这个数组为空 */
  readonly saved: { name: string; source: string; contract: DeclarativeContract }[];
}

export function collectDraftStore(): DraftStoreSpy {
  const saved: { name: string; source: string; contract: DeclarativeContract }[] = [];
  let n = 0;
  return {
    saved,
    async saveDraft(input) {
      saved.push({ name: input.name, source: input.source, contract: input.contract });
      n += 1;
      return { skillId: `skill-${n}`, versionId: `ver-${n}` };
    },
  };
}

export function grantsOf(...keys: string[]): SubmitterGrantsPort {
  return { async grantsOf() { return keys; } };
}

/** Context Pack 的替身：`returnedScopes` 是它**实际返回**的那一份（I-24 的右操作数）。 */
export function contextApiReturning(...returnedScopes: string[]): ContextApiPort {
  return {
    async requestContextPack() {
      return { packId: "pack-1", returnedScopes };
    },
  };
}

/** 一份能过静态校验的最小契约。测试里只改它要考的那一格。 */
export function validContract(over: Partial<DeclarativeContract> = {}): DeclarativeContract {
  return {
    promptTemplate: "请对 {{输入}} 做 MECE 拆解",
    inputSchema: '{"type":"object","properties":{"topic":{"type":"string"}},"required":["topic"]}',
    outputSchema: '{"type":"object","properties":{"branches":{"type":"array"}},"required":["branches"]}',
    dataScope: ["project:notes"],
    readsRawTranscript: false,
    fallbackDeclaration: "输出不合 schema 时重试一次，仍失败则返回结构化失败并提示人工接手",
    ...over,
  };
}
