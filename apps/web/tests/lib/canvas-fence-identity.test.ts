/**
 * **围栏级身份**（issue #3252）的纯函数判据。
 *
 * 缺陷形状：身份粒度是**模板名**，所以同一条消息里两个同模板围栏互相认领对方的
 * 保存版。这里钉死修法的三条性质，组件级反证在
 * `tests/ui/chat-canvas-fence-identity-readback.test.tsx`。
 *
 * ⚠ 第二组（「身份不是顺序」）是 issue 交付要求逐字点名的禁令：重排/增删/流式重放
 *   都会让「第几个」变化，用顺序当身份等于引入一个更隐蔽的错配。
 */
import { describe, expect, it } from "vitest";
import {
  acceptsSavedCanvasSource,
  canvasFenceIdentity,
  readCanvasFenceIdentity,
  tagCanvasArtifactTitle,
} from "@/lib/canvas/canvas-fence-identity";

const fence = (suffix: string) =>
  ["模板: persona", `姓名: 林可${suffix}`, "## 用户描述", `- 项目型采购${suffix}`].join("\n");

const FENCE_A = fence("之一");
const FENCE_B = fence("之二");

describe("围栏身份：同模板的两个围栏必须分得开（#3252 的正面）", () => {
  it("同模板但内容不同的两个围栏，身份不同", () => {
    const a = canvasFenceIdentity(FENCE_A, "canvas");
    const b = canvasFenceIdentity(FENCE_B, "canvas");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    // 这一条就是缺陷本身：按模板名判，两者都是 "persona"，分不开。
    expect(a).not.toBe(b);
  });

  it("同一段围栏原文重复算，身份逐字相同（读回要跨刷新成立）", () => {
    expect(canvasFenceIdentity(FENCE_A, "canvas")).toBe(canvasFenceIdentity(FENCE_A, "canvas"));
  });

  it("围栏语言参与身份：同样的正文在 canvas / persona 两种围栏下不是同一个围栏", () => {
    const body = ["姓名: 林可", "## 动机", "- 少加班"].join("\n");
    expect(canvasFenceIdentity(body, "persona")).not.toBe(canvasFenceIdentity(body, "canvas"));
  });

  it("不是合法围栏 ⇒ 没有身份（连「是不是画布」都不成立的东西不该去认领保存版）", () => {
    expect(canvasFenceIdentity("模板: persona", "canvas")).toBeNull();   // 没有任何 ## 分区
    expect(canvasFenceIdentity("## 用户描述\n- 甲", "canvas")).toBeNull(); // 没有模板 key
  });
});

describe("身份**不是**顺序：重排 / 增删 / 流式重放都不改变它（issue 交付要求的禁令）", () => {
  it("两个围栏交换先后，各自身份不变", () => {
    const before = [FENCE_A, FENCE_B].map((c) => canvasFenceIdentity(c, "canvas"));
    const after = [FENCE_B, FENCE_A].map((c) => canvasFenceIdentity(c, "canvas"));
    expect(after).toEqual([before[1], before[0]]);
  });

  it("在两者之间插入第三个围栏，前两个的身份不变", () => {
    const a = canvasFenceIdentity(FENCE_A, "canvas");
    const b = canvasFenceIdentity(FENCE_B, "canvas");
    const list = [FENCE_A, fence("之三"), FENCE_B].map((c) => canvasFenceIdentity(c, "canvas"));
    expect(list[0]).toBe(a);
    expect(list[2]).toBe(b);
  });

  it("行尾空白 / 首尾空行这类排版差异不改变身份（流式重放的保险）", () => {
    expect(canvasFenceIdentity(`\n${FENCE_A.replace(/\n/g, "  \n")}\n\n`, "canvas"))
      .toBe(canvasFenceIdentity(FENCE_A, "canvas"));
  });
});

describe("身份随落地标题走（`chat_artifact_landings` 没有围栏列，只有 title 可用）", () => {
  it("写进去能原样读回来", () => {
    const id = canvasFenceIdentity(FENCE_A, "canvas")!;
    const title = tagCanvasArtifactTitle("工作坊画布 · 2026/9/21 10:00:00", id);
    expect(title.startsWith("工作坊画布 · 2026/9/21 10:00:00")).toBe(true);
    expect(readCanvasFenceIdentity(title)).toBe(id);
  });

  it("没有身份（本地演示 / 围栏不合法）⇒ 标题一个字不加", () => {
    expect(tagCanvasArtifactTitle("工作坊画布 · x", null)).toBe("工作坊画布 · x");
  });

  it("旧存量标题读不出身份，而不是读出一个看似合理的值", () => {
    expect(readCanvasFenceIdentity("工作坊画布 · 2026/9/1 10:00:00")).toBeNull();
    expect(readCanvasFenceIdentity("落地为产物（草稿）")).toBeNull();
  });
});

describe("归属判据 `acceptsSavedCanvasSource`", () => {
  const A = canvasFenceIdentity(FENCE_A, "canvas")!;
  const B = canvasFenceIdentity(FENCE_B, "canvas")!;
  const base = { templateKey: "persona", savedTemplateKey: "persona", templateKeyAmbiguous: true };

  it("带身份的保存版只被它自己的围栏认领——**这就是 #3252 的直接反证**", () => {
    const savedTitle = tagCanvasArtifactTitle("工作坊画布 · x", A);
    expect(acceptsSavedCanvasSource({ ...base, fenceIdentity: A, savedTitle })).toBe(true);
    // 修复前：两者模板 key 同为 persona ⇒ 这里是 true，第二个围栏认领了第一个的保存版。
    expect(acceptsSavedCanvasSource({ ...base, fenceIdentity: B, savedTitle })).toBe(false);
  });

  it("模板不同一律判否（旧判据保留为必要条件，不是充分条件）", () => {
    expect(acceptsSavedCanvasSource({
      ...base, fenceIdentity: A, savedTemplateKey: "journey-map",
      savedTitle: tagCanvasArtifactTitle("工作坊画布 · x", A),
    })).toBe(false);
  });

  it("保存版本身不是合法围栏（整条消息正文落成的草稿等）⇒ 判否", () => {
    expect(acceptsSavedCanvasSource({
      ...base, fenceIdentity: A, savedTemplateKey: null, savedTitle: "落地为产物（草稿）",
    })).toBe(false);
  });

  it("本围栏不合法 ⇒ 不认领任何东西", () => {
    expect(acceptsSavedCanvasSource({
      ...base, fenceIdentity: null, templateKey: null,
      savedTitle: tagCanvasArtifactTitle("工作坊画布 · x", A),
    })).toBe(false);
  });

  describe("旧存量（标题里没有身份后缀）", () => {
    const legacyTitle = "工作坊画布 · 2026/9/1 10:00:00";

    it("本消息只有这一个同模板围栏 ⇒ 照旧认领（修复不能让老用户的保存版读不回来）", () => {
      expect(acceptsSavedCanvasSource({
        ...base, fenceIdentity: A, savedTitle: legacyTitle, templateKeyAmbiguous: false,
      })).toBe(true);
    });

    it("本消息有两个同模板围栏 ⇒ 归属无从判断，两个都判否（诚实降级，不猜）", () => {
      for (const fenceIdentity of [A, B]) {
        expect(acceptsSavedCanvasSource({
          ...base, fenceIdentity, savedTitle: legacyTitle, templateKeyAmbiguous: true,
        })).toBe(false);
      }
    });
  });
});

describe("给人看的标题不带内部关联键", () => {
  it("去掉身份后缀，非画布产物标题原样返回", async () => {
    const { stripCanvasFenceIdentity } = await import("@/lib/canvas/canvas-fence-identity");
    const id = canvasFenceIdentity(FENCE_A, "canvas")!;
    expect(stripCanvasFenceIdentity(tagCanvasArtifactTitle("工作坊画布 · 2026/9/21 10:00:00", id)))
      .toBe("工作坊画布 · 2026/9/21 10:00:00");
    expect(stripCanvasFenceIdentity("落地为产物（草稿）")).toBe("落地为产物（草稿）");
  });
});
