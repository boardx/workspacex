import { expect, type Page } from "@playwright/test";
import { wave2Runtime } from "@repo/contracts";
import { aidtV2Api } from "./aidt-v2-acceptance";
import { apiPath } from "./real-model-api";

/** An explicit synthetic student's one-off task understanding choice, never tool-wide approval. */
export async function reviewAidtSyntheticIntent(page: Page, projectId: string, runId: string) {
  expect(new URL(page.url()).pathname).toBe(`/aidt/${projectId}`);
  const response = await aidtV2Api(page, `/agent-runs/${runId}`);
  expect(response.status).toBe(200);
  const run = wave2Runtime.operations.getAgentRun.out.parse(response.data);
  expect(run.status).toBe("awaiting_tool_permission");
  expect(run.pendingApproval?.toolName).toBe("confirm_task_intent");
  const thread = new URL(page.url()).searchParams.get("summaryThread") ?? new URL(page.url()).searchParams.get("thread");
  expect(run.threadId).toBe(thread);
  const card = page.getByTestId("agent-interrupt-confirm-intent-shell");
  await expect(card).toHaveCount(1);
  await expect(card).toBeVisible();
  const understanding = await card.getByTestId("agent-interrupt-confirm-intent-understanding").innerText();
  const assumptions = await card.locator('[data-testid^="agent-interrupt-confirm-intent-assumption-"]').allInnerTexts();
  const visible = [understanding, ...assumptions].join("\n");
  expect(/合成|模拟|教学|验收/.test(visible), "必须保留合成课堂范围").toBe(true);
  expect(/猜测|假设|待验证|未验证|尚未|没有真实|未开展/.test(visible), "不能把猜测或模拟升级为已验证研究").toBe(true);
  expect(/问题|来源|澄清|追问|报告|材料|设计思维/.test(visible), "仅限当前教学任务理解").toBe(true);
  expect(/https?:\/\/|DASHSCOPE|API_KEY|SESSION_TOKEN|请(?:发送邮件|执行脚本|修改权限|新增账户|部署)/i.test(visible), "额外外发、资源/高影响动作须另审，不在此确认").toBe(false);
  const stage = Number(new URL(page.url()).searchParams.get("step"));
  const wrongPhase = stage === 1 && /共情|empathize/i.test(visible);
  let reviewedUnderstanding = understanding, reviewedAssumptions = assumptions;
  if (wrongPhase) {
    // A recorded synthetic student's correction, not a claim that the model identified S1 correctly.
    reviewedUnderstanding = "当前是第1步理解与提出问题的合成课堂练习。学生先提出如何让新同学理解食堂取餐指示，来源仍是猜测，尚无真人访谈。只请引导师提出一个核对问题来源的澄清问题，不替学生回答、确认、保存或生成文件。";
    reviewedAssumptions = ["当前是第1步理解与提出问题（aidt-understand），不是第2步共情；研究方向与来源尚待核实。", "使用当前已挂载的教学Skill，只讨论一个澄清问题；不生成文件、不外发、不保存、不替学生作决定。"];
    await card.getByTestId("agent-interrupt-confirm-intent-edit-toggle").click();
    await card.getByTestId("agent-interrupt-confirm-intent-understanding-input").fill(reviewedUnderstanding);
    await expect(card.locator('[data-testid^="agent-interrupt-confirm-intent-assumption-input-"]')).toHaveCount(2);
    for (let index = 0; index < 2; index++) await card.getByTestId(`agent-interrupt-confirm-intent-assumption-input-${index}`).fill(reviewedAssumptions[index]!);
  }
  const continued = page.waitForResponse(value => value.request().method() === "POST"
    && new URL(value.url()).pathname === apiPath(`/agent-runs/${runId}/decision`));
  const choice = card.getByTestId(wrongPhase ? "agent-interrupt-confirm-intent-edit-submit" : "agent-interrupt-confirm-intent-continue");
  await expect(choice).toBeEnabled();
  await choice.click();
  const result = await continued;
  expect(result.status()).toBe(200);
  // Route parameters are normally merged by the controller, not included in the UI JSON.
  const decision = result.request().postDataJSON() as { decision?: string; permissionRequestId?: string; editedArgs?: { understanding?: string; assumptions?: string[] } };
  expect(decision.decision).toBe(wrongPhase ? "edit" : "approve");
  expect(decision.permissionRequestId).toBe(run.pendingApproval!.permissionRequestId);
  if (wrongPhase) expect(decision.editedArgs).toEqual({ understanding: reviewedUnderstanding, assumptions: reviewedAssumptions });
  return { runId, projectId, threadId: run.threadId, tool: "confirm_task_intent", understanding, assumptions,
    permissionRequestId: run.pendingApproval!.permissionRequestId,
    reviewedUnderstanding, reviewedAssumptions, modelPhaseMismatchObserved: wrongPhase,
    decision: wrongPhase ? "student-edited-S1-understanding-once" : "approve-current-understanding-once", globalPermissionGranted: false, syntheticStudentDecision: true };
}
