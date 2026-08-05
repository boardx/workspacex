// realtime-asr-design.test.ts — #466 的待审设计包结构门。
//
// 形制照 wave2-runtime-design.test.ts。它证明的是**包完整且硬边界还在**，
// 不证明人类批准了，也不证明产品行为存在——这两件事分别由 design-signoff.md 的
// status 和 verification.md 的实现门负责。
//
// 为什么这道门值得存在：本 delta 的价值全在三条硬边界上（服务端代理、落库唯一路径、
// 机密域 fail-closed 且无绕行开关）。这三条任何一条在评审往返里被悄悄磨掉，
// 剩下的就是一份"允许把录音发给外部"的空头授权。
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT } from "./lib/paths";

const PACKET = join(REPO_ROOT, "phases/phase-01-run-a-project/design-deltas/realtime-asr");
const read = (name: string): string => readFileSync(join(PACKET, name), "utf8");

describe("#466 realtime ASR 待审设计包", () => {
  it("三件齐备", () => {
    for (const file of ["contract.md", "design-signoff.md", "verification.md"]) {
      expect(existsSync(join(PACKET, file)), file).toBe(true);
    }
  });

  it("status 只能是人类改的：agent 伪造签核必须被抓住", () => {
    const raw = read("design-signoff.md");
    const front = parse(raw.split("---")[1]!) as {
      status: string; bundle: string; confirmed_by?: string;
    };
    expect(front.bundle).toBe("realtime-asr");
    expect(["proposed", "confirmed"]).toContain(front.status);

    // ⚠ 第一版这里只做了「proposed 时不许有 confirmed_by」。反证 C
    //（agent 直接把 status 改成 confirmed 并填上自己的 id）**照样通过** ——
    // 也就是说这道门对 ADR-023 最要紧的那条（签核是人的动作）完全空转。
    // 现在改为：确认人必须是 registry.yaml 里登记的**人类开发者**，
    // 且绝不能是任何一个注册 agent 的 id。
    const registry = parse(
      readFileSync(join(REPO_ROOT, ".harness/agents/registry.yaml"), "utf8"),
    ) as {
      developers?: Array<{ email?: string; github?: string }>;
      agents?: Array<{ id: string }>;
      reviewers?: Array<{ id: string }>;
    };
    const humans = new Set(
      (registry.developers ?? []).flatMap((d) => [d.email, d.github].filter(Boolean) as string[]),
    );
    const agentIds = new Set(
      [...(registry.agents ?? []), ...(registry.reviewers ?? [])].map((a) => a.id),
    );
    expect(humans.size, "registry.yaml 必须有登记在册的人类开发者，否则无人可签").toBeGreaterThan(0);

    if (front.status === "proposed") {
      expect(raw).not.toMatch(/confirmed_by:/);
      expect(raw).not.toMatch(/confirmed_at:/);
    } else {
      const by = front.confirmed_by ?? "";
      expect(agentIds.has(by), `confirmed_by="${by}" 是注册 agent —— 签核是人的动作（ADR-023）`).toBe(false);
      expect(humans.has(by), `confirmed_by="${by}" 不在 registry.yaml 的 developers 里`).toBe(true);
    }
  });

  it("硬边界一：服务端代理，理由写明，且不给浏览器直连留口子", () => {
    const contract = read("contract.md");
    expect(contract).toContain("bearer {API_KEY}");
    expect(contract).toMatch(/浏览器直连.*出局|浏览器直连等于把/);
    // 前端边界里不得出现任何直连上游的端点
    expect(contract).not.toMatch(/apps\/web[\s\S]{0,400}maas\.aliyuncs\.com/);
  });

  it("硬边界二：落库只有一条路，且明确禁止客户端自己写", () => {
    const contract = read("contract.md");
    expect(contract).toContain("不新增第二条写路径");
    expect(contract).toMatch(/客户端\*\*不能\*\*自己调 `ingestSegment`/);
    expect(contract).toContain("idempotencyKey");
    // 不得新增读端口——读回必须仍走既有 readTranscriptStream
    expect(contract).toContain("不新增读端口");
  });

  it("硬边界三：机密域 fail-closed，且没有任何绕行开关", () => {
    const contract = read("contract.md");
    expect(contract).toContain("CONFIDENTIAL_SCOPE_FORBIDS_EXTERNAL_ASR");
    expect(contract).toMatch(/不提供任何「确认后继续」的绕行开关/);
    expect(read("verification.md")).toMatch(/没有\*\*任何"确认后继续"的绕行分支|绕行分支/);
  });

  it("模型名不写进代码，走注册表 + model_secrets", () => {
    const contract = read("contract.md");
    expect(contract).toContain("no-hardcoded-model-list.test.ts");
    expect(contract).toContain("model_secrets");
    expect(contract).toContain("ASR_NOT_CONFIGURED");
  });

  it("错误枚举里没有「未知错误」这种兜底项", () => {
    const contract = read("contract.md");
    expect(contract).toMatch(/没有「未知错误」这一项/);
  });

  it("验收契约要求每条门都有反证，而不只是「跑通」", () => {
    const verification = read("verification.md");
    for (const needle of ["反证", "必须变红", "PCM16"]) {
      expect(verification, needle).toContain(needle);
    }
    // 未配置时必须是**可见状态**失败，不能是超时/白屏/静默通过
    expect(verification).toMatch(/而不是超时、白屏或静默通过/);
  });

  it("如实声明这是本仓第一条流式面（不粉饰代价）", () => {
    const contract = read("contract.md");
    expect(contract).toMatch(/第一条流式面/);
    expect(contract).toMatch(/录音音频会离开本地边界/);
  });
});
