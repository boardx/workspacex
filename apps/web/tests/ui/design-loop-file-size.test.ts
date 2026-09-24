/**
 * 深度评测 S1（#3988）——设计工作台组件的规模线。
 *
 * 仓库的硬上限是 2000 行（AGENTS.md「文件规模」）。详情页 `detail-screen.tsx` 在 R10 收尾时是 1888 行，
 * 而接下来几轮（批注讨论、查看代码、演示、真实图片）都要往它上面加功能——等撞上 2000 再拆，
 * 就是在超限的文件里硬塞。所以这里把线划在 1500：留出余量，逼着新功能按职责进自己的文件
 * （S1 拆出了 detail-parts / detail-chat-log / detail-canvas-toolbar / detail-side-panel）。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "..", "..", "components", "design-loop");
const LIMIT = 1500;

describe("设计工作台组件规模线", () => {
  it(`components/design-loop 下没有超过 ${LIMIT} 行的组件文件`, () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(10);
    const over = files
      .map((f) => [f, readFileSync(join(DIR, f), "utf8").split("\n").length] as const)
      .filter(([, n]) => n > LIMIT);
    expect(over).toEqual([]);
  });
});
