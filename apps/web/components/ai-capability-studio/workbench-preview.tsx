"use client";
import { useEffect, useReducer, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Bot, Check, ChevronRight, FileCode2, Files, GitBranch, History, Play, Plus, Puzzle, Settings2, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { StateShell, StatePreviewSwitcher } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { initialStudioPreview, studioReducer, trialIsCurrent, validPreviewPath, StudioPreviewSchema, STUDIO_PREVIEW_SESSION_KEY } from "./preview-model";

import { runFailureFixture } from "./run-failure-preview";

type Panel = "files" | "tests" | "versions" | "upstream" | "activity";
type Modal = "import" | "create" | "rename" | "delete" | "ai" | "publish" | "model" | "mcp" | "agent" | "rollback" | "leave" | null;
const sections = [
  { key: "files", label: "文件与说明", icon: Files },
  { key: "tests", label: "测试与结果", icon: Play },
  { key: "versions", label: "发布版本", icon: History },
  { key: "upstream", label: "来源与更新", icon: GitBranch },
  { key: "activity", label: "开发记录", icon: ShieldCheck },
] as const;

export function CapabilityStudioPreview({ state, fromRun }: { state: UiState; fromRun?: string }) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState("");
  const [studio, dispatch] = useReducer(studioReducer, undefined, initialStudioPreview);
  useEffect(() => {
    if (!studio.dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [studio.dirty]);
  const [panel, setPanel] = useState<Panel>("files");
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState("工作草稿已就绪，当前 Agent 仍使用 v1。");
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STUDIO_PREVIEW_SESSION_KEY);
      if (raw) {
        const parsed = StudioPreviewSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          dispatch({ type: "restore", state: parsed.data });
          setNotice(parsed.data.dirty ? "已恢复此浏览器会话的未保存演示草稿。" : "已恢复此浏览器会话的演示进度。");
        }
      }
    } catch { /* Storage may be unavailable or an older preview may be incompatible. */ }
    setRecovered(true);
  }, []);
  useEffect(() => {
    if (!recovered) return;
    try { sessionStorage.setItem(STUDIO_PREVIEW_SESSION_KEY, JSON.stringify(studio)); }
    catch { /* The preview stays usable in memory when browser storage is unavailable. */ }
  }, [studio, recovered]);
  const [path, setPath] = useState("");
  const [source, setSource] = useState("https://github.com/example/research-brief");
  const importedSource = studio.importedSource;
  const [previewReady, setPreviewReady] = useState(false);
  const [formError, setFormError] = useState("");
  const testInput = studio.testInput;
  const [bindingTarget, setBindingTarget] = useState<number | null>(null);
  const [chatResult, setChatResult] = useState(false);
  const currentFile = studio.files.find(file => file.path === studio.selected)!;
  const release = studio.releases.at(-1)!;
  const canPublish = trialIsCurrent(studio) && release.revision !== studio.revision;
  const open = (kind: Modal, target?: number) => { setFormError(""); if (kind === "agent") setBindingTarget(target ?? release.number); setModal(kind); };
  const saved = () => { dispatch({ type: "save" }); setNotice("已保存工作草稿。已发布版本与 Agent 绑定保持不变。"); };
  const runTrial = (passed: boolean) => {
    dispatch({ type: "trial", passed, sampleInput: testInput }); setPanel("tests");
    setNotice(passed ? "演示测试通过，结果已关联当前草稿和依赖。" : "演示测试失败：缺少来源引用。可返回文件修复后重新测试。");
  };
  const pathAction = () => {
    if (!validPreviewPath(path) || studio.files.some(file => file.path === path)) { setFormError("请输入未占用的相对路径，例如 scripts/check.py；不能包含 ..。"); return; }
    dispatch({ type: modal === "rename" ? "rename" : "create", path }); setModal(null); setNotice("文件变更尚未保存到草稿。");
  };
  const closeWith = (action: () => void, message: string) => { action(); setNotice(message); setModal(null); };
  const fieldClass = "text-12 text-muted-foreground";

  return <main className="min-h-screen bg-background text-background-foreground" data-testid="studio-preview" onClickCapture={event => {
    if (!studio.dirty || !(event.target instanceof Element)) return;
    const href = event.target.closest("a")?.getAttribute("href");
    if (!href) return;
    event.preventDefault(); event.stopPropagation(); setPendingHref(href); open("leave");
  }}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-panel px-6 py-3">
      <div className="flex items-center gap-2 text-12"><Puzzle className="h-4 w-4 text-primary" aria-hidden /><strong>能力开发工作台</strong><span className="text-muted-foreground">交互原型 · 仅演示数据，不连接服务</span></div>
      <div className="flex flex-wrap items-center gap-3"><Link href="/preview/ai-capability-studio/import" className="text-12 text-primary underline" data-testid="studio-full-import">完整导入向导示例</Link><Link href="/preview/ai-capability-studio/governance" className="text-12 text-primary underline" data-testid="studio-governance-link">Model / MCP 依赖修复示例</Link><Link href="/preview/ai-capability-studio/source" className="text-12 text-primary underline" data-testid="studio-source-link">来源绑定修复示例</Link><StatePreviewSwitcher current={state} /></div>
    </div>
    {fromRun && <aside className="mx-4 my-3 rounded-control border border-border bg-card p-3 text-12" data-testid="studio-origin-run">{fromRun === runFailureFixture.runId ? <>历史定位（演示）：{runFailureFixture.runId} · Agent {runFailureFixture.agentVersionId} · Skill {runFailureFixture.skillVersionIds.join("、")}。仅保留定位，不自动覆盖当前草稿或重放运行；历史开发副本需服务端另行创建。</> : "来源运行不可访问或不存在；当前草稿保持原样。"}</aside>}
    <StateShell state={state} emptyHint="从 GitHub 导入一个方案，或创建你的第一个 Skill。" onCreate={() => open("import")}
      errors={{ source: "来源无法识别，请检查仓库或目录地址。" }} depFailure={{ what: "示例模型连接中断，重新连接后可继续测试。", retry: () => open("model") }}
      denial={{ layer: "organization", reason: "需要此组织的能力开发权限，请联系组织管理员。" }} successMessage="工作草稿已保存；发布需要单独确认。">
      <div className="mx-auto flex max-w-screen-2xl flex-col lg:flex-row">
        <aside className="border-b border-border bg-panel p-4 lg:min-h-screen lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="mb-7 px-2"><p className="text-10 uppercase tracking-widest text-muted-foreground">Workspace / 能力库</p><h1 className="mt-2 text-18 font-semibold">研究简报</h1><p className="mt-1 text-12 text-muted-foreground">团队知识与研究</p></div>
          <nav aria-label="Skill 开发导航" className="flex flex-wrap gap-1 lg:flex-col">{sections.map(({ key, label, icon: Icon }) => <Button key={key} variant={panel === key ? "secondary" : "ghost"} className="justify-start" data-testid={`studio-nav-${key}`} onClick={() => setPanel(key)} aria-current={panel === key ? "page" : undefined}><Icon className="h-4 w-4" aria-hidden />{label}</Button>)}</nav>
          <div className="mt-8 border-t border-border pt-4"><p className="mb-2 px-2 text-10 text-muted-foreground">运行依赖</p>
            <Button variant="ghost" className="w-full justify-start" data-testid="studio-open-agent" onClick={() => open("agent")}><Bot className="h-4 w-4" aria-hidden />研究助手<ArrowUpRight className="ml-auto h-3 w-3" aria-hidden /></Button>
            <Button variant="ghost" className="w-full justify-start" data-testid="studio-open-model" onClick={() => open("model")}><Settings2 className="h-4 w-4" aria-hidden />Model 配置</Button>
            <Button variant="ghost" className="w-full justify-start" data-testid="studio-open-mcp" onClick={() => open("mcp")}><Puzzle className="h-4 w-4" aria-hidden />MCP 工具</Button>
          </div>
          <div className="mt-8 rounded-container border border-border bg-card p-3 text-12"><p className="font-medium">已有开源方案？</p><p className="mt-1 text-muted-foreground">保留来源，在工作草稿上继续开发。</p><Button variant="outline" size="sm" className="mt-3 w-full" data-testid="studio-import" onClick={() => { setPreviewReady(false); open("import"); }}><Upload className="h-3 w-3" aria-hidden />导入方案</Button></div>
        </aside>
        <section className="min-w-0 flex-1 p-5 lg:p-7">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><p className="mb-2 flex items-center gap-1 text-12 text-muted-foreground">Skills<ChevronRight className="h-3 w-3" aria-hidden />research-brief</p><h2 className="text-24 font-semibold tracking-tight">把想法改成可用的能力</h2><p className="mt-2 text-13 text-muted-foreground">编辑、验证，再发布给你的 Agent。</p></div><Button variant="outline" data-testid="studio-ai-open" onClick={() => open("ai")}><Sparkles className="h-4 w-4" aria-hidden />用 AI 修改</Button></div>
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-control border border-border bg-card px-3 py-2 text-12" data-testid="studio-version-status"><span className="font-medium">工作草稿 r{studio.revision}</span><span className={studio.dirty ? "text-warning" : "text-success"}>{studio.dirty ? "有未保存修改" : "已保存"}</span><span className="text-muted-foreground">已发布 v{release.number} · Agent 固定 v{studio.boundRelease}</span></div>
          <div role="status" aria-live="polite" className="mb-4 text-12 text-muted-foreground" data-testid="studio-notice">{notice}</div>
          {panel === "files" && <div className="overflow-hidden rounded-container border border-border bg-card" data-testid="studio-files-panel">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"><span className="text-13 font-medium">文件 · {studio.files.length}</span><div className="flex gap-2"><Button size="sm" variant="ghost" data-testid="studio-create-file" onClick={() => { setPath(""); open("create"); }}><Plus className="h-3 w-3" aria-hidden />新建文件</Button><Button size="sm" variant="primary" disabled={!studio.dirty} data-testid="studio-save" onClick={saved}>保存草稿</Button></div></div>
            <div className="flex flex-col md:flex-row"><nav aria-label="文件列表" className="border-b border-border bg-panel p-2 md:w-48 md:shrink-0 md:border-b-0 md:border-r">{studio.files.map(file => <Button key={file.path} variant={file.path === studio.selected ? "secondary" : "ghost"} className="w-full justify-start overflow-hidden text-left" data-testid={`studio-file-${file.path}`} onClick={() => dispatch({ type: "select", path: file.path })}><FileCode2 className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{file.path}</span></Button>)}</nav>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2"><span className="text-12 font-mono">{studio.selected}</span><div className="flex gap-1"><Button size="xs" variant="ghost" disabled={studio.selected === "SKILL.md"} data-testid="studio-rename-file" onClick={() => { setPath(studio.selected); open("rename"); }}>重命名</Button><Button size="xs" variant="ghost" disabled={studio.selected === "SKILL.md"} data-testid="studio-delete-file" onClick={() => open("delete")}>删除</Button></div></div>
                <Textarea aria-label="文件内容" spellCheck={false} className="min-h-96 rounded-none border-0 bg-card p-4 font-mono text-13 leading-relaxed" data-testid="studio-file-content" value={currentFile.content} onChange={e => dispatch({ type: "edit", content: e.target.value })} />
              </div></div>
          </div>}
          {panel === "tests" && <section className="space-y-4 rounded-container border border-border bg-card p-5" data-testid="studio-tests-panel"><h3 className="text-16 font-semibold">测试当前工作草稿</h3><label className="block text-12" htmlFor="studio-test-input">测试任务</label><Textarea id="studio-test-input" data-testid="studio-test-input" value={testInput} onChange={e => dispatch({ type: "test-input", value: e.target.value })} /><p className={fieldClass}>测试冻结草稿 r{studio.revision} 与依赖配置；不会创建发布版本。</p><div className="flex gap-2"><Button variant="primary" data-testid="studio-run-pass" disabled={studio.dirty || !studio.modelEnabled || !studio.toolGranted || !testInput.trim()} onClick={() => runTrial(true)}><Play className="h-3 w-3" aria-hidden />运行演示测试</Button><Button variant="outline" data-testid="studio-run-fail" disabled={studio.dirty || !studio.modelEnabled || !studio.toolGranted || !testInput.trim()} onClick={() => runTrial(false)}>演示失败结果</Button></div>
            {studio.trial && <div className="rounded-control border border-border p-4" data-testid="studio-trial-result"><p className={studio.trial.passed ? "text-success" : "text-destructive"}>{studio.trial.passed ? "演示检查通过：标题、来源、产物" : "演示检查失败：第 2 条结论缺少来源"}</p><p className="mt-2 text-12 text-muted-foreground">测试对象 r{studio.trial.revision} · 依赖 {studio.trial.dependencyRevision}{!trialIsCurrent(studio) && studio.trial.passed ? " · 结果已过期，请重新测试" : ""}</p><details className="mt-3 text-12"><summary>本次测试的输入快照</summary><p className="mt-2 whitespace-pre-wrap text-muted-foreground" data-testid="studio-trial-input">{studio.trial.sampleInput}</p></details>{!studio.trial.passed && <Button variant="outline" className="mt-3" data-testid="studio-fix-failure" onClick={() => { setPanel("files"); setNotice("已回到失败草稿：请补充来源要求，再保存并测试。"); }}><ArrowLeft className="h-3 w-3" aria-hidden />返回文件修复</Button>}</div>}
          </section>}
          {panel === "versions" && <section className="rounded-container border border-border bg-card p-5" data-testid="studio-versions-panel"><h3 className="mb-4 text-16 font-semibold">不可变发布版本</h3>{[...studio.releases].reverse().map(item => <div key={item.number} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-4"><div><strong className="text-14">v{item.number}</strong><p className={fieldClass}>来自工作草稿 r{item.revision} · {item.files.length} 个文件{studio.boundRelease === item.number ? " · 研究助手正在使用" : ""}</p></div><Button variant="outline" data-testid={`studio-bind-${item.number}`} onClick={() => open("agent", item.number)}>查看 Agent 绑定</Button></div>)}<Button className="mt-4" variant="outline" data-testid="studio-rollback" onClick={() => open("rollback")}>从 v1 恢复到工作草稿</Button><p className="mt-2 text-12 text-muted-foreground">重新测试并发布后才产生新版本，历史记录保持完整。</p></section>}
          {panel === "upstream" && <section className="space-y-4 rounded-container border border-border bg-card p-5" data-testid="studio-upstream-panel"><h3 className="text-16 font-semibold">来源与上游更新</h3><p className="break-all text-13">{importedSource}</p><p className={fieldClass}>示例来源快照 a84f1c2 · MIT · 最近检查：本次演示</p><div className="rounded-control border border-warning p-4"><p className="text-13 font-medium">1 个文件需要合并：SKILL.md</p><p className="mt-2 text-12 text-muted-foreground">上游新增“研究限制”要求；你对来源引用的修改会保留。</p></div><Button variant="outline" data-testid="studio-merge-upstream" onClick={() => open("ai")}>查看并确认合并差异</Button><Button variant="ghost" data-testid="studio-keep-local" onClick={() => setNotice("保留当前草稿。上游更新尚未应用。")} >暂时保留本地</Button></section>}
          {panel === "activity" && <section className="space-y-4 rounded-container border border-border bg-card p-5" data-testid="studio-activity-panel"><h3 className="text-16 font-semibold">开发记录</h3><p className="text-13">来源导入 → 草稿 r{studio.revision} → {studio.trial ? `测试 r${studio.trial.revision}` : "等待测试"} → 发布 v{release.number} → 研究助手固定 v{studio.boundRelease}</p><p className={fieldClass}>这里只显示当前演示会话；生产版本需保留操作者、时间、任务与版本证据。</p></section>}
        </section>
        <aside className="space-y-5 border-t border-border bg-panel p-5 lg:w-72 lg:shrink-0 lg:border-l lg:border-t-0" data-testid="studio-readiness-panel"><div><p className="text-10 uppercase tracking-widest text-muted-foreground">从开发到使用</p><h3 className="mt-2 text-16 font-semibold">发布前检查</h3></div>
          <ol className="space-y-4 text-13">{[["文件已保存", !studio.dirty], ["模型可用", studio.modelEnabled], ["工具已授权", studio.toolGranted], ["当前快照测试通过", trialIsCurrent(studio)]].map(([label, ready]) => <li key={String(label)} className="flex items-center gap-2"><span className={ready ? "text-success" : "text-muted-foreground"}>{ready ? <Check className="h-4 w-4" aria-hidden /> : <span className="block h-4 w-4 rounded-full border border-border" />}</span>{label}</li>)}</ol>
          <Button className="w-full" variant="outline" data-testid="studio-open-tests" onClick={() => setPanel("tests")}><Play className="h-3 w-3" aria-hidden />测试工作草稿</Button><Button className="w-full" variant="primary" disabled={!canPublish} data-testid="studio-publish" onClick={() => open("publish")}>发布新版本</Button><p className="text-12 text-muted-foreground">修改文件或运行依赖后，需要重新测试。发布不会自动改变 Agent 的固定绑定。</p>
          <div className="border-t border-border pt-5"><p className="text-13 font-medium">使用此 Skill</p><div className="mt-3 flex items-center gap-2 text-13"><Bot className="h-5 w-5 text-primary" aria-hidden /><div>研究助手<p className={fieldClass}>当前固定 v{studio.boundRelease}</p></div></div><Button className="mt-3 w-full" variant="outline" data-testid="studio-bind-open" onClick={() => open("agent")}>绑定并体验</Button></div>
        </aside>
      </div>
    </StateShell>
    <Dialog open={modal !== null} onOpenChange={value => { if (!value) setModal(null); }}><DialogContent className="max-w-xl" closeTestId="studio-modal-close" data-testid="studio-modal"><DialogTitle>{({ import: "导入开源方案", create: "新建文件", rename: "重命名文件", delete: "删除草稿文件", ai: panel === "upstream" ? "确认上游合并" : "审阅 AI 修改", publish: "发布新版本", model: "Model 运行配置", mcp: "MCP 工具授权", agent: "绑定 Agent 并体验", rollback: "从历史版本恢复", leave: "离开未保存的工作草稿" } as const)[modal ?? "import"]}</DialogTitle><DialogDescription>交互演示：以下操作只影响当前浏览器会话中的示例数据。</DialogDescription>
      {modal === "import" && <><label className="text-12" htmlFor="studio-source">GitHub 仓库地址（完整包演示）</label><Input id="studio-source" data-testid="studio-source" value={source} onChange={e => { setSource(e.target.value); setPreviewReady(false); }} /><Button variant="outline" data-testid="studio-preview-source" onClick={() => { if (!/^https:\/\/github\.com\/[^/?#]+\/[^/?#]+\/?$/.test(source)) { setFormError("此快捷示例只预览完整仓库；目录或单文件请使用完整导入向导明确选择范围。"); return; } setFormError(""); setPreviewReady(true); }}>查看示例预览</Button>{previewReady && <div className="rounded-control border border-border p-4" data-testid="studio-import-preview"><p className="font-medium">research-brief · Skill</p><p className="mt-2 text-12 text-muted-foreground">6 个文件 · MIT · 固定示例版本 a84f1c2</p><p className="mt-2 text-12">将替换当前演示工作草稿；已发布版本及 Agent 绑定不会改变。</p></div>}<Button variant="primary" disabled={!previewReady} data-testid="studio-confirm-import" onClick={() => closeWith(() => { dispatch({ type: "import", source }); setPanel("files"); }, "示例方案已导入工作草稿，尚未发布。")}>确认导入为草稿</Button></>}
      {(modal === "create" || modal === "rename") && <><label className="text-12" htmlFor="studio-path">包内相对路径</label><Input id="studio-path" data-testid="studio-path" value={path} onChange={e => setPath(e.target.value)} /><DialogFooter><Button variant="primary" data-testid="studio-confirm-path" onClick={pathAction}>确认文件路径</Button></DialogFooter></>}
      {modal === "delete" && <><p className="text-13">从工作草稿删除 {studio.selected}？已发布版本仍保留此文件。</p><Button variant="destructive" data-testid="studio-confirm-delete" onClick={() => closeWith(() => dispatch({ type: "delete" }), "文件已从编辑区移除，请保存草稿。")} >确认删除</Button></>}
      {modal === "ai" && <><p className="text-13">{panel === "upstream" ? "保留本地修改，并追加上游的研究限制要求。" : "建议为 SKILL.md 补充可验证的输出要求，其他文件保持不变。"}</p><pre className="max-h-56 overflow-auto rounded-control bg-muted p-4 text-12" data-testid="studio-ai-diff">{panel === "upstream" ? "+ 5. 新增上游要求：输出研究限制。" : "+ 输出前逐条核对来源；信息不足时明确列出限制。"}</pre><p className={fieldClass}>确认后只修改工作草稿；不会发布或重新绑定 Agent。</p><Button variant="primary" data-testid="studio-accept-ai" onClick={() => closeWith(() => panel === "upstream" ? dispatch({ type: "upstream" }) : dispatch({ type: "ai-instructions" }), "修改已应用到编辑区，请保存并重新测试。")} >确认应用修改</Button></>}
      {modal === "publish" && <><p className="text-13">发布工作草稿 r{studio.revision} 为 v{release.number + 1}。测试与依赖检查通过；研究助手仍固定使用 v{studio.boundRelease}，需要另行确认绑定。</p><Button variant="primary" data-testid="studio-confirm-publish" disabled={!canPublish} onClick={() => closeWith(() => { dispatch({ type: "publish" }); setPanel("versions"); }, "新版本已发布。请按需更新 Agent 固定绑定。")} >确认发布</Button></>}
      {modal === "model" && <><p className="text-13">团队研究模型 · 组织配置</p><p className={fieldClass}>配置版本 {studio.dependencyRevision} · {studio.modelEnabled ? "已启用" : "已停用"}。停用后不能开始新的测试或演示运行。</p><Button variant="outline" data-testid="studio-toggle-model" onClick={() => { dispatch({ type: "model" }); setChatResult(false); }}>{studio.modelEnabled ? "停用示例模型" : "启用示例模型"}</Button><p className={fieldClass}>切换后，旧试跑结果不能用于发布。</p></>}
      {modal === "mcp" && <><p className="text-13">知识库连接 · search_documents</p><p className={fieldClass}>工具已发现，{studio.toolGranted ? "已授予只读搜索权限" : "尚未授权，不可调用"}。重新连接不会自动增加工具权限。</p><Button variant="outline" data-testid="studio-toggle-tool" onClick={() => { dispatch({ type: "tool" }); setChatResult(false); }}>{studio.toolGranted ? "撤销示例工具授权" : "授予只读搜索权限"}</Button></>}
      {modal === "agent" && <><p className="text-13">研究助手当前使用 v{studio.boundRelease}；当前选择绑定 v{bindingTarget}。</p><Button variant="outline" data-testid="studio-confirm-bind" onClick={() => { dispatch({ type: "bind", release: bindingTarget ?? release.number }); setChatResult(false); setNotice(`研究助手已固定绑定 v${bindingTarget ?? release.number}。`); }}>确认绑定 v{bindingTarget}</Button><Button variant="primary" disabled={!studio.modelEnabled || !studio.toolGranted} data-testid="studio-demo-chat" onClick={() => setChatResult(true)}>运行演示任务</Button>{chatResult && <div className="rounded-control border border-border p-4" data-testid="studio-chat-result"><p className="text-13">演示完成 · 使用发布版本 v{studio.boundRelease}</p><p className="mt-2 text-12 text-muted-foreground">真实聊天、模型调用和产物下载将在 API 接线后验收；本原型不伪造真实运行证据。</p></div>}</>}
      {modal === "rollback" && <><p className="text-13">将 v1 的文件复制为工作草稿修改。当前未保存内容将被替换；已发布版本和 Agent 绑定保持不变。请重新测试后发布。</p><Button variant="outline" data-testid="studio-confirm-rollback" onClick={() => closeWith(() => { dispatch({ type: "rollback", release: 1 }); setPanel("files"); }, "已恢复 v1 内容到编辑区，请保存、测试并发布新版本。")} >确认恢复到草稿</Button></>}
      {modal === "leave" && <><p className="text-13">尚有未保存的文件修改。离开后这些演示修改将丢失；已发布版本不受影响。</p><DialogFooter><Button variant="outline" data-testid="studio-stay" onClick={() => setModal(null)}>继续编辑</Button><Button variant="destructive" data-testid="studio-confirm-leave" onClick={() => { try { sessionStorage.removeItem(STUDIO_PREVIEW_SESSION_KEY); } catch { /* No stored draft to discard. */ } setModal(null); router.push(pendingHref); }}>丢弃修改并离开</Button></DialogFooter></>}
      {formError && <p role="alert" className="text-12 text-destructive" data-testid="studio-form-error">{formError}</p>}
    </DialogContent></Dialog>
  </main>;
}
