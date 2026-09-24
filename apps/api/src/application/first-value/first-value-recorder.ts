/**
 * backlog E3 —— 第一个价值时刻埋点（契约 `firstValueEvents`，D33；定义见
 * `docs/research/first-value-moment.md`）。
 *
 * 两条硬规则：
 * 1. **先写者胜**：每组织每步至多一条事实，重复记录是 no-op（存储层 `(org_id, step)` 唯一 +
 *    ON CONFLICT DO NOTHING）。所以调用点可以「每次都记」，不必自己判断是不是第一次。
 * 2. **绝不打断用户流程**：`record()` 同步返回 `void`，内部 fire-and-forget；存储抛错或
 *    同步抛错都只记日志、吞掉。埋点失败的代价是漏斗少一个点，不是用户的请求失败。
 *
 * 本地事实永不离开实例；离开实例的只有 `pg-telemetry-facts.ts` 聚合出来的计数（同意开启时）。
 */
import type { firstValueEvents as FV } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { LoggerPort } from "../ports/logger.port";

export type FirstValueStep = FV.FirstValueStepValue;

export interface FirstValueFactStore {
  /** 写一条事实；该组织该步已有事实时什么都不做（先写者胜）。 */
  recordFirst(orgId: OrgId, step: FirstValueStep, at: Date): Promise<void>;
  /** 本组织已到达的各步及其首次时刻（本地查看用，租户内读）。 */
  listForOrg(orgId: OrgId): Promise<readonly { step: FirstValueStep; occurredAt: Date }[]>;
}

export const FIRST_VALUE_FACT_STORE = Symbol("FirstValueFactStore");
export const FIRST_VALUE_RECORDER = Symbol("FirstValueRecorder");

export class FirstValueRecorder {
  constructor(
    private readonly store: FirstValueFactStore,
    private readonly logger: LoggerPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Fire-and-forget：永不抛、永不需要 await。 */
  record(orgId: OrgId | string | null | undefined, step: FirstValueStep): void {
    if (typeof orgId !== "string" || orgId === "") return;
    try {
      void this.store.recordFirst(orgId as OrgId, step, this.now()).catch((err: unknown) => this.fail(step, err));
    } catch (err) {
      this.fail(step, err);
    }
  }

  private fail(step: FirstValueStep, err: unknown): void {
    try {
      this.logger.error("first-value fact recording failed; ignored", { traceId: "first-value", step, err });
    } catch {
      /* 日志本身失败也不许冒泡到用户请求 */
    }
  }
}

/** 可选注入的调用点用：没有接线（单测里手工构造的控制器）时就是 no-op。 */
export function recordFirstValue(recorder: FirstValueRecorder | undefined, orgId: string | null | undefined, step: FirstValueStep): void {
  recorder?.record(orgId, step);
}
