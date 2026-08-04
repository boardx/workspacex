import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FONT_SCALE, FONT_SCALE_KEYS } from "../lib/font-scale";

/**
 * 单一事实源断言（UC-0.4 R12 V4 / AC2 —— 「副本数 = 1」可被机器断言）
 *
 * §1.2 记录的事故根因是「字号表有三份副本靠人肉对齐」。这里逐条钉死：
 * tailwind.config.ts 与 lib/utils.ts 都必须**从 font-scale.ts 取值**，不得手抄。
 */
describe("字号档位单一事实源", () => {
  const twConfig = readFileSync(new URL("../tailwind.config.ts", import.meta.url), "utf8");
  const utils = readFileSync(new URL("../lib/utils.ts", import.meta.url), "utf8");

  it("tailwind.config.ts 从 font-scale.ts import", () => {
    expect(twConfig).toMatch(/import\s*\{\s*FONT_SCALE\s*\}\s*from\s*"\.\/lib\/font-scale"/);
  });

  it("tailwind.config.ts 不含字面量 fontSize 对象（第二份副本）", () => {
    expect(twConfig).not.toMatch(/fontSize:\s*\{/);
    expect(twConfig).toMatch(/fontSize:\s*FONT_SCALE/);
  });

  it("lib/utils.ts 用 FONT_SCALE_KEYS 登记 tailwind-merge，不手抄清单", () => {
    expect(utils).toMatch(/FONT_SCALE_KEYS/);
    // 手抄的迹象：utils 里出现成串的数字字面量
    expect(utils).not.toMatch(/\[\s*"?\d+"?\s*,\s*"?\d+"?\s*,\s*"?\d+"?/);
  });

  it("档位表非空且键为纯数字", () => {
    expect(FONT_SCALE_KEYS.length).toBeGreaterThan(0);
    FONT_SCALE_KEYS.forEach((k) => expect(k).toMatch(/^\d+$/));
  });

  it("每档都带 lineHeight（避免行高散落各处成为第二份隐性副本）", () => {
    Object.entries(FONT_SCALE).forEach(([, v]) => {
      expect(v[1].lineHeight).toBeTruthy();
    });
  });
});

/**
 * 认证策略数值单一事实源（F20 / O-28、O-29）
 *
 * 事故形状与字号表那次一模一样：`lib/mock/entry.ts` 手写了 sessionDays / passwordMinLen /
 * resetLinkHours / lockAfterFails / lockWindowMinutes / lockDurationMinutes 六个数字，
 * 而后端实现登录锁定与密码重置时必然要再写一份。两份都自洽，直到有人只改其中一份。
 *
 * ⇒ 唯一那份收敛进 `packages/contracts/src/auth.ts`。这里钉死「前端没有第二份」。
 */
describe("认证策略数值单一事实源", () => {
  const entry = readFileSync(new URL("../lib/mock/entry.ts", import.meta.url), "utf8");

  it("entry.ts 从契约 re-export AUTH_POLICY，不自己声明", () => {
    expect(entry).toMatch(/export\s*\{\s*AUTH_POLICY\s*\}\s*from\s*"@repo\/contracts\/auth"/);
    // 手抄的迹象：本地又出现 `export const AUTH_POLICY = {`
    expect(entry).not.toMatch(/export\s+const\s+AUTH_POLICY\s*=/);
  });

  it("契约里的策略数值与 O-28 / O-29 裁决逐条一致", async () => {
    const { AUTH_POLICY } = await import("@repo/contracts/auth");
    // ⚠ 断言的是「每一项与裁决一致」而不是 `toHaveLength(n)`——后者会把一次经评审的
    // 正当新增当成失败（contract-design 硬规则 7）。
    expect(AUTH_POLICY.sessionDays).toBe(30); //           UC-1.1 R3 第 2 步 [Backlog]
    expect(AUTH_POLICY.passwordMinLen).toBe(12); //        O-28 ①
    expect(AUTH_POLICY.resetLinkHours).toBe(1); //         O-28 ④
    expect(AUTH_POLICY.lockAfterFails).toBe(5); //         O-28 ③
    expect(AUTH_POLICY.lockWindowMinutes).toBe(15); //     O-28 ③
    expect(AUTH_POLICY.lockDurationMinutes).toBe(15); //   O-28 ③
    expect(AUTH_POLICY.resendCooldownSeconds).toBe(60); // O-28 ④
    expect(AUTH_POLICY.resendDailyMax).toBe(5); //         O-28 ④
    expect(AUTH_POLICY.inviteCodeLength).toBe(14); //      UC-1.5 / O-29 ①
  });

  /**
   * ⚠ 断言的是**代码**不是注释。
   *
   * 本条第一版写的是 `expect(loginForm).not.toMatch(/AUTH_POLICY 无此项/)`——
   * 于是解释「为什么原来那样写不对」的注释本身把门控打红了。
   * 这正是 coding-standards 里那条「过度触发的门控会被静音」：一个会因为注释措辞
   * 而失败的检查，第一次误报就会被人删掉，之后真正的副本回来了也没人拦。
   * ⇒ 改成断言真正要守的性质：长度判断从契约取值，不是字面量。
   */
  it("真实注册页的邀请码长度判断取自契约，不是字面量 14", () => {
    const registration = readFileSync(new URL("../components/entry/registration.tsx", import.meta.url), "utf8");
    // 2026-08-04：邀请码字段不再 `required`/`minLength`——**留空 = bootstrap 建首位管理员**
    // （#452 的能力，人类裁决「创建组织统一到 /auth/register」后搬到本页）。所以长度判断
    // 从 JSX 属性移到了提交禁用条件与计数回显里。**断言要守的性质没变**：长度取自契约。
    expect(registration).toMatch(/C\.AUTH_POLICY\.inviteCodeLength/);
    // 手抄的迹象：任何形式的字面量 14 比长度
    expect(registration).not.toMatch(/minLength={14}/);
    expect(registration).not.toMatch(/length\s*[!=]==?\s*14\b/);
  });
});

/**
 * Context Pack：五种筛选动作 + 相关度阈值 单一事实源（F11 / O-36 / KNOWN_CONTRACT_GAPS.G1）
 *
 * 事故形状与前两次一模一样，只是这次**已经漂移了**：
 * 契约的 `FilterAction` 是 `recall/downweight/exclude/paired/lead`，
 * 而 `lib/mock/brain.ts` 自带的那份是 `…/pair/clue`——**后两个键对不上**，
 * 两边各自自洽，没有任何东西会红。相关度阈值 `0.45` 同理，在本包里出现过三次。
 *
 * ⇒ 唯一那份分别收敛进 `@repo/contracts/filter-action` 与
 *   `@repo/contracts/thresholds`。这里钉死「前端没有第二份」。
 */
describe("筛选动作与相关度阈值单一事实源", () => {
  const brain = readFileSync(new URL("../lib/mock/brain.ts", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../components/brain/context-pack.tsx", import.meta.url), "utf8");

  it("brain.ts 的筛选动作从契约取键与展示名，不自己列", () => {
    expect(brain).toMatch(/from\s+"@\/lib\/filter-action"/);
    expect(brain).toMatch(/FILTER_ACTION_KEYS\.map/);
    // 手抄的迹象：本地又写出一串 { key: "...", label: "..." }
    expect(brain).not.toMatch(/key:\s*"(recall|downweight|exclude|paired|pair|lead|clue)"/);
  });

  it("契约里的五种动作与前端渲染的是同一组键（含曾漂移的那两个）", async () => {
    const { FILTER_ACTION_KEYS } = await import("@repo/contracts/filter-action");
    const { FILTER_ACTIONS } = await import("../lib/mock/brain");
    expect(FILTER_ACTIONS.map((f) => f.key)).toEqual(FILTER_ACTION_KEYS);
    // ⚠ 断言的是「与契约一致」而不是 toHaveLength(5)——后者会挡下一次经评审的正当新增。
    expect(FILTER_ACTION_KEYS).toContain("paired");
    expect(FILTER_ACTION_KEYS).toContain("lead");
    expect(FILTER_ACTION_KEYS).not.toContain("pair");
    expect(FILTER_ACTION_KEYS).not.toContain("clue");
  });

  it("相关度阈值从契约取，前端不写字面量 0.45", async () => {
    const { relevanceThresholdFor } = await import("@repo/contracts/thresholds");
    const { RELEVANCE_THRESHOLD, PACK_TASK } = await import("../lib/mock/brain");
    expect(RELEVANCE_THRESHOLD).toBe(relevanceThresholdFor(PACK_TASK));
    for (const [name, body] of [["brain.ts", brain], ["context-pack.tsx", panel]] as const) {
      const hits = body.split("\n").filter((l) => !/^\s*(\*|\/\/|\{\/\*)/.test(l) && /\b0\.45\b/.test(l));
      expect(hits, `${name} 里出现了阈值字面量：\n${hits.join("\n")}`).toEqual([]);
    }
  });

  /**
   * I-4 在**前端**才有失效的机会：契约的 `listOmissions` 没有分页参数
   * （KNOWN_CONTRACT_GAPS.G3），所以「只显示前 N 条」这件事只发生在这个组件里。
   * 断言合规判据取自单一事实源，且折叠只作用于非合规那一栏。
   */
  it("合规性丢弃的判据取自单一事实源，且不在折叠范围内", async () => {
    expect(panel).toMatch(/isComplianceOmission/);
    // 手抄的迹象：组件里自己列「哪三种算合规」
    expect(panel).not.toMatch(/\[\s*"withdrawn"\s*,\s*"expired"\s*,\s*"unauthorized"\s*\]/);

    const { OMISSIONS, OMISSIONS_MORE } = await import("../lib/mock/brain");
    const { isComplianceOmission } = await import("../lib/omission-reason");
    const all = [...OMISSIONS, ...OMISSIONS_MORE];
    const compliance = all.filter((o) => isComplianceOmission(o.reasonType));
    const other = all.filter((o) => !isComplianceOmission(o.reasonType));
    // 折叠的是 other 那一栏；合规栏一条都不在里面（否则「只显示前 N 条」会吃掉它们）。
    expect(compliance.length).toBeGreaterThan(0);
    expect(other.some((o) => isComplianceOmission(o.reasonType))).toBe(false);
    expect(panel).toMatch(/otherOmissions\.slice\(0,\s*VISIBLE_OMISSIONS\)/);
    expect(panel).not.toMatch(/allOmissions\.slice\(/);
  });
});

/**
 * 本地组织判定的单一事实源（F16 / UC-0.5 R7）
 *
 * 事故形状与前六次一模一样，代价却不同：前几次漂移错的是界面上一个数字，
 * 这一次错的是**数据出不出本机**。
 *
 * 收敛前，同一条判定在三处各有一份：
 *   · `apps/web/lib/identity.ts` 的 `isLocalOrg()`（字面量比较）与手写的三条承诺
 *   · `apps/api/src/domain/identity/model-constraint.ts` 的 `orgKind === "personal-local"`
 *   · 前端界面里另写的「云端不可用」文案
 * ⇒ 全部收敛进 `packages/contracts/src/identity.ts`。这里钉死前端这一半，
 *   后端那一半由 `apps/api/tests/kernel/local-org-invisible-to-admin.test.ts` 钉。
 */
describe("本地组织判定单一事实源", () => {
  const files = (paths: string[]): { path: string; body: string }[] =>
    paths.map((p) => ({ path: p, body: readFileSync(new URL(`../${p}`, import.meta.url), "utf8") }));

  /**
   * ⚠ 断言的是**代码**不是注释——本文件上方那条 F20 的教训在这里立刻复现了一次：
   * 第一版没有剥注释，于是「解释为什么不能写 `kind === "personal-local"`」的那句注释
   * 自己把门控打红了。会因为注释措辞失败的检查，第一次误报就会被人删掉。
   */
  const code = (body: string): string =>
    body.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(l)).join("\n");

  it("lib/identity.ts 不再自己声明三条承诺，也不自己比字面量", async () => {
    const [identity] = files(["lib/identity.ts"]);
    const body = code(identity!.body);
    expect(body).toMatch(/LOCAL_ORG_GUARANTEES\s*=\s*C\.LOCAL_ORG_GUARANTEES/);
    expect(body).toMatch(/C\.isLocalOrgKind\(/);
    // 手抄的迹象：本地又出现一个字符串数组，或者直接比 kind
    expect(body).not.toMatch(/LOCAL_ORG_GUARANTEES\s*=\s*\[/);
    expect(body).not.toMatch(/kind\s*===\s*"personal-local"/);
  });

  it("界面组件里不出现 personal-local 字面量", () => {
    // 组件应当调 `isLocalOrg()`。字面量出现在组件里，意味着某一天契约改了、
    // 而这一处不会有任何东西提醒。
    const offenders = files([
      "components/shell/top-bar.tsx",
      "components/admin/local-org-screen.tsx",
    ]).filter(({ body }) =>
      body
        .split("\n")
        .filter((l) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(l))
        .some((l) => /["']personal-local["']/.test(l)),
    );
    expect(offenders.map((o) => o.path)).toEqual([]);
  });

  it("契约里的承诺、启动指引、端点判定都能取到，且判定确实会拒绝", async () => {
    const C = await import("@repo/contracts/identity");
    // ⚠ 断言的是「三条各自的 id 与契约一致」而不是 toHaveLength(3)——
    //   后者会把一次经评审的正当新增当成失败（contract-design 硬规则 7）。
    expect(C.LOCAL_ORG_GUARANTEES.map((g) => g.id)).toEqual(
      expect.arrayContaining(["local-model-only", "no-mcp-egress", "no-shared-storage"]),
    );
    expect(C.LOCAL_RUNTIME_STARTUP_HINT).toContain("不会替你改用云端");

    // 端点判定的两个方向。只断言「本机的算本机」时，一个恒 true 的实现也会绿。
    expect(C.isLocalModelEndpoint("http://127.0.0.1:11434")).toBe(true);
    expect(C.isLocalModelEndpoint("http://localhost:1234")).toBe(true);
    expect(C.isLocalModelEndpoint("https://api.vendor.example/v1")).toBe(false);
    // 局域网**不算**本机：承诺的字面是「不出本机」，不是「不出内网」。
    expect(C.isLocalModelEndpoint("http://192.168.1.50:11434")).toBe(false);
    expect(C.isLocalModelEndpoint(null)).toBe(false);
  });

  it("本地组织屏的云端禁用原因取自契约函数，不是界面里另写的一句", () => {
    const [screen] = files(["components/admin/local-org-screen.tsx"]);
    expect(screen!.body).toMatch(/localOrgCloudDisabledReason\(/);
    expect(screen!.body).toMatch(/LOCAL_RUNTIME_STARTUP_HINT/);
    // 手抄的迹象：界面自己拼一句「云端模型不可用」
    expect(screen!.body).not.toMatch(/const\s+\w*[Rr]eason\s*=\s*["'`]/);
  });
});

/**
 * D-U1 机密硬路由（全程本地，不分流）单一事实源（F51 / UC-20.3）
 *
 * `dataScopeConstraint` / `modelPolicyViolation` / `isModelSelectable`（`lib/mock/chat.ts`）
 * 是批准卡与"更多设置"共用的纯函数，也是后端 `routeModelCall`（`apps/api`）落地时对齐的契约
 * ——`apps/api/tests/capability/model/chat-datascope-contract.test.ts` 钉住后端那一半。
 * 这里钉前端这一半：真正消费它的组件（批准卡 / composer 设置）没有另写一份判定，
 * 且规则的落脚文案与 D-U1 裁决一致。
 */
describe("D-U1 机密硬路由单一事实源", () => {
  const chatMock = readFileSync(new URL("../lib/mock/chat.ts", import.meta.url), "utf8");
  const approvalCard = readFileSync(new URL("../components/chat/approval-card.tsx", import.meta.url), "utf8");
  const composerSettings = readFileSync(new URL("../components/chat/composer-settings.tsx", import.meta.url), "utf8");

  it("approval-card.tsx 从 dataScopeConstraint / modelPolicyViolation 推导，不自己判 hosting", () => {
    expect(approvalCard).toMatch(/dataScopeConstraint/);
    expect(approvalCard).toMatch(/modelPolicyViolation/);
    const codeLines = approvalCard.split("\n").filter((l) => !/^\s*(\*|\/\/|\{\/\*)/.test(l));
    // 手抄的迹象：组件里直接判断 localModelOnly && hosting === "cloud"，绕开纯函数自己下结论。
    expect(codeLines.some((l) => /localModelOnly\s*&&.*hosting\s*===\s*"cloud"/.test(l))).toBe(false);
  });

  it("composer-settings.tsx（'更多设置'的模型切换）复用 isModelSelectable，不另写置灰判据", () => {
    expect(composerSettings).toMatch(/isModelSelectable/);
    const codeLines = composerSettings.split("\n").filter((l) => !/^\s*(\*|\/\/|\{\/\*)/.test(l));
    expect(codeLines.some((l) => /hosting\s*===\s*"cloud"\s*&&\s*confidential/.test(l))).toBe(false);
  });

  it("D-U1 的语义是'整轮全程本地'，不是'机密走本地、云端承接非机密'（裁决原文逐字存在）", async () => {
    expect(chatMock).toMatch(/裁决\s*D-U1/);
    expect(chatMock).toMatch(/不是「机密走本地、云端承接非机密部分」/);
    const { dataScopeConstraint, modelPolicyViolation, isModelSelectable, hasConfidential } = await import(
      "../lib/mock/chat"
    );
    const scope = [
      { id: "a", label: "项目库", confidential: false },
      { id: "b", label: "电价曲线", confidential: true },
    ];
    expect(hasConfidential(scope)).toBe(true);
    expect(dataScopeConstraint(scope)).toMatchObject({ localModelOnly: true });

    const models = [
      { id: "gpt-5.2", label: "gpt-5.2", hosting: "cloud" as const, version: "v1" },
      { id: "qwen3-32b", label: "本地 qwen3-32b", hosting: "local" as const, version: "v1" },
    ];
    // 反证（不是分流）：混入云端模型即报违规——分流实现会把这种"云端+本地并存"判为合规。
    expect(modelPolicyViolation(models, scope)).not.toBeNull();
    expect(isModelSelectable(models[0]!, scope).ok).toBe(false);
    expect(isModelSelectable(models[1]!, scope).ok).toBe(true);

    // 反证（不是恒本地）：不含机密时两个模型都可选。
    expect(modelPolicyViolation(models, [])).toBeNull();
    expect(isModelSelectable(models[0]!, []).ok).toBe(true);
  });

  it("已知的原型缺口如实登记而非静默——净新屏 routing-screen.tsx 仍用自己的 mock 布尔量，非本 feature 范围", () => {
    // agent-runtime/routing-screen.tsx 是 UI 先行原型净新屏（design-signoff 已登记），
    // 用的是 lib/mock/agent-runtime.ts 的 ROUTING_HAS_CONFIDENTIAL，不经 chat.ts 的纯函数——
    // 这是已知的、有出处的范围边界（该屏走自己的 mock 数据管线），不是本条断言要收敛的漂移，
    // 如实登记，避免以后被误当成"新发现的重复"而重复修一遍。
    const KNOWN_SEPARATE_MOCK_PIPELINE = ["apps/web/components/agent-runtime/routing-screen.tsx"];
    expect(KNOWN_SEPARATE_MOCK_PIPELINE).toContain("apps/web/components/agent-runtime/routing-screen.tsx");
  });
});

describe("设计 token 单一事实源", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  it("globals.css 同时定义明暗两套主题", () => {
    expect(css).toMatch(/:root\s*\{/);
    expect(css).toMatch(/\.dark\s*\{/);
  });

  it("每个被标注的色面 token 都有配对 foreground", () => {
    const root = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
    const declared = [...root.matchAll(/--([a-z0-9-]+)\s*:\s*[\d.]+\s+[\d.]+%\s+[\d.]+%/g)].map((m) => m[1]!);
    const bases = declared.filter((k) => !k.endsWith("-foreground"));
    const structural = new Set(["border", "border-subtle", "input", "ring"]);
    bases.filter((b) => !structural.has(b)).forEach((b) => {
      expect(declared, `--${b} 缺少配对 --${b}-foreground`).toContain(`${b}-foreground`);
    });
  });
});
