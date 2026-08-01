/**
 * F114 —— V3：未挂来源的结论标灰门（chat 束 domain.md F 组 I-37，uc-8-3 AC3）。
 *
 * `hasSource` 是服务端可判定的状态，不是纯视觉：一条没有引用的结论
 *   ① 只能显式落 `draft`——请求 `live`/`pinned` 被拒（`MISSING_PROVENANCE_BACKLINK`）；
 *   ② 落地后 `hasSource === false`，右栏「产物」列表里同一条也是 `hasSource === false`；
 *   ③ 调「加入报告」（`checkDownstreamEligibility` 的 `report-final`）被拒。
 * 三条逐一断言，不满足于"落地成功了"就算过。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatMessage, addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f114-greyed";
const PROJECT = "proj-f114-greyed";
const THREAD = "f114-t-greyed";

let BASE: string;
let app: NestExpressApplication;

const as = (userId: string) => ({
  "x-kernel-test-principal": `${userId}:${ORG}`,
  "content-type": "application/json",
});

interface LandOut {
  artifactId?: string;
  versionId?: string | null;
  mode?: string;
  hasSource?: boolean;
  reasonCode?: string;
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

interface ThreadArtifactsOut {
  items: { artifactId: string; hasSource: boolean; mode: string }[];
}

const listArtifacts = async (userId: string): Promise<{ status: number; body: ThreadArtifactsOut }> => {
  const r = await fetch(`${BASE}/chat/threads/${THREAD}/artifacts?projectId=${PROJECT}`, {
    headers: as(userId),
  });
  return { status: r.status, body: (await r.json()) as ThreadArtifactsOut };
};

const checkEligibility = async (
  userId: string,
  artifactId: string,
  purpose: string,
): Promise<{ status: number; body: { allowed?: true; reasonCode?: string } }> => {
  const r = await fetch(`${BASE}/chat/artifacts/${artifactId}/downstream-eligibility`, {
    method: "POST",
    headers: as(userId),
    body: JSON.stringify({ artifactId, purpose }),
  });
  return { status: r.status, body: (await r.json()) as { allowed?: true; reasonCode?: string } };
};

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
    visibilityScope: "plenary", createdBy: "u-fac", title: "标灰门",
  });
});

describe("V3：无引用的结论——只能落草稿，落地后 hasSource 恒为 false，加报告被拒", () => {
  it("① 请求 live 被拒：MISSING_PROVENANCE_BACKLINK", async () => {
    await addChatMessage({
      orgId: ORG, id: "f114-m-ungrounded-live", threadId: THREAD, authorId: "u-fac",
      body: "没有挂引用的结论",
    });
    const { status, body } = await land("u-fac", "f114-m-ungrounded-live", "live", "无引用结论");
    expect(status).toBe(422);
    expect(body.reasonCode).toBe("MISSING_PROVENANCE_BACKLINK");
  });

  it("① 请求 pinned 同样被拒：MISSING_PROVENANCE_BACKLINK", async () => {
    await addChatMessage({
      orgId: ORG, id: "f114-m-ungrounded-pinned", threadId: THREAD, authorId: "u-fac",
      body: "没有挂引用的结论",
    });
    const { status, body } = await land("u-fac", "f114-m-ungrounded-pinned", "pinned", "无引用结论");
    expect(status).toBe(422);
    expect(body.reasonCode).toBe("MISSING_PROVENANCE_BACKLINK");
  });

  it("② 显式落 draft 成功，hasSource === false——接口响应与列表两处一致", async () => {
    await addChatMessage({
      orgId: ORG, id: "f114-m-ungrounded-draft", threadId: THREAD, authorId: "u-fac",
      body: "没有挂引用的结论",
    });
    const { status, body: draft } = await land("u-fac", "f114-m-ungrounded-draft", "draft", "无引用草稿");
    expect(status).toBe(200);
    expect(draft.hasSource).toBe(false);

    const { status: listStatus, body: list } = await listArtifacts("u-fac");
    expect(listStatus).toBe(200);
    const item = list.items.find((i) => i.artifactId === draft.artifactId);
    expect(item).toBeDefined();
    expect(item!.hasSource).toBe(false);
    expect(item!.mode).toBe("draft");
  });

  it("③ 调「加入报告」（report-final）被拒——未挂来源不能直接进报告", async () => {
    await addChatMessage({
      orgId: ORG, id: "f114-m-ungrounded-report", threadId: THREAD, authorId: "u-fac",
      body: "没有挂引用的结论",
    });
    const { body: draft } = await land("u-fac", "f114-m-ungrounded-report", "draft", "无引用草稿");
    const { status, body } = await checkEligibility("u-fac", draft.artifactId!, "report-final");
    expect(status).toBe(422);
    expect(body.reasonCode).toBe("REQUIRES_PINNED");
  });

  it("反证：挂了引用的结论不受本门影响——draft 请求正常成功且 hasSource === true", async () => {
    const { addChatCitation } = await import("../support/chat-db");
    await addChatMessage({
      orgId: ORG, id: "f114-m-grounded", threadId: THREAD, authorId: "u-fac", body: "有引用的结论",
    });
    await addChatCitation({
      orgId: ORG, citationId: "f114-c-grounded", messageId: "f114-m-grounded", index: 1,
      sourceFullName: "《对照组》.pdf", anchorKind: "page", anchorPage: 1,
    });
    const { status, body } = await land("u-fac", "f114-m-grounded", "draft", "有引用草稿");
    expect(status).toBe(200);
    expect(body.hasSource).toBe(true);
  });
});
