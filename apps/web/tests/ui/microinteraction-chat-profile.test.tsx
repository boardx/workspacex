import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * F11（issue: [F11] chat / profile 微交互一致性稽核）—— chat/profile 域可点击元素
 * hover/focus/active 反馈稽核的反证测试。
 *
 * 静态源码扫描（同 tests/lint-design-motion-rule.test.ts 的写法）：审计发现的「完全没有
 * 反馈」元素（含缺 focus-visible 的键盘不可达焦点）逐一登记，断言修复后的源码同时含：
 *   1. hover 或选中态颜色反馈（可点击的视觉提示）
 *   2. `focus-visible:ring-2`（键盘可达的聚焦环，§5 规范写法）
 *   3. 语义动效 token（`duration-fast|base|slow`），不是裸 `duration-<数字>`
 *
 * 只验「测试能跑」不验「测试能抓到未修复的缺陷」等于没有门控——`NO_FEEDBACK_CASES`
 * 里每一条改回缺 focus-visible 的旧版本都应让对应 it() 失败（见文件末尾反证用例）。
 */

const WEB_ROOT = resolve(__dirname, "..", "..");
function read(relPath: string): string {
  return readFileSync(resolve(WEB_ROOT, relPath), "utf8");
}

/** 抓 `data-testid="<id>"` 或 `` data-testid={`<id>...`} `` 所在的那对花括号/标签内容——
 * 用简单的「从 testid 往前找最近的 `<`，往后找匹配的 `>`」做近似（足够覆盖本文件登记的
 * 单层 JSX 元素；比正则更贴近人读代码的方式，不需要引入 JSX AST 解析器）。 */
function elementSourceFor(src: string, testidToken: string): string {
  const idx = src.indexOf(testidToken);
  if (idx === -1) throw new Error(`未在源码中找到 ${JSON.stringify(testidToken)}`);
  const start = src.lastIndexOf("<", idx);
  // 找到与 start 对应的标签结束 `>`（标签内允许出现 `{...}` 表达式里的 `>`，比如
  // JSX 泛型/箭头函数；本文件登记的元素都不含这类嵌套，用第一个不在 `{}` 内的 `>` 即可）。
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`未找到 ${JSON.stringify(testidToken)} 所在标签的结束 >`);
}

type Case = { file: string; testidToken: string; label: string };

/** 审计发现的「完全没有反馈」/「缺 focus-visible」案例（F11 稽核清单，逐条修复）。*/
const NO_FEEDBACK_CASES: Case[] = [
  { file: "app/chat/live/page.tsx", testidToken: "chat-live-thread-${card.id}", label: "实时对话线程卡片" },
  { file: "components/chat/landing-panel.tsx", testidToken: "chat-landing-artifact-${art.id}", label: "落地页产物行" },
  { file: "components/chat/landing-panel.tsx", testidToken: "chat-mode-option-${spec.mode}", label: "绑定模式选择卡" },
  { file: "components/chat/copilotkit-preview-panel.tsx", testidToken: "copilotkit-preview-send", label: "CopilotKit 预览发送按钮" },
  { file: "components/chat/chat-materials-panel.tsx", testidToken: "chat-material-${item.id}", label: "材料面板条目" },
  { file: "components/chat/preset-dispatch.tsx", testidToken: "chat-preset-editor-close", label: "预设编辑器关闭按钮" },
  { file: "components/chat/preset-dispatch.tsx", testidToken: "chat-preset-editor-start-${s.name}", label: "预设编辑器起始模板选项" },
  { file: "components/chat/preset-dispatch.tsx", testidToken: "chat-preset-editor-add-skill", label: "预设编辑器添加技能按钮" },
  { file: "components/chat/thread-list-shell.tsx", testidToken: "chat-thread-${card.id}", label: "线程列表主按钮" },
  { file: "components/chat/chat-composer-pickers.tsx", testidToken: "chat-agent-select-option-${agent.id}", label: "Agent 选择下拉项" },
  { file: "components/chat/chat-composer-pickers.tsx", testidToken: "chat-mic-device-option-default", label: "麦克风设备下拉·系统默认项" },
  { file: "components/chat/chat-composer-pickers.tsx", testidToken: "chat-mic-device-option-${device.deviceId}", label: "麦克风设备下拉项" },
  { file: "components/chat/message-context-snapshot.tsx", testidToken: "context-snapshot-toggle", label: "上下文快照折叠头" },
  { file: "components/chat/message-rating.tsx", testidToken: "chat-message-rating-reason-submit", label: "消息评分理由提交按钮" },
  { file: "components/chat/chat-composer-attachments.tsx", testidToken: "chat-message-attachment-${att.id}", label: "消息附件预览行" },
  { file: "components/chat/chat-left-panel.tsx", testidToken: "chat-thread-${t.id}", label: "左栏线程链接" },
  { file: "components/profile/profile-screen.tsx", testidToken: "profile-brain-entry", label: "个人资料页 Brain 入口卡片" },
  // issue #2457（DA-19h 旧轨道退役）：`chat-live-message-panel.tsx` 已删除，同一个
  // testid（`chat-attachment-mention-*` 语义相同不另造锚点，见 `copilotkit-v2-panel-body.tsx`
  // 该处头注）平移到了 v2 的 `copilotkit-v2-panel-body.tsx`。
  { file: "components/chat/copilotkit-v2-panel-body.tsx", testidToken: "chat-attachment-mention-option-${att.id}", label: "附件提及下拉项" },
];

describe("F11 chat/profile 微交互一致性 —— 「完全没反馈」元素修复", () => {
  for (const c of NO_FEEDBACK_CASES) {
    describe(`${c.label}（${c.file} :: ${c.testidToken}）`, () => {
      const src = read(c.file);
      const el = elementSourceFor(src, c.testidToken);

      it("有 hover 或选中态的视觉反馈", () => {
        expect(el, el).toMatch(/hover:|group-hover:/);
      });

      it("键盘可达：focus-visible:ring-2（§5 规范写法，不是完全没有焦点环）", () => {
        expect(el, el).toMatch(/focus-visible:ring-2/);
      });

      it("过渡时长使用语义 token（duration-fast|base|slow），不是裸 duration-<数字>", () => {
        expect(el, el).not.toMatch(/\bduration-\d+\b/);
        if (/\btransition-/.test(el)) {
          expect(el, el).toMatch(/\bduration-(fast|base|slow)\b/);
        }
      });
    });
  }
});

describe("F11 —— 反证：检测逻辑本身能抓到「缺 focus-visible」（不是空转的门控）", () => {
  it("对一个故意缺 focus-visible 的按钮标记失败", () => {
    const fixtureSrc = `<button data-testid="demo-no-focus" className="hover:bg-muted transition-colors duration-base">x</button>`;
    const el = elementSourceFor(fixtureSrc, "demo-no-focus");
    expect(/focus-visible:ring-2/.test(el)).toBe(false);
  });

  it("对一个故意用裸 duration-200 的按钮标记失败", () => {
    const fixtureSrc = `<button data-testid="demo-raw-duration" className="hover:bg-muted transition-colors duration-200 focus-visible:ring-2">x</button>`;
    const el = elementSourceFor(fixtureSrc, "demo-raw-duration");
    expect(/\bduration-\d+\b/.test(el)).toBe(true);
  });
});
