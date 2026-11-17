import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { wave2Runtime } from "@repo/contracts";
import { aidtV2Api, askAidtV2Agent, assertAidtV2Target, loginAidtV2, readAidtV2Stage } from "./support/aidt-v2-acceptance";
import { readCompletionState } from "./support/aidt-v2-completion-state";
import { reviewAidtCurrentPlanOnce } from "./support/aidt-v2-plan-review";
import { reviewAidtSyntheticIntent } from "./support/aidt-v2-intent-review";
import { isAidtRemediation } from "./support/aidt-v2-remediation-criteria";
import { validateAidtSkillExecutionProof } from "./support/aidt-v2-skill-execution-proof";

test("S1 first-focus probe: one extra native request executes exact Skill and preserves the main journey", async ({ page }, info) => {
  test.setTimeout(600_000); assertAidtV2Target(); expect(isAidtRemediation()).toBe(true);
  expect(process.env.AIDT_V2_S1_PROBE_AUTHORIZED).toBe("s1-first-focus-probe-20261117");
  expect(process.env.AIDT_V2_S1_SUPPLEMENT_AUTHORIZED).toBe("1");
  const mainLedger = process.env.AIDT_V2_RUN_LEDGER!, mainState = process.env.AIDT_V2_COMPLETION_STATE!, extra = process.env.AIDT_V2_SUPPLEMENTAL_S1_LEDGER!;
  expect(isAbsolute(extra)).toBe(true); expect(extra).not.toBe(mainLedger); expect(existsSync(extra)).toBe(false);
  const proofFile = process.env.AIDT_V2_EXECUTION_PROOF_FILE!; expect(isAbsolute(proofFile)).toBe(true);
  expect(existsSync(proofFile), "每个probe独立证明，不读旧run回执").toBe(false);
  const ledgerBytes = readFileSync(mainLedger), stateBytes = readFileSync(mainState), state = readCompletionState(), projectId = state.projectId!;
  expect(state.phases.s1?.status).toBe("completed");
  await loginAidtV2(page);
  const before = await Promise.all([1, 2, 3, 4, 5, 6].map(id => readAidtV2Stage(page, projectId, id)));
  expect(before[0]?.revision, "只复核当前原S1保存V2，不另造材料").toBe(2);
  await info.attach("first-focus-protected-before", { contentType: "application/json", body: Buffer.from(JSON.stringify({ mainLedgerSha256: createHash("sha256").update(ledgerBytes).digest("hex"), mainStateSha256: createHash("sha256").update(stateBytes).digest("hex") })) });
  try {
  const turn = await askAidtV2Agent(page, projectId, 1, "本组正在第1步提出问题。学生输入与来源已保存，均为合成课堂猜测。请先核对本步已保存材料，只追问一个帮助学生澄清问题来源的问题；不替学生确认、保存或声称已采访，不生成原型或文件。", {
    reviewSyntheticIntent: runId => reviewAidtSyntheticIntent(page, projectId, runId),
    reviewCurrentPlanOnce: (runId, threadId) => reviewAidtCurrentPlanOnce(page, projectId, threadId, runId),
  });
  await info.attach("first-focus-native-turn", { contentType: "application/json", body: Buffer.from(JSON.stringify(turn, null, 2)) });
  const response = await aidtV2Api(page, `/agent-runs/${turn.runId}`); expect(response.status).toBe(200);
  const run = wave2Runtime.operations.getAgentRun.out.parse(response.data);
  expect(run.steps.filter(step => step.kind === "tool_call" && step.toolName === "call_skill" && step.status === "succeeded")).toHaveLength(1);
  const pack = wave2Runtime.SkillStarterPack.parse(JSON.parse(readFileSync(resolve("../../skills/starter-packs/aidt-methods", `${process.env.AIDT_V2_METHODS_VERSION}.json`), "utf8")));
  const expected = { runId: turn.runId, threadId: turn.threadId, inputMessageId: run.inputMessageId, selectedSkillVersionId: turn.mountedSkillVersionId!, skillStableName: "aidt-understand", skillContentSha256: pack.skills.find(skill => skill.stableName === "aidt-understand")!.files.find(file => file.path === "SKILL.md")!.digest, assistantText: turn.assistantText };
  console.info(`[aidt-v2] ACTUAL_TOOLMESSAGE_STATE_PROOF_REQUIRED run=${turn.runId} output=${proofFile}`);
  await expect.poll(() => existsSync(proofFile), { timeout: 180_000, intervals: [500, 1_000] }).toBe(true);
  const proof = validateAidtSkillExecutionProof(JSON.parse(readFileSync(proofFile, "utf8")), expected);
  await info.attach("first-focus-execution-and-main-immutability", { contentType: "application/json", body: Buffer.from(JSON.stringify({ projectId, turn, proof, mainLedgerSha256: createHash("sha256").update(ledgerBytes).digest("hex"), mainStateSha256: createHash("sha256").update(stateBytes).digest("hex"), mainJourneyChanged: false, mainLedgerChanged: false, newStageSaved: false, classroomAcceptance: false }, null, 2)) });
  } finally {
    expect(await Promise.all([1, 2, 3, 4, 5, 6].map(id => readAidtV2Stage(page, projectId, id)))).toEqual(before);
    expect(readFileSync(mainLedger)).toEqual(ledgerBytes); expect(readFileSync(mainState)).toEqual(stateBytes);
  }
});
