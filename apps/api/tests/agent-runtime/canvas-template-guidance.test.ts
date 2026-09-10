/**
 * issue #1493 —— 纯函数单测：`buildCanvasTemplateGuidance` 的拼接与空清单行为，
 * `buildSystemPrompt` 新增的可选第三参数不破坏既有调用点（不传 = 逐字节不变）。
 * 真栈（读库 + 现查 + 不缓存 + 个人对话）由
 * `tests/agent-runtime/canvas-template-guidance-real-db.test.ts` 覆盖。
 */
import { describe, expect, it } from "vitest";
import {
  buildCanvasTemplateGuidance,
  CANVAS_INFERRED_MARKER,
  type CanvasTemplateGuidanceInfo,
} from "../../src/application/agent-run/canvas-template-guidance";
import { buildSystemPrompt, VISUALIZATION_GUIDANCE } from "../../src/application/agent-run/execute-run";

describe("issue #1493 buildCanvasTemplateGuidance", () => {
  it("空列表返回 null——不注入假清单", () => {
    expect(buildCanvasTemplateGuidance([])).toBeNull();
  });

  it("非空列表拼出 key + 分区名 + canvas 围栏格式说明", () => {
    const guidance = buildCanvasTemplateGuidance([
      { key: "persona", displayName: "用户画像", sections: [{ name: "用户描述" }, { name: "目标和需求" }] },
      { key: "swot", displayName: "SWOT 分析", sections: [{ name: "优势" }, { name: "劣势" }] },
    ]);
    expect(guidance).not.toBeNull();
    expect(guidance).toContain("persona〔用户描述/目标和需求〕");
    expect(guidance).toContain("swot〔优势/劣势〕");
    expect(guidance).toContain("```canvas");
    expect(guidance).toContain("模板: <key>");
  });

  it("issue #2341 —— 强调「模板: <key> 必须是围栏首行」，明说漏写的后果", () => {
    const guidance = buildCanvasTemplateGuidance([
      { key: "persona", displayName: "用户画像", sections: [{ name: "用户描述" }] },
    ]);
    expect(guidance).not.toBeNull();
    expect(guidance).toContain("必须是 ```canvas 围栏内的第一行");
    expect(guidance).toContain("用户只会看到一条报错");
  });
});

describe("issue #1493 buildSystemPrompt 的可选 canvasGuidance 参数", () => {
  it("不传第三参数 —— 与本次改动之前逐字节相同（既有调用点 trial-run-agent/quick-digital-interview 不受影响）", () => {
    const withoutArg = buildSystemPrompt("INSTR", [{ versionId: "v1", stableName: "skill-a", content: "SKILL-A" }]);
    const withUndefined = buildSystemPrompt("INSTR", [{ versionId: "v1", stableName: "skill-a", content: "SKILL-A" }], undefined);
    expect(withoutArg).toBe(withUndefined);
    expect(withoutArg).toBe(["INSTR", "SKILL-A", VISUALIZATION_GUIDANCE].join("\n\n"));
  });

  it("传 null —— 同样不注入（与不传等价）", () => {
    const withNull = buildSystemPrompt("INSTR", [], null);
    expect(withNull).toBe(["INSTR", VISUALIZATION_GUIDANCE].join("\n\n"));
  });

  it("传非空字符串 —— 追加在 VISUALIZATION_GUIDANCE 之后", () => {
    const sys = buildSystemPrompt("INSTR", [], "CANVAS-GUIDANCE-TEXT");
    expect(sys.indexOf(VISUALIZATION_GUIDANCE)).toBeLessThan(sys.indexOf("CANVAS-GUIDANCE-TEXT"));
    expect(sys.endsWith("CANVAS-GUIDANCE-TEXT")).toBe(true);
  });
});

/**
 * 2026-08-26 回归：**表头字段被数了两遍**。
 *
 * ## 是我自己的回填造成的
 *
 * 回填之前，persona 在库里的 `sections` 只有 6 个正文分区，表头字段（姓名/性别/年龄…）
 * 根本没进过契约模型——所以 `listPublished` 才去 `@repo/fabric-markdown` 单独取一份
 * `fields`。那时两份数据**不相交**，拼出来的指引是对的。
 *
 * 2026-08-26 的回填为了让表头字段**可查看可修改**（人类原话「所有的不同阶段的数据
 * 都可以查看和修改」），把它们落成了 `type: "短文本"` 的分区。于是同一批名字现在
 * 同时出现在两处：
 *
 *     - persona〔姓名/性别/…/用户描述/…〕，表头字段〔姓名/性别/…〕
 *
 * 而下面的格式说明要求：分区写 `## 姓名`，表头写 `姓名: 值`。模型会两边都写，
 * 或者选错一边——**产出结构错了，而指引本身读起来完全通顺**。
 *
 * 实测（devapp org-2e5de17f74b8731f）：persona 的 `sections` 现在是 15 条，
 * 其中 9 条 `type = 短文本`。
 *
 * ⚠ 修法**不是**把表头字段从库里拿掉——那会让它们又变回不可编辑，退回人类点名要修的
 *   那个问题。而是让注入端认得 `type`：库现在有这个事实了，正文分区只列
 *   `便利贴列表`/`长文本`，表头字段从 `短文本` 分区来，不再去 package 取第二份。
 */
describe("2026-08-26 回归：表头字段不得同时出现在分区与表头两处", () => {
  const PERSONA_LIKE: CanvasTemplateGuidanceInfo = {
    key: "persona",
    displayName: "用户画像",
    sections: [
      { name: "姓名", type: "短文本" },
      { name: "职位", type: "短文本" },
      { name: "用户描述", type: "便利贴列表" },
      { name: "痛点和挑战", type: "便利贴列表" },
    ],
  };

  it("正文分区里**没有**表头字段", () => {
    const out = buildCanvasTemplateGuidance([PERSONA_LIKE])!;
    const line = out.split("\n").find((l) => l.startsWith("- persona"))!;
    const body = line.slice(0, line.indexOf("，表头字段") >= 0 ? line.indexOf("，表头字段") : undefined);
    expect(body).toContain("用户描述");
    expect(body).toContain("痛点和挑战");
    // 反证的核心：这两个名字**只能**出现在表头那一段，不能出现在分区列表里。
    expect(body).not.toContain("姓名");
    expect(body).not.toContain("职位");
  });

  it("表头字段来自 `短文本` 分区，不再从 package 取第二份", () => {
    const out = buildCanvasTemplateGuidance([PERSONA_LIKE])!;
    expect(out).toContain("表头字段〔姓名/职位〕");
  });

  it("没有短文本分区的模板，不产出「表头字段」那一段", () => {
    const out = buildCanvasTemplateGuidance([{
      key: "swot", displayName: "SWOT",
      sections: [{ name: "优势", type: "便利贴列表" }, { name: "劣势", type: "便利贴列表" }],
    }])!;
    const line = out.split("\n").find((l) => l.startsWith("- swot"))!;
    expect(line).not.toContain("表头字段");
  });
});

/**
 * 2026-08-30 回归：**分区配的条数上限没传给模型**。
 *
 * template-admin 里把 persona 的正文分区配成「3 列 · 6 条」（`layout.cols=3` /
 * `layout.max=6`），但 `CanvasTemplateGuidanceInfo.sections` 之前只声明了
 * `name`/`type`——`layout` 虽然在 `listPublished` 透传的运行时数据里，类型却把它
 * 挡在外面看不见，`buildCanvasTemplateGuidance` 因此只能给模型一句放之四海皆准的
 * 「3~6 条」。模型写 4 条完全落在这句模糊指引的允许范围内，跟后台配置的 6 条上限
 * 对不上——人类实测复现：devapp 上生成的用户画像每个分区只有 4 条便签，不是 6 条。
 *
 * 修法：`sections` 补上 `layout.max`，配了上限的分区在指引文案里标注
 * 「(最多 N 条)」，让模型按这个精确数字写，而不是套用通用区间。
 */
describe("2026-08-30 回归：分区的条数上限（layout.max）要传给模型", () => {
  it("配了 layout.max 的分区，指引文案标注「(最多 N 条)」", () => {
    const out = buildCanvasTemplateGuidance([{
      key: "persona",
      displayName: "用户画像",
      sections: [
        { name: "用户描述", type: "便利贴列表", layout: { max: 6 } },
        { name: "目标和需求", type: "便利贴列表", layout: { max: 6 } },
      ],
    }])!;
    const line = out.split("\n").find((l) => l.startsWith("- persona"))!;
    expect(line).toContain("用户描述(最多6条)");
    expect(line).toContain("目标和需求(最多6条)");
    expect(out).toContain("是这块画布实际能放下的容量，按 N 尽量写满");
  });

  it("没有 layout（老模板/未回填）的分区，行为与改动前逐字一致——不标注、不炸", () => {
    const out = buildCanvasTemplateGuidance([{
      key: "swot", displayName: "SWOT",
      sections: [{ name: "优势", type: "便利贴列表" }, { name: "劣势", type: "便利贴列表" }],
    }])!;
    expect(out).toContain("swot〔优势/劣势〕");
  });

  it("layout 存在但没有 max（或 max 非正数）的分区，不标注", () => {
    const out = buildCanvasTemplateGuidance([{
      key: "swot", displayName: "SWOT",
      sections: [
        { name: "优势", type: "便利贴列表", layout: {} },
        { name: "劣势", type: "便利贴列表", layout: { max: 0 } },
      ],
    }])!;
    expect(out).toContain("swot〔优势/劣势〕");
  });
});

/**
 * issue #3333 回归：指引里列出的分区必须与渲染时实际会画出来的分区一致——顾问把
 * 用户旅程图从 5 阶段缩编成 4 阶段时，只把第 5 阶段的字段拖出画布（变成未放置，
 * `layout: null`），没有删除字段定义。`fence-template-resolver.ts`/
 * `template-simulate-dialog.tsx` 用 `hasPlacedSection` 判定：只要有分区放置了，
 * 未放置的分区就不参与渲染。指引必须镜像同一条判据，否则模型会老老实实把
 * 第 5 阶段的内容也写出来，前端却没有对应的框可画。
 */
describe("issue #3333 回归：未放置的分区不进指引（与渲染行为对齐）", () => {
  it("混合态（部分分区已放置、部分未放置）——指引只列已放置的分区", () => {
    const out = buildCanvasTemplateGuidance([{
      key: "journey-map",
      displayName: "用户旅程图",
      sections: [
        { name: "阶段1行为", type: "便利贴列表", layout: { max: 6 } },
        { name: "阶段2行为", type: "便利贴列表", layout: { max: 6 } },
        // 顾问缩编阶段数时留下的未放置字段：layout 为 null。
        { name: "阶段5行为", type: "便利贴列表", layout: null },
      ],
    }])!;
    const line = out.split("\n").find((l) => l.startsWith("- journey-map"))!;
    expect(line).toContain("阶段1行为");
    expect(line).toContain("阶段2行为");
    expect(line).not.toContain("阶段5行为");
  });

  it("全部未放置（老模板从没走过拖拽编辑器）——仍列出全部分区，与整体退回自动布局的渲染行为一致", () => {
    const out = buildCanvasTemplateGuidance([{
      key: "swot",
      displayName: "SWOT",
      sections: [
        { name: "优势", type: "便利贴列表", layout: null },
        { name: "劣势", type: "便利贴列表", layout: null },
      ],
    }])!;
    expect(out).toContain("swot〔优势/劣势〕");
  });

  it("表头字段（短文本）同样受未放置过滤", () => {
    const out = buildCanvasTemplateGuidance([{
      key: "persona",
      displayName: "用户画像",
      sections: [
        { name: "姓名", type: "短文本", layout: { max: 1 } },
        { name: "职业", type: "短文本", layout: null },
        { name: "用户描述", type: "便利贴列表", layout: { max: 6 } },
      ],
    }])!;
    const line = out.split("\n").find((l) => l.startsWith("- persona"))!;
    expect(line).toContain("表头字段〔姓名〕");
    expect(line).not.toContain("职业");
  });
});

/**
 * 2026-09-10 人类实测回归：**画布上凭空缺几块**。
 *
 * devapp 上让 chat 生成商业模式画布，「关键合作伙伴」「收入来源」「成本结构」三块
 * 是空的——对话里确实没聊到这三块。旧指引只说了「每个分区都必须写」，没说**用户
 * 没聊到的分区怎么办**；模型在「必须写」与「不许瞎编」之间选了跳过。
 *
 * 修法不是加一句更响的「必须写」（那句已经在了，issue #2605 加的），而是给出第三条
 * 路：基于上下文推理补全 + 末尾标 `（推理）`，让用户一眼分得清哪些是自己说过的。
 * 反证的重点在第三条 it：标记本身不能被滥用成"全都标上"或"标了就敷衍"。
 */
describe("2026-09-10 回归：没聊到的分区要推理补全并标注，而不是留空", () => {
  const BMC: CanvasTemplateGuidanceInfo = {
    key: "business-model-canvas",
    displayName: "商业模式画布",
    sections: [
      { name: "姓名", type: "短文本", layout: { max: 1 } },
      { name: "关键合作伙伴", type: "便利贴列表", layout: { max: 6 } },
      { name: "成本结构", type: "便利贴列表", layout: { max: 6 } },
    ],
  };

  it("指引明说「没聊到不是跳过的理由」，并给出推理标记", () => {
    const out = buildCanvasTemplateGuidance([BMC])!;
    expect(out).toContain("不是跳过的理由");
    expect(out).toContain(CANVAS_INFERRED_MARKER);
    expect(out).toContain("整张画布必须是填满的");
  });

  it("表头字段同样要求补全，不许整行省略", () => {
    const out = buildCanvasTemplateGuidance([BMC])!;
    expect(out).toContain("表头字段〔姓名〕");
    expect(out).toContain("对话里没提到的表头字段同样按上面那条推理补全");
    expect(out).toContain("不要整行省略");
  });

  it("标记不许滥用：用户说过的不标，推理内容也不许写占位词充数", () => {
    const out = buildCanvasTemplateGuidance([BMC])!;
    expect(out).toContain(`只有推理出来的内容才标 \`${CANVAS_INFERRED_MARKER}\``);
    expect(out).toContain("满屏都是标记等于没有标记");
    expect(out).toContain("待补充");
  });

  it("空清单仍返回 null——补全指引不改变「没模板就不注入」的既有行为", () => {
    expect(buildCanvasTemplateGuidance([])).toBeNull();
  });
});

/**
 * 2026-09-10 人类实测回归（同一轮的第二个症状）：**主语跑到了对话本身上**。
 *
 * 前半段对话聊的是一家餐馆的员工旅程图，接着让模型用 swot 模板产出画布——产出的
 * 「优势」写的是「画布严格遵循 journey-map 模板定义的表头字段与分区名」，「劣势」
 * 写的是「PESTEL 分析需将已有内容重新归类映射」。模板 key 对、分区名对、条数也够，
 * 唯独分析对象错了：画的是「我们刚才这次生成画布的协作过程」，不是那家餐馆。
 *
 * 这与上一个症状（留空）同源——都是模型没认准「这张画布在分析谁」：认不准时，
 * 要么跳过、要么退回到手边最近的素材（正在进行的这段元讨论）。所以两条指引一起加。
 */
describe("2026-09-10 回归：画布的主语是业务主题，不是这段对话本身", () => {
  const SWOT: CanvasTemplateGuidanceInfo = {
    key: "swot",
    displayName: "SWOT 分析",
    sections: [
      { name: "优势", type: "便利贴列表", layout: { max: 6 } },
      { name: "劣势", type: "便利贴列表", layout: { max: 6 } },
    ],
  };

  it("指引点名「分析对象」，并把元讨论排除在画布之外", () => {
    const out = buildCanvasTemplateGuidance([SWOT])!;
    expect(out).toContain("不是这段对话本身");
    expect(out).toContain("分析对象");
    expect(out).toContain("元讨论");
  });

  it("明说前面已产出的画布是素材，不是新画布的分析对象", () => {
    const out = buildCanvasTemplateGuidance([SWOT])!;
    expect(out).toContain("上一张画布做得怎么样");
  });
});
