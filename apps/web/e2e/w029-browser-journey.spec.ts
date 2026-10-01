/** W029 business-input browser acceptance; loopback model quality remains unverified. */
import { expect, test } from "@playwright/test";
import { agentRole, workContent, workflowCapabilityGrants, workflowRuntime } from "@repo/contracts";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
import { prepareOfficialWorkflowAdmin, readWorkflowJourneyApi as readApi, workflowJourneyShot as shot } from "./support/workflow-browser-journey";

const C = workflowRuntime.workflowRuntime;
const KEY = "problem-to-prd";
const RAW_INPUT = "团队反馈白板首次导入流程太复杂，请定义问题与PRD";
const GATES = ["frame_gate", "target_gate", "solution_gate", "prd_gate"] as const;
const fill = (path: string, params: Record<string, string>) => path.replace(/:([A-Za-z]+)/g, (_, key: string) => encodeURIComponent(params[key]!));
test.use({ trace: "on", screenshot: "on" });
test.setTimeout(600_000);

test("W029 direct role launch: real grants, four real approval confirmations, persisted PRD and reload", async ({ page }, info) => {
  await info.attach("verification-boundary", { body: Buffer.from(JSON.stringify({
    browserApiDatabase: "real", upstream: "existing fullstack loopback", realModelQuality: "BLOCKED: model credentials absent",
    triggerSchema: "v2 required rawInput", inputEvidence: "Real UI and observed POST; frozen database/stage input is covered separately by API integration tests",
    scope: "business input submission, workflow/grant/approval/output persistence; sales/CRM excluded",
  }, null, 2)), contentType: "application/json" });
  await prepareOfficialWorkflowAdmin(page, info);
  await test.step("administrator grants artifact.write and notify.inapp in the real settings UI", async () => {
    await page.goto("/org-admin/workflow-grants");
    await page.getByTestId("workflow-grants-tab-capability").click();
    for (const category of ["artifact.write", "notify.inapp"]) {
      const current = workflowCapabilityGrants.operations.listWorkflowCapabilityGrants.out.parse(
        await readApi(page, workflowCapabilityGrants.operations.listWorkflowCapabilityGrants.path),
      ).grants.find(g => g.capabilityCategory === category);
      const row = page.getByTestId(`workflow-grant-row-${category}`);
      await expect(row).toBeVisible();
      if (!current?.authorized || current.sideEffectCap !== "write") {
        await row.getByTestId("workflow-grant-edit").click();
        await page.getByTestId("workflow-grant-level-write").check();
        const path = fill(workflowCapabilityGrants.operations.setWorkflowCapabilityGrant.path, { capabilityCategory: category });
        const response = page.waitForResponse(r => r.request().method() === "PUT" && new URL(r.url()).pathname === `/__fullstack_api${path}`);
        await page.getByTestId("workflow-grant-confirm").click();
        expect((await response).ok()).toBe(true);
        await expect(page.getByTestId("workflow-grant-dialog")).not.toBeVisible();
      }
      const saved = workflowCapabilityGrants.operations.listWorkflowCapabilityGrants.out.parse(
        await readApi(page, workflowCapabilityGrants.operations.listWorkflowCapabilityGrants.path),
      ).grants.find(g => g.capabilityCategory === category);
      expect(saved).toMatchObject({ authorized: true, sideEffectCap: "write" });
      await shot(page, info, `03-grant-${category.replaceAll(".", "-")}`);
    }
  });
  const directory = agentRole.operations.listAgentDirectory.out.parse(await readApi(page, agentRole.operations.listAgentDirectory.path)).items;
  const pm = directory.find(c => c.avatar?.key === "dh-03-product-manager" && c.catalogSource === "official");
  expect(pm).toBeDefined();
  const runnable = C.listRunnableWorkflows.out.parse(await readApi(page, fill(C.listRunnableWorkflows.path, { agentId: pm!.agentId })));
  const definition = runnable.items.find(w => w.key === KEY);
  expect(definition, "W029 must really be published for this pinned official role").toBeDefined();
  expect(definition!.version).toBe(2);
  expect(definition!.inputSchema.required).toContain("rawInput");
  expect(definition!.inputSchema.properties).toMatchObject({ rawInput: { type: "string", minLength: 1, maxLength: 2000 } });
  let instanceId = "";
  await test.step("AgentDetail WorkflowRunEntry submits a real product problem to W029 v2", async () => {
    await page.goto(`/agent/${pm!.agentId}`);
    await expect(page.getByTestId("agent-detail-workflows")).toBeVisible();
    await page.getByTestId("workflow-run-entry").click();
    await expect(page.getByTestId(`workflow-run-start-${KEY}`)).toBeVisible();
    await shot(page, info, "04-direct-role-workflow-picker");
    await page.getByTestId(`workflow-run-start-${KEY}`).click();
    const form = page.getByTestId(`workflow-run-form-${KEY}`);
    await expect(form).toBeVisible();
    await form.getByTestId("workflow-run-input-rawInput").fill(RAW_INPUT);
    await shot(page, info, "04-product-problem-entered");
    const path = fill(C.startInstance.path, { key: KEY });
    const observed = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === `/__fullstack_api${path}`);
    await form.getByTestId("workflow-run-form-submit").click();
    const response = await observed;
    expect(response.status()).toBe(201);
    const input = C.startInstance.in.parse(response.request().postDataJSON());
    expect(input).toMatchObject({ key: KEY, agentId: pm!.agentId, version: 2, input: { rawInput: RAW_INPUT } });
    expect(input.input).toEqual({ rawInput: RAW_INPUT });
    instanceId = C.startInstance.out.parse(await response.json()).instanceId;
    await info.attach("business-input-submission", { body: Buffer.from(JSON.stringify({ definitionVersion: definition!.version,
      inputSchema: definition!.inputSchema, actualSubmittedInput: input.input, status: "PASS: actual browser POST accepted the exact authored input",
      stageInputEvidence: "Separate real PostgreSQL/API integration test; instance projection does not expose private trigger input" }, null, 2)), contentType: "application/json" });
    await expect(page).toHaveURL(new RegExp(`/workflows/runs/${instanceId}$`));
    await shot(page, info, "05-w029-started");
  });
  const projection = async () => C.getInstance.out.parse(await readApi(page, fill(C.getInstance.path, { instanceId })));
  const approved: { gateId: string; stageId: string; decidedBy: string | null }[] = [];
  for (const [index, stageId] of GATES.entries()) {
    await test.step(`${stageId}: user approves and confirms the real gate`, async () => {
      await expect.poll(async () => (await projection()).openGate?.stageId, { timeout: 120_000 }).toBe(stageId);
      const before = await projection();
      expect(before).toMatchObject({ status: "awaiting_gate_decision", agentId: pm!.agentId, agentVersionId: pm!.versionId });
      const gate = before.openGate!;
      expect(gate.viewerCanDecide).toBe(true);
      const drawer = page.getByTestId("workflow-approval-drawer");
      await expect(drawer).toHaveAttribute("data-gate-id", gate.gateId);
      await shot(page, info, `06-${index + 1}-${stageId}-pending`);
      await drawer.getByTestId("workflow-approve").click();
      await expect(drawer.getByTestId("workflow-approve-confirm-text")).toBeVisible();
      await shot(page, info, `06-${index + 1}-${stageId}-confirm`);
      const path = fill(C.approveGate.path, { instanceId, gateId: gate.gateId });
      const observed = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === `/__fullstack_api${path}`);
      await drawer.getByTestId("workflow-approve-confirm").click();
      const response = await observed;
      expect(response.ok()).toBe(true);
      const receipt = C.approveGate.out.parse(await response.json());
      expect(receipt.gate).toMatchObject({ gateId: gate.gateId, stageId, decision: "approved", decidedBy: FULLSTACK_E2E.adminUserId });
      approved.push({ gateId: receipt.gate.gateId, stageId, decidedBy: receipt.gate.decidedBy });
      await expect.poll(async () => (await projection()).stages.find(s => s.stageId === stageId)?.status, { timeout: 120_000 }).toBe("succeeded");
    });
  }
  await test.step("finished run exposes the persisted PRD; reloading preserves the same output", async () => {
    await expect.poll(async () => (await projection()).status, { timeout: 120_000 }).toBe("succeeded");
    await expect(page.getByTestId("workflow-run-panel")).toHaveAttribute("data-status", "succeeded");
    const finished = await projection();
    expect(finished.stages.every(s => s.status === "succeeded")).toBe(true);
    for (const [stageId, category] of [["persist", "artifact.write"], ["notify", "notify.inapp"]]) {
      expect(finished.effects.filter(e => e.stageId === stageId && e.capabilityCategory === category)).toHaveLength(1);
      expect(finished.effects.find(e => e.stageId === stageId)?.status).toBe("finalized");
    }
    const approvals = C.listMyApprovals.out.parse(await readApi(page, `${C.listMyApprovals.path}?includeDecided=true`)).items.filter(a => a.instanceId === instanceId);
    expect(approvals).toHaveLength(4);
    expect(approvals.every(a => a.gate.decision === "approved")).toBe(true);
    const path = fill(workContent.operations.getInstanceOutput.path, { instanceId });
    const output = workContent.operations.getInstanceOutput.out.parse(await readApi(page, path));
    expect(output).toMatchObject({ instanceId, outcome: "complete", output: { kind: "prd" } });
    await shot(page, info, "07-w029-succeeded");
    await page.getByTestId("workflow-stage-persist").locator('a[data-testid^="workflow-output-"]').click();
    await expect(page.getByTestId("workflow-output-prd")).toBeVisible();
    await shot(page, info, "08-persisted-prd");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("workflow-output-prd")).toBeVisible();
    expect(workContent.operations.getInstanceOutput.out.parse(await readApi(page, path))).toEqual(output);
    expect((await projection()).effects).toEqual(finished.effects);
    await shot(page, info, "09-prd-after-reload");
    await info.attach("workflow-business-input-evidence", { body: Buffer.from(JSON.stringify({ instanceId, approved,
      finishedProjection: finished, output, realModelQuality: "BLOCKED", submittedRawInput: RAW_INPUT, inputSubmission: "PASS: v2 real UI/POST",
      stageInputEvidence: "Separate PostgreSQL/API integration test", semanticQuality: "BLOCKED: loopback is not a real model quality evaluation" }, null, 2)), contentType: "application/json" });
  });
});
