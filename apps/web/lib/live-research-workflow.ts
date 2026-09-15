/**
 * 研判工作流的前端端口 —— 阶段、材料、三道人工门。
 *
 * 薄封装，零判断：**「能不能过这道门」由服务端答**。前端若自己先判一遍
 * （比如"看起来材料都 accepted 了，那就把按钮点亮"），就会出现两种更糟的结果：
 * 要么前端比服务端宽松 ⇒ 用户点了才发现被拒（假按钮）；要么比服务端严格 ⇒
 * 明明能过的门点不了，且没人知道为什么。
 *
 * 所以这里只做一件事：把服务端的 409 拒绝**原样带回 reasonCode**，交给界面翻成人话。
 */
import { researchWorkflow as C } from "@repo/contracts";
import type { z } from "zod";
import { apiRequest, ApiError } from "./api-client";

export type ResearchSession = z.infer<typeof C.ResearchSession>;
export type ResearchMaterial = z.infer<typeof C.ResearchMaterial>;
export type ResearchAuditEntry = {
  actorKind: "human" | "agent";
  action: string;
  fromPhase: C.ResearchPhaseName;
  outcome: "allowed" | "refused";
  refusal: C.ResearchRefusalName | null;
  createdAt: string;
};

const base = (threadId: string) => `/threads/${encodeURIComponent(threadId)}`;

export async function getResearchSession(threadId: string): Promise<ResearchSession> {
  return apiRequest<ResearchSession>(`${base(threadId)}/research-session`, { method: "GET" });
}

export async function getResearchAudit(threadId: string): Promise<ResearchAuditEntry[]> {
  return apiRequest<ResearchAuditEntry[]>(`${base(threadId)}/research-audit`, { method: "GET" });
}

export async function addResearchMaterials(
  threadId: string,
  materials: readonly { source: z.infer<typeof C.MaterialSource>; label: string }[],
): Promise<ResearchSession> {
  return apiRequest<ResearchSession>(`${base(threadId)}/research-materials`, {
    method: "POST",
    body: { materials },
  });
}

export async function reviewResearchMaterial(
  threadId: string,
  materialId: string,
  verdict: C.MaterialVerdictName,
  note: string | null,
): Promise<ResearchSession> {
  return apiRequest<ResearchSession>(
    `${base(threadId)}/research-materials/${encodeURIComponent(materialId)}/review`,
    { method: "POST", body: { verdict, note } },
  );
}

export async function passResearchGate(
  threadId: string,
  gate: C.ResearchGateName,
): Promise<ResearchSession> {
  return apiRequest<ResearchSession>(`${base(threadId)}/research-gate`, {
    method: "POST",
    body: { gate },
  });
}

/**
 * 把一次失败翻成**用户能据以行动的一句话**。
 *
 * 分成"发生了什么"与"那我该做什么"两半是刻意的：只说前半句（哪怕说得准确）
 * 仍然把用户扔在原地。评分卡 U3 要的就是后半句。
 */
export function explainResearchFailure(err: unknown): { what: string; next: string } {
  const code = err instanceof ApiError ? (err.reasonCode as C.ResearchRefusalName | undefined) : undefined;
  switch (code) {
    case "MATERIALS_UNRESOLVED":
      return { what: "还有材料没有逐条判定完", next: "把清单里仍是「待审」的材料逐条标为通过、缺失或有误" };
    case "NO_MATERIALS":
      return { what: "这条研判还没有任何材料", next: "先粘贴文字、上传文件或给一个链接" };
    case "GATE_NOT_PASSED":
      return { what: "前一道人工确认门还没通过", next: "回到上一步完成确认后再来" };
    case "ATTEMPTS_EXHAUSTED":
      return { what: "这条材料的重新采集次数已用尽", next: "换一份材料，或直接标为「缺失」让它不再阻塞" };
    case "PHASE_MISMATCH":
      return { what: "当前阶段不允许这个动作", next: "刷新一下——多半是别处已经把流程推进了" };
    default:
      return { what: "操作没有成功", next: "刷新重试；若仍失败请把这条反馈给我们" };
  }
}
