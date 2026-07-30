/**
 * F47 ① —— `invalidateOntologyEdges` 契约先行桩（09-kg，phase-02 实现）
 *
 * 删除传播六类级联的第 ⑤ 类：把相关 `ontology_edges` 的 `status` 置为 `invalidated`。
 * **实现体属 phase-02 的 09-kg**；phase-01 只出契约与桩。
 *
 * ⚠ 本文件的断言分四层，缺任何一层这条 feature 就退化成空壳：
 *   ① 契约层：形状 / 错误码 / 幂等 —— 由 `runPortConformance` 对**任意实现**跑
 *   ② 不变性层：同一套断言在桩与「假装是 phase-02」的成功实现上**都过**
 *      ⇒ 契约不依赖桩的内部，换实现时不用改一个字
 *   ③ 桩的语义层：桩**绝不返回成功**，它抛已声明的 `CASCADE_TARGET_UNAVAILABLE`
 *   ④ 反证层：故意写坏的实现必须被抓住；空集不算通过
 */
import { describe, expect, it } from "vitest";
import * as files from "../../src/files";
import {
  CascadeTargetUnavailableError,
  PHASE_02_OUT_OF_SCOPE,
  assertPortInput,
  phase01OutboundStubs,
} from "../../src/files-outbound-stubs";
import {
  VALID_INPUT,
  brokenImpls,
  callPort,
  checkCaseCoverage,
  runPortConformance,
} from "./outbound-port-conformance";

const PORT = "invalidateOntologyEdges" as const;

/** 「假装是 phase-02 的 09-kg」——只走成功路径。**它证明契约断言不依赖桩** */
const fakePhase02Kg = async (input: unknown) => {
  assertPortInput(PORT, input);
  const { versionIds } = input as { versionIds: string[] };
  return { invalidatedEdgeIds: versionIds.map((v) => `edge-of-${v}`) };
};

/* ① + ② 同一套契约断言，跑两个完全不同的实现 */
runPortConformance(PORT, "phase-01 契约桩", phase01OutboundStubs[PORT]);
runPortConformance(PORT, "假装是 phase-02 的 09-kg（成功路径）", fakePhase02Kg);

describe("invalidateOntologyEdges · 契约登记", () => {
  it("端口登记在 OUTBOUND_PORTS 这一处，且指名 09-kg / phase-02", () => {
    expect(Object.keys(files.OUTBOUND_PORTS)).toContain(PORT);
    expect(files.OUTBOUND_PORTS[PORT].providedBy).toContain("09-kg");
    expect(files.OUTBOUND_PORTS[PORT].providedBy).toContain("phase-02");
  });

  it("它落在六类级联的第 ⑤ 类上（cascadeKind 必须是 CascadeKind 的成员）", () => {
    const kind = files.OUTBOUND_PORTS[PORT].cascadeKind;
    expect(kind).toBe("ontology-edges");
    expect(files.CascadeKind.options).toContain(kind);
  });

  it("失败码就是级联目标不可用——调用方据此把第 ⑤ 类记 failed", () => {
    expect(files.OUTBOUND_PORTS[PORT].err).toEqual(["CASCADE_TARGET_UNAVAILABLE"]);
    expect(files.operations.retryCascade.err).toContain("CASCADE_TARGET_UNAVAILABLE");
  });
});

describe("invalidateOntologyEdges · 桩的语义（③）", () => {
  it("🔴 桩绝不返回成功：返回 { invalidatedEdgeIds: [] } 的桩会让第 ⑤ 类假绿", async () => {
    const outcome = await callPort(phase01OutboundStubs[PORT], VALID_INPUT[PORT]);
    expect(outcome.kind).toBe("err");
  });

  it("抛的是已声明的失败，且带上是哪个端口、谁该提供", async () => {
    const outcome = await callPort(phase01OutboundStubs[PORT], VALID_INPUT[PORT]);
    const err = (outcome as { error: unknown }).error;
    expect(err).toBeInstanceOf(CascadeTargetUnavailableError);
    expect((err as CascadeTargetUnavailableError).code).toBe("CASCADE_TARGET_UNAVAILABLE");
    expect((err as CascadeTargetUnavailableError).port).toBe(PORT);
    expect((err as CascadeTargetUnavailableError).providedBy).toContain("09-kg");
  });

  it("不是 `throw new Error(\"not implemented\")`：那种错误在本套件里判违规", () => {
    const bare = brokenImpls(PORT).find((b) => b.name.includes("not implemented"));
    expect(bare, "反证用例本身不能消失").toBeTruthy();
    expect(bare!.check().length, "裸 Error 必须被判违规").toBeGreaterThan(0);
  });
});

describe("invalidateOntologyEdges · 反证（④）", () => {
  const broken = brokenImpls(PORT);

  it("反证集合非空——空集不算通过", () => {
    expect(checkCaseCoverage("ontology 反证集合", broken.length, 5)).toEqual([]);
  });

  it.each(broken.map((b) => [b.name, b] as const))("必须抓住：%s", (_name, b) => {
    expect(b.check().length, "这个坏实现没被任何一条检查抓到 —— 断言太松").toBeGreaterThan(0);
  });
});

describe("invalidateOntologyEdges · phase-02 范围登记（不静默省略）", () => {
  it("09-kg 侧的实现体被具名登记为不在本 feature 范围内", () => {
    expect(PHASE_02_OUT_OF_SCOPE.KG_EDGE_INVALIDATION_BODY).toContain("09-kg");
    expect(PHASE_02_OUT_OF_SCOPE.KG_EDGE_INVALIDATION_BODY).toContain("phase-02");
  });

  it("空结果集的歧义登记在 FS13，而不是被一个自造字段悄悄补上", () => {
    expect(files.KNOWN_CONTRACT_GAPS.FS13).toContain("cannot distinguish");
    expect(Object.keys(files.OUTBOUND_PORTS[PORT].out.shape)).toEqual(["invalidatedEdgeIds"]);
  });
});
