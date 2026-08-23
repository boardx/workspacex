"use client";

/**
 * `AssetCodeEditor` —— #1884：把 `AgSkillEditor`/`AgAgentEditor`（`ag-screens.tsx`）
 * 编辑区原本的原生 `<textarea>` 换成真正的代码编辑器（Monaco）。
 *
 * ## 为什么是 `@monaco-editor/react` + 本地 `min/vs`，不是 CDN
 *
 * `@monaco-editor/react` 默认从 jsdelivr CDN 拉 `vs/loader.js`——本仓门控与真栈 e2e
 * 常跑在隔离/离线环境里，CDN 不可达就等于编辑器整体加载失败。`next.config.mjs`
 * 在每次 `next dev`/`next build` 启动时把 `node_modules/monaco-editor/min/vs`
 * （官方发布的 AMD 部署产物）复制到 `public/monaco-editor/vs`，本文件用
 * `loader.config({ paths: { vs: ... } })` 指过去——与仓库既有的 `mermaid`/`fabric`
 * 一样，是被静态打包/托管的依赖，不对外发起脚本请求。
 *
 * ## 为什么用 `next/dynamic({ ssr: false })`
 *
 * Monaco 直接摸 `window`/`navigator`（AMD loader、worker 注册），在 Next 的 SSR
 * 渲染阶段执行会直接抛错。`ssr: false` 把整个组件的首次渲染推到浏览器端。
 *
 * ## 内联校验做了什么、没做什么
 *
 * ① **JSON/JS/TS**：Monaco 内置语言服务自带语法诊断（`jsonDefaults`/
 *    `typescriptDefaults` 默认 `validate`/`noSyntaxValidation` 就是开的），
 *    只要 `language` 设对，红色波浪线是**开箱即有**的，本文件不需要为它们
 *    额外写检测逻辑。
 * ② **SKILL.md / AGENT.md 根文件 frontmatter**：复用 `@repo/contracts/asset-governance`
 *    的 `validateRootFrontmatter`（服务端 `WriteAssetFile` 用的**同一份**规则，
 *    见该文件头注——单一事实源，不新开第二套判断），通过 `setModelMarkers`
 *    接成自定义诊断源（owner `"skill-frontmatter"`）。
 * ③ **YAML/Markdown/Python/Shell**：Monaco 只提供语法高亮（monarch tokenizer），
 *    没有内置语言服务/校验器（不像 JSON/TS 那样自带 worker）——这是 Monaco 本身
 *    的能力边界，不是本文件遗漏；接 YAML 校验需要额外的 `monaco-yaml` 包与
 *    schema，超出「至少做基础语法错误检测」这一档的量级，留给后续 issue。
 */
import * as React from "react";
import dynamic from "next/dynamic";
import { loader, type Monaco, type OnMount } from "@monaco-editor/react";
import {
  isRootFrontmatterAssetKind,
  validateRootFrontmatter,
  type FrontmatterIssue,
  type RootFrontmatterAssetKind,
} from "@repo/contracts/asset-governance";

loader.config({ paths: { vs: "/monaco-editor/vs" } });

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-[320px] w-full place-items-center rounded-lg border border-border bg-card text-11 text-muted-foreground">
      编辑器加载中…
    </div>
  ),
});

const EXTENSION_LANGUAGE: Readonly<Record<string, string>> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  md: "markdown",
  json: "json",
  jsonl: "json",
  yaml: "yaml",
  yml: "yaml",
  sh: "shell",
  csv: "plaintext",
};

/** 按文件扩展名派生 Monaco `language` id，未知扩展名回退纯文本（不是报错）。 */
export function monacoLanguageFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "plaintext";
  return EXTENSION_LANGUAGE[base.slice(dot + 1).toLowerCase()] ?? "plaintext";
}

const FRONTMATTER_MARKER_OWNER = "skill-frontmatter";
const FRONTMATTER_LINE_REF = /第 (\d+) 行/;

/**
 * `FrontmatterIssue` → Monaco `IMarkerData`。`validateRootFrontmatter` 本身不带行号
 * （它是纯文本规则校验，不是逐行 parser 的产物），这里按问题类型补一个尽量准确的落点：
 * · `unparsable` 且 detail 里带「第 N 行」（坏 `key: value` 语法）——落到那一行；
 * · 其余 `unparsable`（开头/结尾分隔符缺失）——落到第 1 行（frontmatter 该开始的地方）；
 * · `required`（字段缺失）——同样落到第 1 行：字段不存在，没有「它在哪一行」这个概念，
 *   落在块的起点比落在文件末尾更符合「点开文件先看见」的直觉。
 */
function frontmatterIssuesToMarkers(
  issues: readonly FrontmatterIssue[],
  monaco: Monaco,
): import("monaco-editor").editor.IMarkerData[] {
  return issues.map((issue) => {
    const lineMatch = FRONTMATTER_LINE_REF.exec(issue.detail);
    const line = lineMatch ? Number(lineMatch[1]) : 1;
    return {
      severity: monaco.MarkerSeverity.Error,
      message: `[${issue.field}] ${issue.detail}`,
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: 1_000, // 整行标红，不去精确计算列范围——frontmatter 是 key: value 单行结构
    };
  });
}

export interface AssetCodeEditorProps {
  path: string;
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
  /** 传了才做 frontmatter 内联校验——只有「当前文件是根文件」时才有意义。 */
  rootFrontmatterCheck?: { assetKind: RootFrontmatterAssetKind; isRootFile: boolean };
  testid?: string;
}

export function AssetCodeEditor({
  path,
  value,
  onChange,
  readOnly = false,
  rootFrontmatterCheck,
  testid,
}: AssetCodeEditorProps) {
  const language = monacoLanguageFromPath(path);
  const monacoRef = React.useRef<Monaco | null>(null);
  const editorRef = React.useRef<Parameters<OnMount>[0] | null>(null);

  const applyFrontmatterMarkers = React.useCallback(
    (currentValue: string) => {
      const monaco = monacoRef.current;
      const editor = editorRef.current;
      if (monaco === null || editor === null) return;
      const model = editor.getModel();
      if (model === null) return;
      const shouldCheck =
        rootFrontmatterCheck !== undefined &&
        rootFrontmatterCheck.isRootFile &&
        isRootFrontmatterAssetKind(rootFrontmatterCheck.assetKind);
      const markers = shouldCheck
        ? frontmatterIssuesToMarkers(
            validateRootFrontmatter(rootFrontmatterCheck.assetKind, currentValue),
            monaco,
          )
        : [];
      monaco.editor.setModelMarkers(model, FRONTMATTER_MARKER_OWNER, markers);
    },
    [rootFrontmatterCheck],
  );

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    applyFrontmatterMarkers(value);
  };

  // 文件切换（`path` 变化，新一份 `value` 从服务端读回）或内容变化时都要重新跑一遍——
  // 只在 `onChange` 里跑会漏掉「切换文件后首次挂载」那一次。
  React.useEffect(() => {
    applyFrontmatterMarkers(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, value, applyFrontmatterMarkers]);

  return (
    <div data-testid={testid} className="overflow-hidden rounded-lg border border-border">
      <MonacoEditor
        height="320px"
        language={language}
        value={value}
        theme="vs"
        onMount={handleMount}
        onChange={(next) => {
          const v = next ?? "";
          onChange(v);
          applyFrontmatterMarkers(v);
        }}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 12,
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: "on",
        }}
      />
    </div>
  );
}
