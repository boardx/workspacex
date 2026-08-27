/**
 * agent-interrupts 契约束——三个用例值对象的类型单一事实源投影（ADR-020）。
 *
 * ⚠ 为什么单独开这个文件，不直接从 `lib/mock/agent-interrupts.ts` 取类型：
 * `copilotkit-v2-agent-interrupts.tsx`（真实 chat 渲染树的接线点）与三张卡片组件
 * 一度 `import type {...} from "@/lib/mock/agent-interrupts"`——类型导入在编译期会被
 * tree-shake 掉，运行时没有任何 mock 数据真的被打包，但 `chat-dead-mock-cluster.test.ts`
 * （#462）按**静态 import 边**判定，不区分 `import type` 与值导入，一旦这条边出现在
 * `app/chat/page.tsx` 的闭包里就判「死 mock 簇」红——这条门控本身是对的（防止真的
 * 值导入哪天悄悄溜进来），需要改的是让类型定义不再挂在 mock 文件下面。
 *
 * 契约的单一事实源仍是 `packages/contracts/src/agent-interrupts.ts`（F212，签核③）；
 * 本文件只是把「从契约取类型」这件事从 mock 模块里搬出来，`kind`/`options` 两个
 * 预览渲染扩展字段现在也是真实表单控件渲染要用的字段，不再是 mock 专属。
 */
import type * as AgentInterrupts from "@repo/contracts/agent-interrupts";

export type ConfirmIntentArgs = AgentInterrupts.ConfirmIntentArgs;

/** ⚠ 用 `import("@repo/contracts/agent-interrupts")` 内联类型引用（而不是顶部已导入的
 * `AgentInterrupts` 命名空间别名），是为了让 `lint-contract-source.mjs` 的
 * 单一事实源正则能在这一行**扫描到**契约引用——它按「首个分号前的文本」截取右值，
 * 命名空间别名 + 交叉类型会让契约引用落在被截断的那一段之外，误判成手写第二份。 */
export type ParamField = import("@repo/contracts/agent-interrupts").ParamField & {
  readonly kind: "text" | "select" | "boolean",
  readonly options?: readonly { value: string, label: string }[],
};

export type OptionCard = AgentInterrupts.OptionCard;
