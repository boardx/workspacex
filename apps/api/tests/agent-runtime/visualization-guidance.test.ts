/**
 * VZ-02 —— 可视化指引进 system prompt（纯函数，零契约变更）。
 * 原始反证是 devapp 实测（2026-08-12）：模型在 mermaid 节点标签里塞裸 `|` 和 `<br/>`，前端严格
 * 模式解析失败、落诚实错误盒。VZ-02 把「产出可解析 mermaid」写进模型看到的 system prompt，从
 * 源头减少那类失败。这里钉住指引真的进了每个 agent 的 system、且写明了那两条关键规则。
 *
 * ## 2026-08-26（issue #2099）追加的那组断言在钉什么
 *
 * 新反证：问「最好的教育是怎么样的」（未挂任何 skill）被塞了一张思维导图。旧版**已经**有一句
 * 「只在图真的帮助理解时才画，纯问答不必配图」却没拦住，所以修法不是「把话说得更重」，而是
 * 改掉它失效的机制（顺序倒置 / 触发句不点图型名 / 判据可核对 / 反例逐字 / 模糊默认翻面）。
 * 下面 describe("#2099 …") 里的每一条，都对应其中一个机制——它们的作用是：将来有人为了
 * 「精简」或「加回图型列举」把某个机制拆掉时，这里会红，而不是悄悄退回到会塞图的版本。
 *
 * ⚠ **这些断言钉的是 prompt 的形状，不是模型的行为。** 全绿 ≠ 模型一定不塞图——这一条是
 *    人类知情选择的软约束，没有硬门控。行为侧的证据只能来自真实模型对照（见 issue #2099）。
 */
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, VISUALIZATION_GUIDANCE } from "../../src/application/agent-run/execute-run";

describe("VZ-02 buildSystemPrompt 追加可视化指引", () => {
  it("每个 agent 的 system 都带上可视化指引，且原指令仍在最前", () => {
    const sys = buildSystemPrompt("你是通用助手", []);
    expect(sys.startsWith("你是通用助手")).toBe(true);
    expect(sys).toContain(VISUALIZATION_GUIDANCE);
  });

  it("顺序：指令 → skills → 可视化指引（指引在最后，不抢 skill 位）", () => {
    const sys = buildSystemPrompt("INSTR", [{ versionId: "v1", stableName: "skill-a", content: "SKILL-A" }]);
    expect(sys.indexOf("INSTR")).toBeLessThan(sys.indexOf("SKILL-A"));
    expect(sys.indexOf("SKILL-A")).toBeLessThan(sys.indexOf("## 可视化"));
  });

  it("指引列出 12 类白名单图类型（与前端校验同一份枚举，prompt 侧可读列出）", () => {
    for (const t of ["flowchart", "sequenceDiagram", "classDiagram", "stateDiagram", "erDiagram",
      "journey", "gantt", "pie", "quadrantChart", "mindmap", "timeline", "gitGraph"]) {
      expect(VISUALIZATION_GUIDANCE).toContain(t);
    }
  });

  it("指引写明两条防解析失败的关键规则：特殊字符标签加引号、不要 <br/>", () => {
    // 裸 | 会被当边标签分隔符 → 要求加双引号
    expect(VISUALIZATION_GUIDANCE).toContain("双引号");
    expect(VISUALIZATION_GUIDANCE).toContain("|");
    // 不要 HTML <br/>
    expect(VISUALIZATION_GUIDANCE).toContain("<br/>");
  });
});

describe("#2099 默认不画——钉住五个「为什么这次会比上次有效」的机制", () => {
  it("机制①顺序倒置：默认态在第一行，不是句尾从属状语", () => {
    const firstLine = VISUALIZATION_GUIDANCE.split("\n")[0];
    expect(firstLine).toContain("默认不画");
  });

  it("机制②去启发：默认态先于 12 类白名单出现，白名单被「已判定要画」的门限句 gate 住", () => {
    const iDefault = VISUALIZATION_GUIDANCE.indexOf("默认不画图");
    const iGate = VISUALIZATION_GUIDANCE.indexOf("只在你已经按上面判定");
    const iWhitelist = VISUALIZATION_GUIDANCE.indexOf("quadrantChart");
    expect(iDefault).toBeGreaterThanOrEqual(0);
    expect(iGate).toBeGreaterThanOrEqual(0);
    expect(iWhitelist).toBeGreaterThanOrEqual(0);
    // 旧版是「图型点名 → 才说别乱画」；新版必须是「先定默认 → 门限 → 才列图型」。
    expect(iDefault).toBeLessThan(iGate);
    expect(iGate).toBeLessThan(iWhitelist);
  });

  it("机制③判据可核对：不可证伪的「图真的帮助理解」已被移除，换成有向结构判据", () => {
    // 这句是旧版唯一的抑制，模型永远能说服自己满足它。加回来 = 把稀释源加回来。
    expect(VISUALIZATION_GUIDANCE).not.toContain("图真的帮助理解");
    expect(VISUALIZATION_GUIDANCE).toContain("有向结构");
    expect(VISUALIZATION_GUIDANCE).toContain("并列的观点");
  });

  it("机制④反例逐字包含翻车那一句（失败样本进 prompt）", () => {
    expect(VISUALIZATION_GUIDANCE).toContain("最好的教育是怎么样的");
  });

  it("机制⑤模糊地带默认值翻面：拿不准 = 不画", () => {
    expect(VISUALIZATION_GUIDANCE).toContain("拿不准就不画");
  });

  it("反向不被删：正例仍在，出图能力没有被一并抑制掉", () => {
    expect(VISUALIZATION_GUIDANCE).toContain("正例（该画）");
    expect(VISUALIZATION_GUIDANCE).toContain("```mermaid");
  });
});

/**
 * issue #3462 ——「一句话要两张画布，比如"画一张流程图，再画一张时间轴"，只产出一张」。
 *
 * 真实 dashscope 采样（2026-09-12，本地真栈 `pnpm run e2e:real-model-smoke` 同款环境，
 * 非本测试跑）：4 次有效试验里 3 次已经能一次性给出两个独立 ```mermaid 围栏，1 次是与
 * 本缺陷无关的模型回显故障（原样返回了用户输入，两侧摘要 digest 相同）——说明这不是
 * 前端/后端的确定性 code bug（`extractMermaidBlocks` 本来就按围栏数切段，`cvs-${i}`/
 * `mmd-${i}` 早就支持多段），而是旧版指引里两处「一个」的单数措辞会偶发诱导模型只画一张。
 * 这里钉住的是**指引文本已经加了显式的多图规则**，不是钉死模型今后一定不再漏画——
 * 那件事只能靠真实模型对照持续观察，见上面 `VISUALIZATION_GUIDANCE` 头注对置信度的说明。
 */
describe("#3462 一条消息要多张图——显式规则，不再依赖「一个」的单数措辞", () => {
  it("补了一条要求「按数量画多张、每张独立围栏」的显式规则", () => {
    expect(VISUALIZATION_GUIDANCE).toContain("一条消息里可以要求多张不同的图");
    expect(VISUALIZATION_GUIDANCE).toContain("不要合并成一张");
    expect(VISUALIZATION_GUIDANCE).toContain("也不要只画其中一张就结束");
  });

  it("多图规则出现在「已判定要画」的门限之后（不与默认不画的判定混在一起）", () => {
    const iGate = VISUALIZATION_GUIDANCE.indexOf("只在你已经按上面判定");
    const iMulti = VISUALIZATION_GUIDANCE.indexOf("一条消息里可以要求多张不同的图");
    expect(iGate).toBeGreaterThanOrEqual(0);
    expect(iMulti).toBeGreaterThan(iGate);
  });

  it("旧版诱导单张的「一个」措辞已改写，不再暗示「这一轮只画一张」", () => {
    // ⚠ 不能直接断言不含子串「输出一个 ```mermaid 围栏代码块」——新版「每张图各自输出一个
    //   ```mermaid 围栏代码块」本身就以子串形式包含它。真正要钉住的是旧版**独立成句、
    //   前面没有「每张图各自」限定**的那种单数框架已经不在了，所以按行首匹配。
    const singularBulletLine = VISUALIZATION_GUIDANCE
      .split("\n")
      .some((line) => line.startsWith("输出一个 ```mermaid 围栏代码块"));
    expect(singularBulletLine).toBe(false);
    expect(VISUALIZATION_GUIDANCE).toContain("每张图各自输出一个 ```mermaid 围栏代码块");
    expect(VISUALIZATION_GUIDANCE).not.toContain("先给一个**能渲染**的简洁图");
    expect(VISUALIZATION_GUIDANCE).toContain("每张图各自先给一个**能渲染**的简洁版本");
  });
});
