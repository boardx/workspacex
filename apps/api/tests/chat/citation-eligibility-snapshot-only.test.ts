/**
 * F114 —— V1：引用资格门只对固定快照放行（chat 束 domain.md F 组 I-34，uc-8-3 UC-21）。
 *
 * ## 断言方式：三种模式 × 四个下游接口，8 格拒绝 + 4 格成功
 *
 * `usecases.md` 的 R12 V1 逐字要求这是一个矩阵，不是抽样一格。这里对同一个
 * 落地请求形状（同样挂着一条可定位引用）分别以 `draft`/`live`/`pinned` 三种模式
 * 落地，再对每一个产出逐条打四个 purpose：`draft`/`live` 全部 8 格拒绝
 * （`REQUIRES_PINNED`），`pinned` 全部 4 格成功且返回的 `versionId` 与落地时的
 * `versionId` 一致——不是"至少一格通过"就算过。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatCitation, addChatMessage, addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f114-eligibility";
const PROJECT = "proj-f114-eligibility";
const THREAD = "f114-t-eligibility";

let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

interface LandOut {
  artifactId: string;
  versionId: string | null;
  mode: string;
  hasSource: boolean;
}

const land = async (
  userId: string,
  messageId: string,
  mode: "draft" | "live" | "pinned",
  title: string,
): Promise<{ status: number; body: LandOut }> => {
  const r = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts`, {
    method: "POST",
    headers: as(userId),
    body: JSON.stringify({ threadId: THREAD, messageId, mode, title, payloadRef: `结论：${title}` }),
  });
  return { status: r.status, body: (await r.json()) as LandOut };
};

interface EligibilityOut {
  allowed?: true;
  versionId?: string;
  reasonCode?: string;
}

const checkEligibility = async (
  userId: string,
  artifactId: string,
  purpose: string,
): Promise<{ status: number; body: EligibilityOut }> => {
  const r = await fetch(`${BASE}/chat/artifacts/${artifactId}/downstream-eligibility`, {
    method: "POST",
    headers: as(userId),
    body: JSON.stringify({ artifactId, purpose }),
  });
  return { status: r.status, body: (await r.json()) as EligibilityOut };
};

const FOUR_PURPOSES = ["report-final", "submit-acceptance", "decision-evidence", "write-back-kg"];

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-fac", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null);

  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, groupId: null,
    visibilityScope: "plenary", createdBy: "u-fac", title: "引用资格门",
  });
});

/** 造一条带一个可定位引用的消息，返回 messageId。 */
async function seedGroundedMessage(messageId: string, citationId: string): Promise<string> {
  await addChatMessage({
    orgId: ORG, id: messageId, threadId: THREAD, authorId: "u-fac", body: "有引用的结论",
  });
  await addChatCitation({
    orgId: ORG, citationId, messageId, index: 1,
    sourceFullName: "《市场准入研究》.pdf", anchorKind: "page", anchorPage: 12,
  });
  return messageId;
}

describe("V1：三模式 × 四用途的 12 格矩阵——8 格拒绝、4 格成功", () => {
  it("draft 模式：四个下游接口全部 REQUIRES_PINNED 拒绝", async () => {
    const messageId = await seedGroundedMessage("f114-m-draft", "f114-c-draft");
    const { status: landStatus, body: draft } = await land("u-fac", messageId, "draft", "草稿结论");
    expect(landStatus).toBe(200);
    expect(draft.mode).toBe("draft");

    for (const purpose of FOUR_PURPOSES) {
      const { status, body } = await checkEligibility("u-fac", draft.artifactId, purpose);
      expect(status).toBe(422);
      expect(body.reasonCode).toBe("REQUIRES_PINNED");
    }
  });

  it("live 模式：四个下游接口全部 REQUIRES_PINNED 拒绝——实时关联不等于快照", async () => {
    const messageId = await seedGroundedMessage("f114-m-live", "f114-c-live");
    const { status: landStatus, body: live } = await land("u-fac", messageId, "live", "实时关联结论");
    expect(landStatus).toBe(200);
    expect(live.mode).toBe("live");
    expect(live.versionId).toBeNull();

    for (const purpose of FOUR_PURPOSES) {
      const { status, body } = await checkEligibility("u-fac", live.artifactId, purpose);
      expect(status).toBe(422);
      expect(body.reasonCode).toBe("REQUIRES_PINNED");
    }
  });

  it("pinned 模式：四个下游接口全部成功，且返回的 versionId 与落地时一致", async () => {
    const messageId = await seedGroundedMessage("f114-m-pinned", "f114-c-pinned");
    const { status: landStatus, body: pinned } = await land("u-fac", messageId, "pinned", "已定版结论");
    expect(landStatus).toBe(200);
    expect(pinned.mode).toBe("pinned");
    expect(pinned.versionId).not.toBeNull();

    for (const purpose of FOUR_PURPOSES) {
      const { status, body } = await checkEligibility("u-fac", pinned.artifactId, purpose);
      expect(status).toBe(200);
      expect(body.allowed).toBe(true);
      expect(body.versionId).toBe(pinned.versionId);
    }
  });
});
