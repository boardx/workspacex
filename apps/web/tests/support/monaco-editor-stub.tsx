import * as React from "react";
import { vi } from "vitest";

/**
 * #1884：单元测试里的 Monaco 替身。
 *
 * 真实 Monaco 需要浏览器的 canvas / web worker / `ResizeObserver`，jsdom 测试环境
 * 模拟不了，也不该为了「渲染出一个真实编辑器」去追加一整套浏览器 API polyfill——
 * 那样测的是 jsdom 补丁全不全，不是本仓的业务逻辑。这个替身只接管 Monaco 本体
 * 「怎么把内容画出来 / 怎么把 markers 渲成红色波浪线」这两件事，其余全部忠实转发：
 *
 * ① 用一个受控 `<textarea>` 承载 `value`/`onChange`，保留既有测试
 *    （`fireEvent.change` + `.value` 断言）的写法不用大改；
 * ② 暴露 `monacoEditorStub.setModelMarkers`（`vi.fn()`）——`AssetCodeEditor` 的
 *    诊断计算（`frontmatterIssuesToMarkers` + `@repo/contracts` 的
 *    `validateRootFrontmatter`）是真代码、真跑，这里只替身掉「Monaco 怎么消费
 *    markers」这一半，用测试断言它被调用时带的是什么。
 *
 * 用法：`vi.mock("@monaco-editor/react", () => import("@/tests/support/monaco-editor-stub"))`。
 */
export const monacoEditorStub = {
  setModelMarkers: vi.fn(),
};

export const loader = { config: vi.fn() };

export default function MockMonacoEditor({
  value,
  language,
  onChange,
  onMount,
  options,
}: {
  value?: string;
  language?: string;
  onChange?: (v: string | undefined) => void;
  onMount?: (editor: unknown, monaco: unknown) => void;
  options?: { readOnly?: boolean };
}) {
  const mountedRef = React.useRef(false);
  const fakeMonaco = React.useMemo(
    () => ({
      MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
      editor: { setModelMarkers: monacoEditorStub.setModelMarkers },
    }),
    [],
  );
  const fakeEditor = React.useMemo(() => ({ getModel: () => ({}) }), []);
  React.useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      onMount?.(fakeEditor, fakeMonaco);
    }
  }, [fakeEditor, fakeMonaco, onMount]);
  return (
    <textarea
      data-testid="monaco-mock-editor"
      data-language={language}
      readOnly={options?.readOnly}
      value={value ?? ""}
      onChange={(e) => onChange?.(e.target.value)}
    />
  );
}
