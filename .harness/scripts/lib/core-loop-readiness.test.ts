/**
 * core-loop-readiness.test.ts —— issue #814。
 *
 * ## 这份测试的第一职责是反证，不是覆盖率
 *
 * 本仓已九次出现"门写好了、全绿、但它其实什么都拦不住"。所以四道门每一道都配一对
 * 用例：**一条证明它在该红的时候红，一条证明它在不该红的时候不红**。只写后者的门
 * 等于没有门（恒绿）；只写前者的门会把所有人拦死（恒红），两种都空转。
 *
 * 聚合公式 `CLR = min(R, mean(B, V-D, V-P))` 单独测：它是本 issue 引入的设计决定，
 * 不是从既有文档推出来的，因此更需要把行为钉死——尤其是"R 封顶"这条，它是整套
 * 标准的激励设计核心（走不到的地方做得再好也等于 0）。
 */
import { describe, expect, it } from "vitest";
import {
  CEILING_TRACK,
  PASS_THRESHOLD,
  judgeReadiness,
  judgeTrack,
  isStructurallyResolvable,
  matchesAny,
  validateState,
  type ReadinessState,
  type TrackRecord,
} from "./core-loop-readiness";

const SHA = "a".repeat(40);

/** 一条**完全健康**的记录。每个反证都从它出发，只破坏一个字段——这样"红"一定 */
/** 归因到被破坏的那一处，而不是记录本来就不合格。 */
function healthy(over: Partial<TrackRecord> = {}): TrackRecord {
  return {
    name: "测试 track",
    authority: ".harness/rubrics/whatever.md#x",
    allowed_scorers: ["rev-e2e"],
    max: 10,
    score: 8,
    scored_sha: SHA,
    scored_by: "rev-e2e",
    implemented_by: "dev-chat-e2e",
    evidence: ["evidence/shot.png"],
    watch: ["apps/web/**"],
    blocking_issues: [111],
    ...over,
  };
}

describe("judgeTrack：四道门，每道一对（该红的红 / 不该红的不红）", () => {
  it("健康记录如实计分——门不能恒红", () => {
    const v = judgeTrack("B", healthy(), []);
    expect(v.discounts).toEqual([]);
    expect(v.effectiveScore).toBe(8);
  });

  // ── G1 未评分记 0，不记「未知」 ─────────────────────────────────────────
  it("G1 反证：未评分记 0（空着不等于满分）", () => {
    const v = judgeTrack("B", healthy({ score: null, scored_sha: null, scored_by: null }), []);
    expect(v.discounts).toContain("NEVER_SCORED");
    expect(v.effectiveScore).toBe(0);
    expect(v.rawScore).toBeNull(); // 原始分仍如实保留为 null，不伪装成 0 分的实测
  });

  // ── G2 过期分数记 0 ────────────────────────────────────────────────────
  it("G2 反证：watch 命中的文件在评分后改过 ⇒ 判定为过期", () => {
    // ⚠ 2026-08-09 方案 A 改了后果，没改**检出**：STALE 仍然要被检出（这条断言），
    // 但它不再清零——分数计入 `clr`，改为阻断 `passes`。理由见 judgeTrack 里的长注释：
    // 过期是六种扣分里唯一「测量有效、只是稍旧」的一种。清零的语义由下面那组用例守。
    const v = judgeTrack("B", healthy(), ["apps/web/components/chat/chat-read-screen.tsx"]);
    expect(v.discounts).toContain("STALE");
    expect(v.isStale).toBe(true);
    expect(v.effectiveScore).toBe(8); // 如实计入，不再是 0
  });

  it("G2 不误伤：改的文件不在 watch 里 ⇒ 分数仍然有效", () => {
    const v = judgeTrack("B", healthy(), ["docs/README.md", ".harness/state/x.json"]);
    expect(v.discounts).toEqual([]);
    expect(v.effectiveScore).toBe(8);
  });

  it("G2 的 null 与空数组含义不同：null=没查（不触发），[]=查了没改（不触发但语义不同）", () => {
    expect(judgeTrack("B", healthy(), null).discounts).toEqual([]);
    expect(judgeTrack("B", healthy(), []).discounts).toEqual([]);
  });

  // ── G3 自评不算分 ──────────────────────────────────────────────────────
  it("G3 反证：scored_by === implemented_by ⇒ 自评 ⇒ 记 0", () => {
    const v = judgeTrack("B", healthy({ scored_by: "rev-e2e", implemented_by: "rev-e2e" }), []);
    expect(v.discounts).toContain("SELF_SCORED");
    expect(v.effectiveScore).toBe(0);
  });

  it("G3 反证：评分人不在 allowed_scorers 里 ⇒ 记 0（rev-uiux 不能替 rev-e2e 打行为分）", () => {
    const v = judgeTrack("B", healthy({ scored_by: "rev-uiux" }), []);
    expect(v.discounts).toContain("SCORER_NOT_ALLOWED");
    expect(v.effectiveScore).toBe(0);
  });

  // ── G4 无证据不算分 ────────────────────────────────────────────────────
  it("G4 反证：evidence 为空 ⇒ 记 0（没有证据 = 没有完成）", () => {
    const v = judgeTrack("B", healthy({ evidence: [] }), []);
    expect(v.discounts).toContain("NO_EVIDENCE");
    expect(v.effectiveScore).toBe(0);
  });

  it("越界分数记 0，不裁剪到 10——裁剪会把一个填错的记录伪装成满分", () => {
    expect(judgeTrack("B", healthy({ score: 11 }), []).effectiveScore).toBe(0);
    expect(judgeTrack("B", healthy({ score: -1 }), []).effectiveScore).toBe(0);
  });

  it("多道门同时命中时全部列出，不是只报第一条", () => {
    const v = judgeTrack("B", healthy({ evidence: [], scored_by: "rev-uiux" }), ["apps/web/x.ts"]);
    expect(v.discounts).toEqual(
      expect.arrayContaining(["NO_EVIDENCE", "SCORER_NOT_ALLOWED", "STALE"]),
    );
  });
});

describe("judgeReadiness：R 是天花板，不是加数", () => {
  const state = (r: number | null, b: number, vd: number, vp: number): ReadinessState => ({
    version: 1,
    tracks: {
      R: healthy({ name: "可达性", score: r, ...(r === null ? { scored_sha: null, scored_by: null } : {}), blocking_issues: [660, 619] }),
      B: healthy({ name: "行为", score: b, blocking_issues: [714] }),
      "V-D": healthy({ name: "项目对话保真", score: vd, allowed_scorers: ["rev-uiux"], scored_by: "rev-uiux", blocking_issues: [728] }),
      "V-P": healthy({ name: "个人对话", score: vp, allowed_scorers: ["rev-uiux"], scored_by: "rev-uiux", blocking_issues: [728, 750] }),
    },
  });

  it("可达性低时封顶——体验与视觉满分也抬不动总分", () => {
    const v = judgeReadiness(state(3, 10, 10, 10), {});
    expect(v.reachability).toBe(3);
    expect(v.experienceMean).toBe(10);
    expect(v.clr).toBe(3); // ← 这条是整套标准的激励设计核心
  });

  it("可达性满分时，总分由其余三条的均值决定", () => {
    const v = judgeReadiness(state(10, 4, 1, 7), {});
    expect(v.experienceMean).toBe(4); // (4+1+7)/3
    expect(v.clr).toBe(4);
  });

  it("R 未评分 ⇒ 天花板为 0 ⇒ CLR 为 0（不知道可达性时不许声称就绪）", () => {
    const v = judgeReadiness(state(null, 10, 10, 10), {});
    expect(v.clr).toBe(0);
  });

  it("缺 R 这条 track 直接抛——公式没有 R 就不成立，不许静默降级成四项平均", () => {
    const noR: ReadinessState = { version: 1, tracks: { B: healthy() } };
    expect(() => judgeReadiness(noR, {})).toThrow(/缺天花板 track/);
  });

  it("统一队列：R 的阻塞项在最前，其后按 track 得分升序，且去重", () => {
    const v = judgeReadiness(state(3, 9, 1, 5), {});
    // R(660,619) 先；其余按分升序 V-D(1)→V-P(5)→B(9)；728 在 V-D 已出现，V-P 里去重
    expect(v.queue).toEqual([660, 619, 728, 750, 714]);
  });

  it("每条 track 的扣分原因随判决一起返回，看板能直接渲染「为什么这条是 0」", () => {
    const s = state(5, 8, 8, 8);
    const v = judgeReadiness(s, { B: ["apps/web/components/chat/x.tsx"] });
    expect(v.tracks.find((t) => t.id === "B")?.discounts).toContain("STALE");
    expect(v.tracks.find((t) => t.id === "V-D")?.discounts).toEqual([]);
  });

  it(`天花板 track 的 id 是导出的常量，改名只有一处（当前：${CEILING_TRACK}）`, () => {
    expect(CEILING_TRACK).toBe("R");
  });
});

describe("G5 血统门：评的必须是 main 血统的树（rev-uiux 2026-08-09 提出）", () => {
  it("反证：scored_sha 不是 origin/main 的祖先 ⇒ 记 0（#728 十轮评分的真实处境）", () => {
    const v = judgeTrack("V-D", healthy(), [], false);
    expect(v.discounts).toContain("SHA_NOT_ON_MAIN");
    expect(v.effectiveScore).toBe(0);
  });

  it("是祖先 ⇒ 如实计入（门不能恒红）", () => {
    expect(judgeTrack("V-D", healthy(), [], true).discounts).toEqual([]);
  });

  it("判不了（null，离线/没 fetch）⇒ 不判罚 —— 问不到不等于有问题", () => {
    expect(judgeTrack("V-D", healthy(), [], null).discounts).toEqual([]);
  });

  it("G5 与 G2 是两件事：树对但改动过 ⇒ STALE；树不对 ⇒ SHA_NOT_ON_MAIN，可同时命中", () => {
    const v = judgeTrack("V-D", healthy(), ["apps/web/x.tsx"], false);
    expect(v.discounts).toEqual(expect.arrayContaining(["STALE", "SHA_NOT_ON_MAIN"]));
  });
});

describe("G6 证据可解析门：抓住 coord-main 自己播下的假锚点", () => {
  const yes = () => true;

  it("反证：`#issuecomment-round6` —— 就是 2026-08-09 混进记录、且过了 G4 的那条假证据", () => {
    expect(isStructurallyResolvable(
      "https://github.com/boardx/workspacex/issues/728#issuecomment-round6", yes,
    )).toBe(false);
  });

  it("真锚点（数字 id）通过", () => {
    expect(isStructurallyResolvable(
      "https://github.com/boardx/workspacex/issues/814#issuecomment-5230462786", yes,
    )).toBe(true);
  });

  it("仓库内路径：存在则过，不存在则否", () => {
    expect(isStructurallyResolvable("a/b.png", (r) => r === "a/b.png")).toBe(true);
    expect(isStructurallyResolvable("a/missing.png", (r) => r === "a/b.png")).toBe(false);
  });

  it("没注入 exists（离线渲染）⇒ 路径不判罚，同 changedSince 的 null 语义", () => {
    expect(isStructurallyResolvable("whatever/x.png", null)).toBe(true);
  });

  it("空串 / 纯空白不算证据", () => {
    expect(isStructurallyResolvable("", yes)).toBe(false);
    expect(isStructurallyResolvable("   ", yes)).toBe(false);
  });

  it("坏 URL 不过", () => {
    expect(isStructurallyResolvable("http://[bad", yes)).toBe(false);
  });

  describe("结构化前缀（#867 评分员的格式，2026-08-10 起支持）", () => {
    const yes = () => true;
    it("sha: 完整 40 位 hex 通过；短的/非 hex 拦下（reflog 短 SHA 不算完整证据）", () => {
      expect(isStructurallyResolvable("sha:" + "e2d1577157706e711ec752fafb2dd8795eaafa18", yes)).toBe(true);
      expect(isStructurallyResolvable("sha:e2d15771", yes)).toBe(false);
      expect(isStructurallyResolvable("sha:not-a-sha", yes)).toBe(false);
    });
    it("ci: 后面必须是可解析 URL", () => {
      expect(isStructurallyResolvable("ci:https://github.com/o/r/actions/runs/31375704116", yes)).toBe(true);
      expect(isStructurallyResolvable("ci:not a url", yes)).toBe(false);
    });
    it("spec:/src:/authority: 验路径部分存在，容忍 :行号、#锚、尾随 (注记) 三种后缀", () => {
      const ex = (r: string) => r === "apps/web/e2e/x.spec.ts" || r === "docs/a.md";
      expect(isStructurallyResolvable("spec:apps/web/e2e/x.spec.ts", ex)).toBe(true);
      expect(isStructurallyResolvable("src:apps/web/e2e/x.spec.ts:793-839 (AgentRunToolCallSteps)", ex)).toBe(true);
      expect(isStructurallyResolvable("authority:docs/a.md#十项打分维度 item 3", ex)).toBe(true);
      expect(isStructurallyResolvable("src:apps/missing.ts", ex)).toBe(false);
    });

    it("回归（第二次误伤，2026-08-10）：不带行号、直接尾随 (注记) 的 authority: 也要能过", () => {
      const ex = (r: string) => r === "docs/a.md";
      // round 17 的真实证据形状：`authority:….md (含 2026-08-10 P7 路径B裁决)`
      expect(isStructurallyResolvable("authority:docs/a.md (含 2026-08-10 P7 路径B裁决)", ex)).toBe(true);
      // 注记不能变成放行万能钥匙：路径不存在时带注记照样拦
      expect(isStructurallyResolvable("authority:docs/missing.md (whatever)", ex)).toBe(false);
    });
    it("cmd: 非空即过——已知边界：验证不了命令真的跑过，挡编造靠 G3 与人的复核", () => {
      expect(isStructurallyResolvable("cmd:pnpm run verify:base -> exit 1 (…)", yes)).toBe(true);
      expect(isStructurallyResolvable("cmd:", yes)).toBe(false);
    });
    it("未知前缀放行——拒绝会对更好的新格式恒红，而恒红的门会被绕过（#849 教训）", () => {
      expect(isStructurallyResolvable("trace:whatever-new-format", yes)).toBe(true);
    });
    it("回归：#867 的六类真实证据整条 track 不再被 G6 误杀", () => {
      const v = judgeTrack("V-P", healthy({
        score: 0,
        evidence: [
          "sha:e2d1577157706e711ec752fafb2dd8795eaafa18",
          "cmd:pnpm run verify:base -> exit 1 (lint:templates-doctor …)",
          "ci:https://github.com/boardx/workspacex/actions/runs/31375704116",
          "spec:apps/web/e2e/chat-main-shots.spec.ts",
          "src:apps/web/components/chat/chat-live-message-panel.tsx:793-839 (AgentRunToolCallSteps)",
          "authority:.harness/rubrics/chat-main-fidelity-rubric.md#硬门",
        ],
      }), [], true, (r) => r.startsWith("apps/") || r.startsWith(".harness/"));
      expect(v.discounts).not.toContain("EVIDENCE_UNRESOLVABLE");
    });
  });

  it("⚠ 刻意不做网络存活检查：一个格式合法但已 404 的 URL 仍然通过", () => {
    // 记录这个已知边界——网络门会抖动，抖动的门迟早被 --no-verify 绕过（#504 先例）。
    expect(isStructurallyResolvable("https://example.com/definitely-404", yes)).toBe(true);
  });

  it("整条 track：任一证据不可解析 ⇒ 该 track 记 0", () => {
    const bad = healthy({ evidence: ["ok/path.png", "https://github.com/o/r/issues/1#issuecomment-abc"] });
    const v = judgeTrack("V-D", bad, [], true, () => true);
    expect(v.discounts).toContain("EVIDENCE_UNRESOLVABLE");
    expect(v.effectiveScore).toBe(0);
  });
});

describe("PASS_THRESHOLD：合格门槛 9（人类 2026-08-09 裁决 #831）", () => {
  const state = (r: number, b: number, vd: number, vp: number): ReadinessState => ({
    version: 1,
    tracks: {
      R: healthy({ score: r }), B: healthy({ score: b }),
      "V-D": healthy({ score: vd }), "V-P": healthy({ score: vp }),
    },
  });

  it("门槛是 9，不是 10 —— 常量是单一事实源，文档里那段话不是", () => {
    expect(PASS_THRESHOLD).toBe(9);
  });

  it("CLR = 9 ⇒ 达标（边界值取到，不是 >9）", () => {
    expect(judgeReadiness(state(9, 9, 9, 9), {}).passes).toBe(true);
  });

  it("反证：CLR = 8.9 ⇒ 不达标（差一点点也是不达标，不许四舍五入放过）", () => {
    // mean(9,9,8.7)=8.9 ⇒ min(10, 8.9)=8.9
    const v = judgeReadiness(state(10, 9, 9, 8.7), {});
    expect(v.clr).toBe(8.9);
    expect(v.passes).toBe(false);
  });

  it("反证：可达性封顶仍然生效 —— R=8 时体验全满也不达标", () => {
    const v = judgeReadiness(state(8, 10, 10, 10), {});
    expect(v.clr).toBe(8);
    expect(v.passes).toBe(false); // 走不到的地方做得再好也不算达标
  });

  it("满分 10 当然达标（门槛降到 9 不代表 10 变成非法）", () => {
    expect(judgeReadiness(state(10, 10, 10, 10), {}).passes).toBe(true);
  });

  it("一条 track 被门控判 0 ⇒ 直接不达标（G1-G4 与门槛是两层，不互相抵消）", () => {
    const s = state(10, 10, 10, 10);
    const broken: ReadinessState = {
      ...s,
      tracks: { ...s.tracks, B: healthy({ score: 10, evidence: [] }) }, // G4 无证据
    };
    expect(judgeReadiness(broken, {}).passes).toBe(false);
  });
});

describe("方案 A：STALE 计入 clr 但阻断 passes（人类 2026-08-09 裁决）", () => {
  const st = (over: Record<string, Partial<TrackRecord>> = {}): ReadinessState => ({
    version: 1,
    tracks: {
      R: healthy({ score: 9, ...(over.R ?? {}) }),
      B: healthy({ score: 9, ...(over.B ?? {}) }),
      "V-D": healthy({ score: 9, ...(over["V-D"] ?? {}) }),
      "V-P": healthy({ score: 9, ...(over["V-P"] ?? {}) }),
    },
  });

  it("STALE 不再清零 —— 分数如实计入（这正是 track R 6/10 被旧规则吃掉的那个场景）", () => {
    const v = judgeTrack("R", healthy({ score: 6 }), ["apps/web/components/chat/x.tsx"]);
    expect(v.discounts).toContain("STALE");
    expect(v.effectiveScore).toBe(6);   // ← 旧规则这里是 0
    expect(v.isStale).toBe(true);
  });

  it("但它阻断达标：四条全 9 分、其中一条过期 ⇒ clr=9 却 passes=false", () => {
    const v = judgeReadiness(st(), { R: ["apps/web/components/chat/x.tsx"] });
    expect(v.clr).toBe(9);
    expect(v.staleCount).toBe(1);
    expect(v.passes).toBe(false);       // ← 严格性挪到这里，没有放松
  });

  it("全部新鲜且够分 ⇒ 真达标", () => {
    const v = judgeReadiness(st(), {});
    expect(v.clr).toBe(9);
    expect(v.staleCount).toBe(0);
    expect(v.passes).toBe(true);
  });

  it("其余五种扣分仍然清零 —— 只有 STALE 被特赦", () => {
    expect(judgeTrack("R", healthy({ evidence: [] }), []).effectiveScore).toBe(0);
    expect(judgeTrack("R", healthy({ scored_by: "rev-uiux" }), []).effectiveScore).toBe(0);
    expect(judgeTrack("R", healthy({ implemented_by: "rev-e2e" }), []).effectiveScore).toBe(0);
    expect(judgeTrack("R", healthy({ score: 11 }), []).effectiveScore).toBe(0);
    expect(judgeTrack("R", healthy({ score: null, scored_sha: null, scored_by: null }), []).effectiveScore).toBe(0);
    expect(judgeTrack("R", healthy(), [], false).effectiveScore).toBe(0); // SHA_NOT_ON_MAIN
  });

  it("过期 + 无效同时命中 ⇒ 仍然清零（特赦只对「单独过期」生效）", () => {
    const v = judgeTrack("R", healthy({ evidence: [] }), ["apps/web/x.ts"]);
    expect(v.isStale).toBe(true);
    expect(v.effectiveScore).toBe(0);
  });

  it("真实场景回归：R=6 过期 · V-D=1 · V-P=9 · B 未评分 ⇒ clr=3.3 而不是 0", () => {
    const real: ReadinessState = {
      version: 1,
      tracks: {
        R: healthy({ score: 6 }),
        B: healthy({ score: null, scored_sha: null, scored_by: null }),
        "V-D": healthy({ score: 1 }),
        "V-P": healthy({ score: 9 }),
      },
    };
    const v = judgeReadiness(real, { R: ["apps/web/components/chat/x.tsx"] });
    expect(v.reachability).toBe(6);              // 旧规则：0
    expect(v.experienceMean).toBe(3.3);          // mean(0, 1, 9)
    expect(v.clr).toBe(3.3);                     // 旧规则：0 —— 看板恒 0 的根源
    expect(v.passes).toBe(false);
  });
});

describe("matchesAny：glob 的两个真实坑", () => {
  it("`**` 跨目录，`*` 不跨——顺序处理错了 apps/** 就匹配不到深层文件", () => {
    expect(matchesAny(["apps/web/lib/chat/x.ts"], ["apps/**"])).toBe(true);
    expect(matchesAny(["apps/web/lib/chat/x.ts"], ["apps/*"])).toBe(false);
    expect(matchesAny(["apps/web"], ["apps/*"])).toBe(true);
  });

  it("`a/**/b.ts` 能匹配零层中间目录", () => {
    expect(matchesAny(["apps/b.ts"], ["apps/**/b.ts"])).toBe(true);
    expect(matchesAny(["apps/x/y/b.ts"], ["apps/**/b.ts"])).toBe(true);
  });

  it("点号不当通配符——`x.ts` 的 glob 不该匹配 `xats`", () => {
    expect(matchesAny(["xats"], ["x.ts"])).toBe(false);
  });
});

describe("validateState：手写记录的形状必须被机械检查", () => {
  const good: ReadinessState = {
    version: 1,
    tracks: { R: healthy(), B: healthy() },
  };

  it("健康 state 无问题", () => {
    expect(validateState(good)).toEqual([]);
  });

  it("反证：漏 watch ⇒ 报错（没有 watch，G2 过期门恒不触发，是最危险的静默失效）", () => {
    const bad = { ...good, tracks: { ...good.tracks, B: healthy({ watch: [] }) } };
    expect(validateState(bad).join()).toMatch(/缺 watch/);
  });

  it("反证：scored_sha 不是 40 位 SHA ⇒ 报错（实测必须声明 SHA）", () => {
    const bad = { ...good, tracks: { ...good.tracks, B: healthy({ scored_sha: "abc123" }) } };
    expect(validateState(bad).join()).toMatch(/40 位小写 SHA/);
  });

  it("反证：半截记录（有分数却把 SHA 清成 null）⇒ 报错", () => {
    const bad = { ...good, tracks: { ...good.tracks, B: healthy({ scored_sha: null }) } };
    expect(validateState(bad).length).toBeGreaterThan(0);
  });

  it("反证：未评分却留着 scored_by ⇒ 报错（改分数忘了改人的半截记录）", () => {
    const bad = {
      ...good,
      tracks: { ...good.tracks, B: healthy({ score: null, scored_sha: null, scored_by: "rev-e2e" }) },
    };
    expect(validateState(bad).join()).toMatch(/scored_by 也必须为 null/);
  });

  it("反证：max 不是 10 ⇒ 报错（四条 track 不同量纲时取均值没有意义）", () => {
    const bad = { ...good, tracks: { ...good.tracks, B: healthy({ max: 5 }) } };
    expect(validateState(bad).join()).toMatch(/max 必须是 10/);
  });

  it("反证：缺天花板 track R ⇒ 报错", () => {
    expect(validateState({ version: 1, tracks: { B: healthy() } }).join()).toMatch(/缺天花板/);
  });
});
