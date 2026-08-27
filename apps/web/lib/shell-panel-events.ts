/**
 * issue D4（chat-main-fidelity-rubric.md）—— 右侧栏折叠开关此前只活在
 * `app-shell.tsx` 自己的组件树里（`shell-right-collapse` 按钮），业务屏（如
 * `chat-read-screen.tsx` 的线程头部）拿不到触发它的办法，只能放一个 `disabled`
 * 的「侧栏」按钮（见 `components/chat/chat-main.tsx` 原型里的解释）。
 *
 * 这里不用 React Context——`AppShell` 在多处测试里被整体 mock 掉
 * （如 `tests/ui/chat-read-screen.test.tsx`），Context Provider 一旦被 mock 替换，
 * 消费端拿到的就是默认值/`null`，业务屏的单测反而要跟着重新实现一遍 mock 的内部状态。
 * 改用 `window` 自定义事件：业务屏发一个「请求切换」事件，真正持有折叠状态的
 * `AppShell` 监听并执行——两边不必共享同一棵 React 树，单测只需断言事件被发出
 * （或干脆不 mock，让真实 `AppShell` 接住），端到端场景里两者天然连通。
 *
 * 与 `shell.rightCollapsed` 的 localStorage key 是同一件事的两个视角：
 * localStorage 是"记忆"，这个事件是"触发点"，单一状态仍然只活在 `AppShell` 里。
 */
export const SHELL_RIGHT_PANEL_TOGGLE_EVENT = "shell:right-panel-toggle-request";

export function requestShellRightPanelToggle(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SHELL_RIGHT_PANEL_TOGGLE_EVENT));
}
