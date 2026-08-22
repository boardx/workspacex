/**
 * P2（#1561）—— 推理侧图像通道：接线、诚实降级、上界，全部用纯内存 fake 反证。
 *
 * ## 这里反证的是什么
 *
 * #1558 逐层确诊出的那条断链：「上传路径是通的，理解路径是断的」。所以每条断言都指向
 * 一个**具体的、曾经真实发生过的坏形态**：
 *   ① 图的字节根本到不了 provider（`ModelCallInput` 没有图像位）——反证：`images` 真的到了。
 *   ② 模型看不到图，产品却不告诉任何人——反证：降级时模型收到的文本里必须有明确告知。
 *   ③ 超限被静默截断——反证：没送的每一张都要带着**具体原因**出现在模型可读文本里。
 *   ④ 审计链断在这一格——反证：快照必须如实记「送了几张 / 没送几张 / 什么态」。
 *
 * ## 刻意不打真实外部 API（#1561 硬性纪律）
 *
 * 真实模型名的可用性由 `apps/api/scripts/probe-bailian-vision.mjs` 在有 key 的环境单独
 * 出证据。本文件如果去打真实端点，得到的是一个"网络好不好"的随机测试，而不是"接线对
 * 不对"的确定性反证。
 */
import { describe, expect, it, vi } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import {
  MODEL_CALL_MAX_IMAGE_BYTES, MODEL_CALL_MAX_IMAGES,
} from "../../src/application/agent-run/ports";
import type {
  AgentRunStore, AppendedRunDelta, AppendedRunStep, ClaimOutcome, ClaimedAgentRun, ModelCallInput,
  ModelCallPort, PinnedSkillContent, RunDelta, RunFailureCode, RunLocator, RunProjection,
  ThreadHistoryMessage,
} from "../../src/application/agent-run/ports";
import type {
  AgentRunContextSnapshotInput, AgentRunContextSnapshotPort,
} from "../../src/application/agent-run/context-snapshot";
import type {
  RunImagePort, RunImageRef, RunImageScope,
} from "../../src/application/agent-run/run-image-input";
import { selectImagesWithinBounds } from "../../src/application/agent-run/run-image-input";
import type { Guarded } from "../../src/application/security/permission-filter";

const ORG = toOrgId("org-i1561-vision");
const PNG = "image/png";

function baseRun(overrides: Partial<ClaimedAgentRun> = {}): ClaimedAgentRun {
  return {
    runId: "run-1", threadId: "thread-1", projectId: null, inputMessageId: "msg-now",
    requesterUserId: "user-1", inputText: "图里画了什么？", inputAttachments: [],
    agentId: "agent-1", agentVersionId: "agent-version-1", instructions: "你是通用助手",
    skillVersionIds: [], modelProvider: "test-provider", modelId: "test-model", pendingDecision: null,
    ...overrides,
  };
}

function fakeStore(run: ClaimedAgentRun): AgentRunStore {
  const unused = (name: string) => async (): Promise<never> => {
    throw new Error(`fakeStore.${name} not expected in this test`);
  };
  return {
    claimQueued: async (): Promise<readonly ClaimOutcome[]> => [{ kind: "executable", run }],
    readPinnedSkills: async (): Promise<readonly PinnedSkillContent[]> => [],
    appendStep: async (_o, _s: AppendedRunStep) => {},
    appendModelDelta: async (_o, _d: AppendedRunDelta) => {},
    readModelDeltas: async (): Promise<readonly RunDelta[]> => [],
    storeOutputAwaitingWriteback: async () => {},
    failRun: async (_o, _r, _c: RunFailureCode) => {},
    async markAwaitingApproval() { throw new Error('unexpected markAwaitingApproval in this test'); },
    async approveAndRequeue() { throw new Error('unexpected approveAndRequeue in this test'); return false; },
    claimWritebackPending: unused("claimWritebackPending"),
    commitWriteback: unused("commitWriteback"),
    recordWritebackAttempt: unused("recordWritebackAttempt"),
    reopenForWritebackRetry: unused("reopenForWritebackRetry"),
    appendWritebackFailure: unused("appendWritebackFailure"),
    findLocator: async (): Promise<RunLocator | null> => null,
    readRun: async (): Promise<Guarded<RunProjection> | null> => null,
    readThreadHistory: async (): Promise<readonly ThreadHistoryMessage[]> => [],
    readThreadContextState: async () => null,
    upsertThreadContextState: async () => true,
  };
}

/** 捕获模型这一轮真正收到了什么。 */
function capturingModel(canSee: boolean): {
  port: ModelCallPort;
  seen: () => ModelCallInput;
} {
  let captured: ModelCallInput | null = null;
  const port: ModelCallPort = {
    complete: async (input) => { captured = input; return { text: "回答", tokens: 1 }; },
    ...(canSee ? { supportsVision: () => true } : {}),
  };
  return {
    port,
    seen: () => {
      if (captured === null) throw new Error("model was never called");
      return captured;
    },
  };
}

/** 一个可编程的图像端口：给几条 ref、每条给多少字节，或让它抛。 */
function fakeImages(
  refs: readonly RunImageRef[],
  opts: { listThrows?: boolean; readThrows?: boolean; missing?: readonly string[] } = {},
): { port: RunImagePort; scopes: RunImageScope[] } {
  const scopes: RunImageScope[] = [];
  return {
    scopes,
    port: {
      list: async (_o, scope) => {
        scopes.push(scope);
        if (opts.listThrows === true) throw new Error("db jitter");
        return refs;
      },
      read: async (_o, scope, id) => {
        scopes.push(scope);
        if (opts.readThrows === true) throw new Error("object store jitter");
        if (opts.missing?.includes(id) === true) return null;
        return new Uint8Array([1, 2, 3, 4]);
      },
    },
  };
}

function ref(n: number, byteSize = 1_000, mime = PNG): RunImageRef {
  return { attachmentId: `att-${n}`, filename: `图-${n}.png`, mime, byteSize };
}

function deps(
  run: ClaimedAgentRun,
  model: ModelCallPort,
  images?: RunImagePort,
  snapshots?: AgentRunContextSnapshotPort,
): ExecuteAgentRunDeps {
  let clock = 0;
  return {
    runs: fakeStore(run), model,
    clock: { now: () => new Date(clock++).toISOString(), newStepId: () => `step-${clock}` },
    log: vi.fn(),
    ...(images ? { runImages: images } : {}),
    ...(snapshots ? { contextSnapshots: snapshots } : {}),
  };
}

function capturingSnapshots(): {
  port: AgentRunContextSnapshotPort;
  written: () => AgentRunContextSnapshotInput;
} {
  let captured: AgentRunContextSnapshotInput | null = null;
  return {
    port: {
      record: async (_o, s) => { captured = s; },
      findByRunId: async () => null,
    },
    written: () => {
      if (captured === null) throw new Error("no snapshot was written");
      return captured;
    },
  };
}

describe("selectImagesWithinBounds（纯函数：上界不是静默截断）", () => {
  it("张数超限 → 多出来的**逐张带原因**出局，且保留用户上传顺序的前 N 张", () => {
    const refs = Array.from({ length: MODEL_CALL_MAX_IMAGES + 2 }, (_, i) => ref(i));
    const { accepted, omitted } = selectImagesWithinBounds(refs);
    expect(accepted).toHaveLength(MODEL_CALL_MAX_IMAGES);
    expect(accepted.map((r) => r.attachmentId)).toEqual(
      refs.slice(0, MODEL_CALL_MAX_IMAGES).map((r) => r.attachmentId),
    );
    expect(omitted).toHaveLength(2);
    for (const o of omitted) expect(o.reason).toContain(String(MODEL_CALL_MAX_IMAGES));
  });

  it("超体积的那一张出局，且**不占**张数名额（不该把后面能看的图挤掉）", () => {
    const huge = ref(0, MODEL_CALL_MAX_IMAGE_BYTES + 1);
    const rest = Array.from({ length: MODEL_CALL_MAX_IMAGES }, (_, i) => ref(i + 1));
    const { accepted, omitted } = selectImagesWithinBounds([huge, ...rest]);
    expect(accepted).toHaveLength(MODEL_CALL_MAX_IMAGES);
    expect(accepted.map((r) => r.attachmentId)).not.toContain("att-0");
    expect(omitted).toHaveLength(1);
    expect(omitted[0]?.reason).toContain("超过单张上限");
  });

  it("非图像 mime 被第二道纯门挡下（防止将来 SQL 谓词被放宽就把 pdf 字节送去视觉端点）", () => {
    const { accepted, omitted } = selectImagesWithinBounds([ref(1, 100, "application/pdf")]);
    expect(accepted).toHaveLength(0);
    expect(omitted[0]?.reason).toContain("application/pdf");
  });
});

describe("executeQueuedRuns —— 图像真的到达 provider（#1558 断链的正面反证）", () => {
  it("模型有视觉能力 → 图片字节进 ModelCallInput.images，且取图范围锚在本轮触发消息", async () => {
    const run = baseRun({ inputAttachments: [{ filename: "图-1.png", mime: PNG }] });
    const model = capturingModel(true);
    const images = fakeImages([ref(1)]);
    const snaps = capturingSnapshots();

    await executeQueuedRuns(deps(run, model.port, images.port, snaps.port), { orgId: ORG });

    const seen = model.seen();
    expect(seen.images).toHaveLength(1);
    expect(seen.images?.[0]?.mime).toBe(PNG);
    expect(Array.from(seen.images?.[0]?.bytes ?? [])).toEqual([1, 2, 3, 4]);
    // 范围就到本轮触发消息为止——不跨消息、不跨线程，见 run-image-input.ts 头注。
    for (const scope of images.scopes) {
      expect(scope).toEqual({ threadId: "thread-1", messageId: "msg-now", actorUserId: "user-1" });
    }
    // 全部送到了 ⇒ 不加任何噪声文本（模型自己看得见，不需要用文字复述）。
    expect(seen.user).not.toContain("未能送入模型");
    expect(seen.user).not.toContain("看不到");
    const snap = snaps.written();
    expect(snap.visionStatus).toBe("ok");
    expect(snap.visionImageCount).toBe(1);
    expect(snap.visionOmittedCount).toBe(0);
  });
});

describe("诚实降级 —— 绝不静默丢弃（#1561 交付契约第 4 条）", () => {
  it("模型没有视觉能力 → images 根本不传，且模型被明确告知它看不到图", async () => {
    const run = baseRun({ inputAttachments: [{ filename: "图-1.png", mime: PNG }] });
    const model = capturingModel(false); // supportsVision 缺席 ⇒ fail closed
    const images = fakeImages([ref(1)]);
    const snaps = capturingSnapshots();

    await executeQueuedRuns(deps(run, model.port, images.port, snaps.port), { orgId: ORG });

    const seen = model.seen();
    expect(seen.images).toBeUndefined();
    expect(seen.user).toContain("不具备视觉输入能力");
    expect(seen.user).toContain("看不到这些图的内容");
    // 反证 #1558 那句"用户以为模型看过了"：模型被明确要求不要假装看过。
    expect(seen.user).toContain("不要凭文件名猜测或假装看过");
    // 没有视觉能力时不该白白去读字节（那是一次没有用处的存储 I/O）。
    expect(images.scopes).toHaveLength(0);
    const snap = snaps.written();
    expect(snap.visionStatus).toBe("not_supported");
    expect(snap.visionImageCount).toBe(0);
    expect(snap.visionOmittedCount).toBe(1);
  });

  it("列图失败 → run 照常完成，但模型被告知『这轮没取到图』（不是『本来没有图』）", async () => {
    const run = baseRun({ inputAttachments: [{ filename: "图-1.png", mime: PNG }] });
    const model = capturingModel(true);
    const images = fakeImages([ref(1)], { listThrows: true });
    const snaps = capturingSnapshots();

    await executeQueuedRuns(deps(run, model.port, images.port, snaps.port), { orgId: ORG });

    const seen = model.seen();
    expect(seen.images).toBeUndefined();
    expect(seen.user).toContain("读取这些图片时出错");
    expect(snaps.written().visionStatus).toBe("degraded");
  });

  it("字节在存储里没了 → 那一张带具体原因出现在模型可读文本里", async () => {
    const run = baseRun({
      inputAttachments: [{ filename: "图-1.png", mime: PNG }, { filename: "图-2.png", mime: PNG }],
    });
    const model = capturingModel(true);
    const images = fakeImages([ref(1), ref(2)], { missing: ["att-1"] });
    const snaps = capturingSnapshots();

    await executeQueuedRuns(deps(run, model.port, images.port, snaps.port), { orgId: ORG });

    const seen = model.seen();
    expect(seen.images).toHaveLength(1);
    expect(seen.user).toContain("图-1.png");
    expect(seen.user).toContain("图像内容在存储中不存在");
    const snap = snaps.written();
    expect(snap.visionStatus).toBe("ok");
    expect(snap.visionImageCount).toBe(1);
    expect(snap.visionOmittedCount).toBe(1); // 传了 2 张、看到 1 张，差额如实入账
  });

  it("超张数上限 → 送前 N 张，其余**逐条写清原因**给模型（不静默截断）", async () => {
    const total = MODEL_CALL_MAX_IMAGES + 1;
    const run = baseRun({
      inputAttachments: Array.from({ length: total }, (_, i) => ({ filename: `图-${i}.png`, mime: PNG })),
    });
    const model = capturingModel(true);
    const images = fakeImages(Array.from({ length: total }, (_, i) => ref(i)));
    const snaps = capturingSnapshots();

    await executeQueuedRuns(deps(run, model.port, images.port, snaps.port), { orgId: ORG });

    const seen = model.seen();
    expect(seen.images).toHaveLength(MODEL_CALL_MAX_IMAGES);
    expect(seen.user).toContain("未能送入模型");
    expect(seen.user).toContain(`图-${total - 1}.png`);
    expect(seen.user).toContain("张数上限");
    const snap = snaps.written();
    expect(snap.visionImageCount).toBe(MODEL_CALL_MAX_IMAGES);
    expect(snap.visionOmittedCount).toBe(1);
  });
});

describe("回归 —— 不带图的路径与未接通道的部署逐字节不变", () => {
  it("没有图片附件 → 不调图像端口、user 文本不多一个字、快照记 none", async () => {
    const run = baseRun({ inputAttachments: [{ filename: "简历.pdf", mime: "application/pdf" }] });
    const model = capturingModel(true);
    const images = fakeImages([ref(1)]);
    const snaps = capturingSnapshots();

    await executeQueuedRuns(deps(run, model.port, images.port, snaps.port), { orgId: ORG });

    expect(images.scopes).toHaveLength(0);
    const seen = model.seen();
    expect(seen.images).toBeUndefined();
    expect(seen.user).not.toContain("看不到");
    expect(snaps.written().visionStatus).toBe("none");
  });

  it("有图但没注入 runImages（trial-run 一类路径）→ user 文本不加第二句提示，快照记 not_configured", async () => {
    const run = baseRun({ inputAttachments: [{ filename: "图-1.png", mime: PNG }] });
    const withPort = capturingModel(true);
    const snaps = capturingSnapshots();

    await executeQueuedRuns(deps(run, withPort.port, undefined, snaps.port), { orgId: ORG });

    const seen = withPort.seen();
    expect(seen.images).toBeUndefined();
    // F153 的附件提示已经如实说过"这个附件读不到内容"，不再叠第二句（见 VisionInputStatus 文档）。
    expect(seen.user).not.toContain("不具备视觉输入能力");
    expect(snaps.written().visionStatus).toBe("not_configured");
    expect(snaps.written().visionOmittedCount).toBe(1);
  });
});
