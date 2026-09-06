/**
 * issue #2768 (根因①，"最终没有任何产出")：`DeepAgentModelProvider.createRun` 的 resume
 * 分支此前只转发 `command.resume`（外加可选的 `interjection`），从不转发
 * `config.configurable.org_skills`/`script_protocol`——而 `call_skill` 的唯一技能来源
 * 就是**这次请求自己的** `configurable.org_skills`（`tools.py` 的 `_read_org_skills`，
 * 每次调用重新读，不跨请求继承）。结果是：一次 L2 敏感调用（如 `call_skill(pdf-create)`）
 * 被 HITL 拦下、人批准后 resume——图恢复执行、真的调用 `call_skill`，但这次请求的
 * `configurable` 里没有任何技能，`call_skill` 只能报"未知技能「pdf-create」"，不产出
 * 任何脚本；编排模型仍然礼貌地回复"已经生成"，但没有 `run_script` 围栏可抠，
 * `maybeRunSkillScript` 什么都不执行——run 显示 succeeded，用户什么文件都拿不到。
 *
 * 本文件用一个**真实依赖 configurable.org_skills 才能答对**的假 deep-agent-service
 * （不是硬编码"总是成功"）验证修复：resume 请求现在带着与 fresh-run 分支相同的
 * `org_skills`/`script_protocol`，`call_skill` 因此能在假服务器里查到技能、答出真实
 * 脚本围栏；T-CP 用空技能表证明假服务器的"查到/查不到"分支确实是被
 * `org_skills` 内容驱动的，不是恒真恒假。
 *
 * 真实复现证据（直接打 `langgraph dev` + `deepagents==0.7.6`，不经过本仓任何代码）：
 * 同一个已中断的 run，resume 请求体只有"是否带 config.configurable.org_skills"这一处
 * 不同——带了，`call_skill` 的工具结果是真实的 ```run_script 围栏；不带，工具结果是
 * "未知技能「pdf-create」：本次运行挂载的技能里没有这一个……"。见 PR 描述附带的两份
 * 抓包（`05-resume-run.json`+`13-threadB-resume-stream.json` vs `14-threadB-after-
 * resume-state.json`）。
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEEP_AGENT_PROVIDER_NAME,
  DeepAgentModelProvider,
} from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { RUN_SCRIPT_PROTOCOL_PROMPT, tryExtractScript } from "../../src/application/skill/run-script-with-retries";
import type { PinnedSkillContent } from "../../src/application/agent-run/ports";
import { standardCapabilities as SC } from "@repo/contracts";

const SKILL_STABLE_NAME = "pdf-create";
const SCRIPT_FENCE = "```run_script\nconst fs=require('fs');fs.writeFileSync('a.pdf','%PDF-1.4');\n```";

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

/**
 * 假 deep-agent-service：`call_skill` 是否"答得出真实技能"完全由这次请求体里的
 * `config.configurable.org_skills` 是否包含 `pdf-create` 决定——不是写死的分支，
 * 这样"org_skills 转发对了"与"call_skill 真的能执行"之间的因果关系是这份假件自己
 * 计算出来的，不是测试断言里假设出来的。
 */
function startFake(): Promise<{ baseUrl: string; capturedResumeBodies: Record<string, unknown>[]; capturedBodies: Record<string, unknown>[] }> {
  const capturedResumeBodies: Record<string, unknown>[] = [];
  const capturedBodies: Record<string, unknown>[] = [];
  server = createServer((req, res) => {
    const url = req.url ?? "";
    const json = (body: unknown): void => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST" && url === "/threads") return json({ thread_id: "t-2768" });
    if (req.method === "POST" && /^\/threads\/[^/]+\/runs$/.test(url)) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        capturedBodies.push(body);
        if (body.command !== undefined) capturedResumeBodies.push(body);
        json({ run_id: "r-2768" });
      });
      return;
    }
    if (req.method === "GET" && /^\/threads\/[^/]+\/runs\/[^/]+$/.test(url)) return json({ status: "success" });
    if (req.method === "GET" && /^\/threads\/[^/]+\/state$/.test(url)) {
      const lastResume = capturedResumeBodies[capturedResumeBodies.length - 1];
      const configurable = (lastResume?.config as { configurable?: Record<string, unknown> } | undefined)
        ?.configurable ?? {};
      const orgSkills = (configurable.org_skills as { stable_name?: string }[] | undefined) ?? [];
      const hasSkill = orgSkills.some((s) => s.stable_name === SKILL_STABLE_NAME);
      const toolResult = hasSkill
        ? SCRIPT_FENCE
        : `未知技能「${SKILL_STABLE_NAME}」：本次运行挂载的技能里没有这一个，先调用 list_org_skills 看看有哪些，或直接根据已有信息回答。`;
      return json({
        values: {
          messages: [
            { type: "human", content: "生成一个 pdf" },
            {
              type: "ai", content: "我来用 PDF 技能生成一份说明文档。",
              tool_calls: [{ id: "call-1", name: "call_skill", args: { skill_stable_name: SKILL_STABLE_NAME, task: "t" } }],
            },
            { type: "tool", tool_call_id: "call-1", content: toolResult },
            { type: "ai", content: "我已经根据你的要求生成了 PDF，请查看附件。" },
          ],
        },
      });
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server!.listen(0, "127.0.0.1", () => {
      const addr = server!.address() as AddressInfo;
      resolve({ baseUrl: `http://127.0.0.1:${addr.port}`, capturedResumeBodies, capturedBodies });
    });
  });
}

const SKILLS: readonly PinnedSkillContent[] = [
  { versionId: "v-pdf-create", stableName: SKILL_STABLE_NAME, name: "PDF 生成", content: "你是 PDF 生成技能。" },
];

describe("issue #2768：resume 请求转发 org_skills/script_protocol，call_skill 批准后真的能执行", () => {
  it("resume 请求体带上与 fresh-run 分支相同的 org_skills/script_protocol", async () => {
    const { baseUrl, capturedResumeBodies } = await startFake();
    const provider = new DeepAgentModelProvider({ baseUrl, timeoutMs: 5_000, pollIntervalMs: 5 });
    await provider.completeWithProgress(
      {
        modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "any", system: "s", user: "u",
        history: [], skills: SKILLS, scriptProtocol: RUN_SCRIPT_PROTOCOL_PROMPT,
        resume: { decision: "approve" },
      } as never,
      async () => {},
    );
    expect(capturedResumeBodies).toHaveLength(1);
    const body = capturedResumeBodies[0]! as {
      config: { configurable: { org_skills: { stable_name: string; name: string; content: string }[]; script_protocol?: string } };
    };
    expect(body.config.configurable.org_skills).toEqual([
      { stable_name: SKILL_STABLE_NAME, name: "PDF 生成", content: "你是 PDF 生成技能。" },
    ]);
    expect(body.config.configurable.script_protocol).toBe(RUN_SCRIPT_PROTOCOL_PROMPT);
  });

  it("因此批准后的 call_skill 真的答出可执行脚本，scriptCandidates 里能抠出来（修复前：只有『未知技能』）", async () => {
    const { baseUrl } = await startFake();
    const provider = new DeepAgentModelProvider({ baseUrl, timeoutMs: 5_000, pollIntervalMs: 5 });
    const completion = await provider.completeWithProgress(
      {
        modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "any", system: "s", user: "u",
        history: [], skills: SKILLS, scriptProtocol: RUN_SCRIPT_PROTOCOL_PROMPT,
        resume: { decision: "approve" },
      } as never,
      async () => {},
    );
    const candidate = (completion.scriptCandidates ?? []).find((c) => tryExtractScript(c) !== null);
    expect(candidate, JSON.stringify(completion.scriptCandidates)).toBeDefined();
    expect(tryExtractScript(candidate!)).toContain("fs.writeFileSync");
  });

  it("T-CP 反证：resume 时不挂任何 skill ⇒ 假服务器的『查不到』分支确实会触发（证明上面两条不是恒真）", async () => {
    const { baseUrl } = await startFake();
    const provider = new DeepAgentModelProvider({ baseUrl, timeoutMs: 5_000, pollIntervalMs: 5 });
    const completion = await provider.completeWithProgress(
      {
        modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "any", system: "s", user: "u",
        history: [], skills: [], scriptProtocol: RUN_SCRIPT_PROTOCOL_PROMPT,
        resume: { decision: "approve" },
      } as never,
      async () => {},
    );
    const candidate = (completion.scriptCandidates ?? []).find((c) => tryExtractScript(c) !== null);
    expect(candidate).toBeUndefined();
    expect(completion.scriptCandidates?.join("\n")).toContain("未知技能");
  });
});


describe("WX-E004 full package trusted context", () => {
  it.each([false, true])("preserves background callback context on resume=%s", async (resume) => {
    const { baseUrl, capturedBodies } = await startFake();
    const provider = new DeepAgentModelProvider({ baseUrl, timeoutMs: 5_000, pollIntervalMs: 5,
      subtaskCallbackBaseUrl: "http://trusted-api", subtaskCallbackKey: "test-secret" });
    await provider.completeWithProgress({
      modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "any", system: "s", user: "u",
      orgId: "org-test", runId: "run-test", history: [], skills: [],
      ...(resume ? { resume: { decision: "approve" } } : {}),
    } as never, async () => {});
    const body = capturedBodies[0]!;
    expect((body.config as { configurable: Record<string, unknown> }).configurable).toMatchObject({
      subtask_callback_base_url: "http://trusted-api", subtask_callback_key: "test-secret",
      org_id: "org-test", parent_run_id: "run-test",
    });
  });
  it.each([false, true])("forwards server text-only restriction on resume=%s", async (resume) => {
    const { baseUrl, capturedBodies } = await startFake();
    const provider = new DeepAgentModelProvider({ baseUrl, timeoutMs: 5_000, pollIntervalMs: 5 });
    await provider.completeWithProgress({
      modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "any", system: "s", user: "u",
      history: [], skills: [], executionMode: "text-only",
      ...(resume ? { resume: { decision: "approve" } } : {}),
    } as never, async () => {});
    const body = capturedBodies[0]!;
    expect((body.config as { configurable: Record<string, unknown> }).configurable[SC.EXECUTION_MODE_CONFIG_KEY]).toBe("text-only");
    expect(JSON.stringify(body.input ?? {})).not.toContain(SC.EXECUTION_MODE_CONFIG_KEY);
  });
  it.each([false, true])("forwards identical complete binary files on resume=%s outside messages", async (resume) => {
    const { baseUrl, capturedBodies } = await startFake();
    const provider = new DeepAgentModelProvider({ baseUrl, timeoutMs: 5_000, pollIntervalMs: 5 });
    const files = [
      { path: "SKILL.md", bytes: Buffer.from("# Package") },
      { path: "assets/template.bin", bytes: Buffer.from([0, 255, 128]) },
    ].map(({ path, bytes }) => ({ path, contentBase64: bytes.toString("base64"),
      mediaType: "application/octet-stream", digest: createHash("sha256").update(bytes).digest("hex") }));
    const skillPackage = { skillId: "skill-pdf", versionId: SKILLS[0]!.versionId, files };
    await provider.completeWithProgress({
      modelProvider: DEEP_AGENT_PROVIDER_NAME, modelId: "any", system: "s", user: "u",
      history: [], skills: [{ ...SKILLS[0]!, package: skillPackage }],
      ...(resume ? { resume: { decision: "approve" } } : {}),
    } as never, async () => {});
    expect(capturedBodies).toHaveLength(1);
    const body = capturedBodies[0]!;
    const context = (body.config as { configurable: { org_skills: unknown[] } }).configurable;
    expect(context.org_skills).toEqual([{ stable_name: SKILL_STABLE_NAME, name: SKILLS[0]!.name,
      content: SKILLS[0]!.content, package: skillPackage }]);
    expect(JSON.stringify(body.input ?? {})).not.toContain("contentBase64");
  });
});
