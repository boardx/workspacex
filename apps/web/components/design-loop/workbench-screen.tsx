"use client";
import * as React from "react";
import { TagInput, commitDraft } from "@/components/ui/tag-input";
import { Plus, Search, Pencil, Trash2, Check, Loader2, ShieldAlert, PlugZap, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { UiState } from "@/lib/ui-state";
import { ApiError } from "@/lib/api-client";
import { describeFailure } from "@/lib/design-failure";
import { humanTime } from "@/lib/human-time";
import { LinkBadge } from "./badges";
import { useDialogFocus } from "./use-dialog-focus";
import { RefImagePicker } from "./ref-image-picker";
import {
  createProject as apiCreateProject,
  deleteProject as apiDeleteProject,
  intakeQuestions,
  uploadRefImage,
  listMyProjects,
  DESIGN_PROJECT_MAX_TAGS,
  DESIGN_WORKBENCH_STARTERS,
  DESIGN_PROJECT_TAG_MAX_CHARS,
  updateProject as apiUpdateProject,
  PROJECT_TEMPLATE_OPTIONS,
  PROJECT_TEMPLATE_LABEL,
  type DesignProject,
  type IntakeAnswer,
  type ProjectTemplate,
} from "@/lib/live-design-workbench";
import type { designWorkbench } from "@repo/contracts";

type IntakeQuestion = designWorkbench.IntakeQuestion;

/**
 * UC-17.8 B4.5 —— PM 设计工作台首页，**真栈**（契约 `designWorkbench`：
 * `listMyProjects`/`createProject`/`updateProject`/`deleteProject`）。切自
 * 原型 mock store（已于 B6.1 删除）的本地 mock，同 `inbox-screen.tsx`（B3.4）的成例。
 *
 * ## 这一屏刻意的几个设计取舍
 *
 *   · **搜索 `query` 是服务端参数**（`listMyProjects({ q })`），不是本地过滤——同
 *     `inbox-screen.tsx` 的 `q`，避免"列表已加载"和"搜索结果"分裂成两份状态。
 *   · **"生成中过渡"改为等待 `createProject` 真实返回**（backlog B4.5 原文）：不再是
 *     固定 1.1s 的 `window.setTimeout` 假过渡，`generating` 态持续到 `createProject`
 *     真正 resolve/reject——失败时退回弹窗并提示错误，不静默吞掉。
 *   · **编辑/删除都是乐观本地更新之后校验，不做——用真实返回值替换本地行**：编辑成功后
 *     用服务端返回的 `project` 覆盖列表里那一条（而不是本地拼 patch），删除成功后才从
 *     列表移除；失败都保留原列表 + 提示，不假装已经生效。
 */
const TEMPLATE_LABEL = PROJECT_TEMPLATE_LABEL;
const TEMPLATE_EMOJI: Record<ProjectTemplate, string> = {
  mobile: "📱",
  ui: "🎨",
  wireframe: "🧩",
};
const TEMPLATE_OPTIONS = PROJECT_TEMPLATE_OPTIONS.map((t) => ({ value: t, label: TEMPLATE_LABEL[t] }));

/**
 * 迭代 33：这三处（工作台首页 / 草稿列表 / 收件箱）原来各抄了一份
 * 「reasonCode 取不到就拼 HTTP 状态、再不行 String(err)」。迭代 27 只把详情页那一份
 * 换成了人话表，而这三屏恰恰是用户**第一眼**看到的地方。同一事实不得声明在两处：
 * 统一走 `lib/design-failure.ts`，并由 `lint-user-facing-error-text` 机械挡住回潮。
 */

type Load =
  | { kind: "loading" }
  | { kind: "ready"; items: DesignProject[] }
  | { kind: "failed"; reason: string };

const SEARCH_DEBOUNCE_MS = 300;

export function DesignWorkbenchHome({
  state = "default",
  onOpenProject,
}: {
  state?: UiState;
  /** 迭代 16（#3773 R7）：`justCreated` = 这一次是刚建出来的，调用方据它决定是否自动开画。 */
  onOpenProject?: (id: string, justCreated?: boolean) => void;
}) {
  const [queryInput, setQueryInput] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  /** 手上已经有结果、但正在按新的筛选条件重取——这时保留旧结果，别把屏清空。 */
  const [refreshing, setRefreshing] = React.useState(false);
  const [dialog, setDialog] = React.useState<
    | null
    | { mode: "create"; template: ProjectTemplate; brief?: { readonly name: string; readonly problem: string } }
    | { mode: "edit"; project: DesignProject }
  >(null);
  const [generating, setGenerating] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  /** 迭代 23：项目建好了但有参考图没传上去——见 `handleCreate` 头注，这不能静默。 */
  const [partial, setPartial] = React.useState<null | { projectId: string; name: string; failed: number }>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  /**
   * 迭代 39（UIUX 第 18 轮）：删除项目**没有二次确认，也没有撤销**——卡片右下角那个
   * 垃圾桶图标挨着「编辑」，点错一下，一个做了两周的设计项目（对话、原型、验收标准、
   * 参考图）当场消失，屏上连一句话都不出。草稿列表在第 11 轮已经补过同一道门，
   * 这一屏是漏网的那个。记的是「要删哪一个」，不是一个布尔——一次只确认一件事。
   */
  const [confirmDelete, setConfirmDelete] = React.useState<DesignProject | null>(null);
  /**
   * 迭代 13（delta §4）：选中的过滤标签（交集）。
   *
   * `vocabulary` 是 chip 列表的取值来源，只在**没有选任何标签**的那次加载时刷新——
   * 因为过滤后的结果里当然只剩被选中的那些标签，拿它当词表会让 chip 一点就只剩自己，
   * 用户再也点不到第二个。词表是「我所有项目上出现过的标签」，不是「当前结果里的」。
   */
  const [selectedTags, setSelectedTags] = React.useState<readonly string[]>([]);
  const [vocabulary, setVocabulary] = React.useState<readonly string[]>([]);

  React.useEffect(() => {
    const t = window.setTimeout(() => setQuery(queryInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [queryInput]);

  const reload = React.useCallback(async () => {
    /*
     * 迭代 39：原来每次 reload 都先把列表整屏换成六块骨架——搜索是 300ms 防抖后自动
     * 触发的，于是打字的人看到的是「我的项目一闪没了、又回来」。**已经有结果时保留结果**，
     * 只在上面挂一条「正在筛…」；真正空手的那一次（首屏、重试）才给骨架。
     */
    setLoad((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
    setRefreshing(true);
    try {
      const out = await listMyProjects(query === "" ? undefined : query, selectedTags);
      setLoad({ kind: "ready", items: [...out.items] });
      if (selectedTags.length === 0) {
        setVocabulary([...new Set(out.items.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b, "zh-CN")));
      }
    } catch (err) {
      setLoad({ kind: "failed", reason: describeFailure(err) });
    } finally {
      setRefreshing(false);
    }
  }, [query, selectedTags]);

  React.useEffect(() => {
    if (state !== "default") return;
    void reload();
  }, [reload, state]);

  if (state === "loading" || (state === "default" && load.kind === "loading")) {
    return (
      <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="loading">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <div key={n} className="h-32 animate-pulse rounded-card bg-muted" />
        ))}
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div className="flex flex-col items-center gap-2 p-16 text-center" data-testid="denied">
        <ShieldAlert aria-hidden className="h-8 w-8 text-muted-foreground" />
        <p className="text-14 font-medium">PM 设计工作台仅 PM / 运营可见</p>
        <p className="max-w-sm text-12 text-muted-foreground">这里用来把反馈深化成设计方案再推回排期。需要权限的话联系平台管理员。</p>
      </div>
    );
  }
  if (state === "dep-failed" || (state === "default" && load.kind === "failed")) {
    const reason = state === "default" && load.kind === "failed" ? load.reason : null;
    return (
      <div className="flex flex-col items-center gap-2 p-16 text-center" data-testid="dep-failed">
        <PlugZap aria-hidden className="h-8 w-8 text-muted-foreground" />
        <p className="text-14 font-medium">设计项目暂时读不到</p>
        <p className="max-w-sm text-12 text-muted-foreground">
          你的项目没有丢，只是这次没取到{reason !== null ? `（${reason}）` : ""}。稍后重试。
        </p>
        <Button size="sm" variant="outline" className="mt-1" onClick={() => void reload()} data-testid="workbench-retry">重试</Button>
      </div>
    );
  }

  const items = load.kind === "ready" ? load.items : [];
  /** 迭代 23：当前有没有筛选条件——决定"空"该说哪一句话（见下方空态）。 */
  const filtering = query !== "" || selectedTags.length > 0;
  /**
   * 已有标签及用量——候选来自真实数据，不是写死的枚举（同模板库那份的判据）。
   * ⚠ 不用 `useMemo`：这一段在「读不到」的提前 return **之后**，套 hook 会违反
   * hooks 调用顺序（eslint `rules-of-hooks` 当场判红）。项目列表是几十条的量级，
   * 每次渲染直接数一遍比把 hook 挪上去改动更小、也更不容易出错。
   */
  const knownTags: ReadonlyMap<string, number> = (() => {
    const counts = new Map<string, number>();
    for (const p of items) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return new Map([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")));
  })();

  /**
   * 迭代 23：`brief` 是空工作台上「拿这个开头」那几张卡片预填进去的一句话。
   * 预填的是**新建弹窗的输入**，不是直接建一个项目——用户还能改名字、改类别、改那句话，
   * 也还要走同一条澄清问答。一键体验不等于替他按下确定。
   */
  const startCreate = (template: ProjectTemplate, brief?: { readonly name: string; readonly problem: string }) =>
    setDialog({ mode: "create", template, ...(brief === undefined ? {} : { brief }) });

  /**
   * 迭代 23：参考图在**新建时**就能带上——契约的 `createProject` 不收字节（同它不收
   * `criteria`/`frames` 的理由），所以落地形态是"先建、再传、最后才跳转"。对用户不可见：
   * 他在一个弹窗里填完名字、写完想做什么、贴上截图，按一次确定。
   *
   * ⚠ **上传失败不静默**：项目已经建出来了，但图没传上去。这时跳转过去等于让他以为
   *   "AI 会照着我那张图画"——而模型根本看不到那张图。所以失败就留在工作台把话说清，
   *   并给一个直接打开那个项目的出口（项目是真的存在的，不能让人以为白填了一遍）。
   */
  const handleCreate = async (input: { name: string; template: ProjectTemplate; problem: string; tags: readonly string[]; intake?: readonly IntakeAnswer[]; refFiles?: readonly File[] }) => {
    setDialog(null);
    setActionError(null);
    setGenerating(input.name);
    try {
      const { project } = await apiCreateProject({
        name: input.name,
        template: input.template,
        problem: input.problem === "" ? undefined : input.problem,
        // 迭代 13：跳过的题不在数组里；空数组不发，省得服务端多判一次。
        ...(input.intake !== undefined && input.intake.length > 0 ? { intake: input.intake } : {}),
        // 同上：没打标签就不发这个键（`createProject.in` 是 .strict()，但空数组是合法的，
        // 不发只是少一次无意义的往返内容）。
        ...(input.tags.length > 0 ? { tags: [...input.tags] } : {}),
      });
      let withImages = project;
      let failed = 0;
      for (const file of input.refFiles ?? []) {
        try {
          const out = await uploadRefImage(project.id, file);
          withImages = out.project;
        } catch {
          // 逐张算，不是一张失败就放弃剩下的——三张里有一张超了 4MB，另外两张仍该传上去。
          failed += 1;
        }
      }
      setLoad((prev) => (prev.kind === "ready" ? { ...prev, items: [withImages, ...prev.items] } : prev));
      setGenerating(null);
      if (failed > 0) {
        setPartial({ projectId: project.id, name: project.name, failed });
        return;
      }
      onOpenProject?.(project.id, true);
    } catch (err) {
      setGenerating(null);
      setActionError(`没能创建设计项目（${describeFailure(err)}）`);
    }
  };

  const handleSave = async (projectId: string, input: { name: string; template: ProjectTemplate; problem: string; tags: readonly string[] }) => {
    setBusyId(projectId);
    try {
      // ⚠ 标签**总是**发：编辑弹窗里清空标签框就是"把标签全删掉"，不发这个键会让
      //   PATCH 的语义变成"保持原值"，于是删不掉最后一个标签。
      const { project } = await apiUpdateProject(projectId, { ...input, tags: [...input.tags] });
      setLoad((prev) =>
        prev.kind === "ready" ? { ...prev, items: prev.items.map((p) => (p.id === projectId ? project : p)) } : prev,
      );
      setDialog(null);
    } catch (err) {
      setActionError(`没能保存修改（${describeFailure(err)}）`);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (projectId: string) => {
    setConfirmDelete(null);
    setBusyId(projectId);
    try {
      await apiDeleteProject(projectId);
      setLoad((prev) => (prev.kind === "ready" ? { ...prev, items: prev.items.filter((p) => p.id !== projectId) } : prev));
    } catch (err) {
      setActionError(`没能删除这个项目（${describeFailure(err)}）`);
    } finally {
      setBusyId(null);
    }
  };

  if (generating !== null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-16" data-testid="workbench-generating">
        <Loader2 aria-hidden className="h-8 w-8 animate-spin text-primary" />
        <p className="text-14 font-medium">正在把「{generating}」整理成设计稿…</p>
        <div className="grid w-full max-w-md grid-cols-3 gap-2">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-24 animate-pulse rounded-card bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto" data-testid="design-workbench">
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-20 font-semibold tracking-tight">PM 设计工作台</h1>
        {/*
          * 迭代 23：这句话原文是「**从模板起一个设计**，或把收件箱里的反馈深化成方案」——
          * 而三张模板卡片在迭代 13 就删掉了（理由见下面那段注释）。**首屏第一句话在指一条
          * 已经不存在的路**，而且这是新用户看到的第一行字。改成现在真实的两条路。
          */}
        <p className="mt-0.5 text-12 text-muted-foreground">说清要做什么，AI 问你几句再把它画出来；也可以把收件箱里的反馈深化成方案，再推回排期。</p>
      </div>

      {/*
        * 迭代 39：这条提示原来 3 秒后自己消失（三处各挂一个 `setTimeout`，且卸载时都不清）。
        * 3 秒读不完一句话，更读不完「没能删除这个项目（…）」之后该怎么办；而且失败的那一刻
        * 用户的眼睛多半还在他点的那个按钮上。改成留在屏上，由他自己关掉。
        */}
      {actionError !== null && (
        <div className="mx-6 mt-3 flex items-start gap-2 rounded-card bg-destructive px-3 py-1.5 text-12 text-destructive-foreground" data-testid="workbench-action-error" role="alert">
          <span className="min-w-0 flex-1">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            data-testid="workbench-action-error-dismiss"
            className="shrink-0 underline underline-offset-2"
          >
            知道了
          </button>
        </div>
      )}

      {confirmDelete !== null && (
        <div
          className="mx-6 mt-3 flex flex-wrap items-center gap-2 rounded-card border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-12"
          data-testid="workbench-delete-confirm"
          role="alertdialog"
          aria-label="确认删除设计项目"
        >
          <span className="min-w-0 flex-1">
            删掉「{confirmDelete.name}」？里面的对话、原型和验收标准会一起没有，删了找不回来。
          </span>
          <Button variant="outline" size="sm" data-testid="workbench-delete-cancel" onClick={() => setConfirmDelete(null)}>
            算了
          </Button>
          <Button
            variant="destructive"
            size="sm"
            data-testid="workbench-delete-yes"
            onClick={() => { void handleDelete(confirmDelete.id); }}
          >
            删掉
          </Button>
        </div>
      )}

      {partial !== null && (
        <div className="mx-6 mt-3 flex flex-wrap items-center gap-2 rounded-card border border-warning/40 bg-warning/10 px-3 py-1.5 text-12" data-testid="workbench-partial-create" role="alert">
          <span>
            「{partial.name}」已经建好了，但有 {partial.failed} 张参考图没传上去（多半是格式不对或超过 4MB）。进去再传一次，AI 才看得到它。
          </span>
          <Button variant="outline" size="sm" data-testid="workbench-partial-open"
            onClick={() => { const id = partial.projectId; setPartial(null); onOpenProject?.(id, true); }}>
            打开这个项目
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPartial(null)}>知道了</Button>
        </div>
      )}

      {/*
       * 迭代 13（delta §3.6）：三张模板卡片已删。理由不是"占地方"——「类别」在新建对话框里
       * 已经是一个下拉，两处入口做同一件事；更要紧的是它让**挑模板成了流程第一步**：
       * 用户还没说清要做什么，就先被要求选一个设备形态。而设备形态本该是澄清完之后的结论。
       * 主入口现在是下面那个「新建设计」按钮，走问答流程。
       */}

      {/* 我的设计项目 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-2">
        <h2 className="text-14 font-semibold">
          我的设计项目
          {refreshing && load.kind === "ready" && (
            <span className="ml-2 text-11 font-normal text-muted-foreground" data-testid="workbench-refreshing" role="status">
              正在按新条件筛…
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="按名称搜索"
              aria-label="按名称搜索设计项目"
              data-testid="workbench-search"
              className="h-8 w-48 pl-7 pr-7 text-12"
            />
            {/* 清空搜索原来只有「全选再删」一条路，而清空是这里最常用的下一步。 */}
            {queryInput !== "" && (
              <button
                type="button"
                onClick={() => setQueryInput("")}
                aria-label="清空搜索"
                data-testid="workbench-search-clear"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-control p-0.5 text-muted-foreground transition-colors duration-fast hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button variant="primary" size="sm" onClick={() => startCreate("mobile")} data-testid="workbench-new">
            <Plus aria-hidden className="h-3.5 w-3.5" /> 新建设计
          </Button>
        </div>
      </div>

      {vocabulary.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-6 pt-2" data-testid="workbench-tag-filter">
          {vocabulary.map((t) => {
            const on = selectedTags.includes(t);
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() => setSelectedTags((prev) => (on ? prev.filter((x) => x !== t) : [...prev, t]))}
                data-testid={`workbench-tag-${t}`}
                className={`rounded-control px-2 py-0.5 text-11 transition-colors duration-fast ${on ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-background-foreground"}`}
              >
                {t}
              </button>
            );
          })}
          {selectedTags.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedTags([])}
              className="text-11 text-muted-foreground underline-offset-2 transition-colors duration-fast hover:text-background-foreground hover:underline"
              data-testid="workbench-tag-clear"
            >
              清除筛选
            </button>
          )}
        </div>
      )}

      {items.length === 0 ? (
        filtering ? (
          /*
           * 迭代 23：**筛空不等于没有**。此前搜索或选标签之后一条都不剩时，屏上照样说
           * 「还没有设计项目。」——用户刚打了两个字，就被告知自己的项目全没了。
           * （过滤在服务端做，前端拿不到"总共有几条"，但"现在有筛选条件"它是知道的，
           *   这就够说出正确的那句话了。）
           */
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-16 text-center" data-testid="empty-filtered">
            <p className="text-14 font-medium">没有符合条件的设计项目。</p>
            <p className="text-12 text-muted-foreground">
              你的项目还在，只是被当前的{query === "" ? "" : "搜索词"}{query !== "" && selectedTags.length > 0 ? "和" : ""}{selectedTags.length > 0 ? "标签筛选" : ""}挡住了。
            </p>
            <Button variant="outline" size="sm" className="mt-1" data-testid="empty-clear-filter"
              onClick={() => { setQueryInput(""); setSelectedTags([]); }}>
              清除筛选条件
            </Button>
          </div>
        ) : (
          /*
           * 迭代 23：真空态给的是**能点的下一步**，不是一句指向不存在的东西的话
           * （原文：「从上面挑一个模板开始」——模板卡片在迭代 13 就删了）。
           *
           * 三条起手 brief 直接复用契约里的 `DESIGN_WORKBENCH_STARTERS`——详情页空画布上
           * 用的就是这三条，不在这里另写一份（同一事实不得声明在两处）。点一下把它预填进
           * 新建弹窗，用户仍然能改、仍然走澄清问答：一键体验不等于替他按下确定。
           */
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-16 text-center" data-testid="empty">
            <p className="text-14 font-medium">还没有设计项目。</p>
            <p className="max-w-sm text-12 text-muted-foreground">
              拿下面任意一条开头试试——点了就是一句写好的需求，你可以改；也可以在收件箱把一条反馈「用 PM 设计工作台深化」。
            </p>
            <div className="mt-1 flex flex-wrap items-stretch justify-center gap-2" data-testid="empty-starters">
              {DESIGN_WORKBENCH_STARTERS.map((st) => (
                <button
                  key={st.label}
                  type="button"
                  data-testid={`empty-starter-${st.label}`}
                  onClick={() => startCreate("mobile", { name: st.label, problem: st.prompt })}
                  className="flex w-52 flex-col gap-1 rounded-card border border-border bg-card p-3 text-left transition-colors duration-fast hover:border-primary"
                >
                  <span className="text-12 font-medium">{st.label}</span>
                  <span className="line-clamp-3 text-10 text-muted-foreground">{st.prompt}</span>
                </button>
              ))}
            </div>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="workbench-grid">
          {items.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              busy={busyId === p.id}
              onOpen={() => onOpenProject?.(p.id)}
              onEdit={() => setDialog({ mode: "edit", project: p })}
              onDelete={() => { setActionError(null); setConfirmDelete(p); }}
            />
          ))}
        </div>
      )}

      {dialog !== null && (
        <ProjectDialog
          initial={dialog.mode === "edit"
            ? { name: dialog.project.name, template: dialog.project.template, problem: dialog.project.problem, tags: dialog.project.tags }
            /* 迭代 23：空工作台的起手卡片预填进来的那一句（没点卡片就是空的，与此前逐字相同）。 */
            : { template: dialog.template, ...(dialog.brief ?? {}) }}
          editing={dialog.mode === "edit"}
          busy={dialog.mode === "edit" ? busyId === dialog.project.id : false}
          knownTags={knownTags}
          onClose={() => setDialog(null)}
          onCreate={(input) => void handleCreate(input)}
          onSave={(input) => {
            if (dialog.mode === "edit") void handleSave(dialog.project.id, input);
          }}
        />
      )}
    </div>
  );
}

function ProjectCard({
  project, busy, onOpen, onEdit, onDelete,
}: {
  project: DesignProject;
  busy: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div data-testid={`project-card-${project.id}`} className="flex flex-col rounded-card border border-border-subtle bg-card transition-colors duration-fast hover:border-primary">
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col items-start gap-2 p-4 text-left" data-testid={`project-open-${project.id}`}>
        <span aria-hidden className="grid h-10 w-10 place-items-center rounded-card bg-panel text-20">{TEMPLATE_EMOJI[project.template]}</span>
        <span className="text-13 font-medium">{project.name}</span>
        <span className="text-11 text-muted-foreground">
          {/* 「2026/9/23」是机器时间：他要判断的是「这是不是我刚才那个」。同 `human-time.ts` 单源。 */}
          {TEMPLATE_LABEL[project.template]} · 改于 {humanTime(project.updatedAt)}
        </span>
        {project.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" data-testid={`project-tags-${project.id}`}>
            {project.tags.map((t) => (
              <span key={t} className="rounded-control bg-panel px-1.5 py-0.5 text-10 text-muted-foreground">{t}</span>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1">
          {project.linkedFeedbackId !== null && <LinkBadge text={`源自反馈`} testid={`project-link-${project.id}`} />}
          {project.pushed ? (
            <span className="inline-flex items-center gap-0.5 rounded-control bg-success px-1.5 py-0.5 text-10 font-medium text-success-foreground">
              <Check aria-hidden className="h-3 w-3" /> 已推送
            </span>
          ) : (
            <span className="rounded-control bg-warning px-1.5 py-0.5 text-10 font-medium text-warning-foreground">未推送</span>
          )}
        </div>
      </button>
      <div className="flex justify-end gap-1 border-t border-border-subtle px-3 py-1.5">
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit} disabled={busy} aria-label={`编辑「${project.name}」`} data-testid={`project-edit-${project.id}`}>
          <Pencil aria-hidden className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={onDelete} disabled={busy} aria-label={`删除「${project.name}」`} data-testid={`project-delete-${project.id}`}>
          {busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <Trash2 aria-hidden className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function ProjectDialog({
  initial, editing, busy, knownTags, onClose, onCreate, onSave,
}: {
  initial: { name?: string; template: ProjectTemplate; problem?: string; tags?: readonly string[] };
  /** `标签 → 有多少个设计在用`，由调用方从真实项目列表聚合——本弹窗不持有标签清单。 */
  knownTags: ReadonlyMap<string, number>;
  editing: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; template: ProjectTemplate; problem: string; tags: readonly string[]; intake?: readonly IntakeAnswer[]; refFiles?: readonly File[] }) => void;
  /** 编辑走 `updateProject`（.strict()，没有 intake）——所以这里的入参**不含** intake，类型上就不给带。 */
  onSave: (input: { name: string; template: ProjectTemplate; problem: string; tags: readonly string[] }) => void;
}) {
  const [name, setName] = React.useState(initial.name ?? "");
  const [template, setTemplate] = React.useState<ProjectTemplate>(initial.template);
  const [problem, setProblem] = React.useState(initial.problem ?? "");
  /**
   * 标签用**全仓共用的** `TagInput`（2026-09-09 人类指令「统一体验」）。
   *
   * 迭代 13 这里原本是逗号分隔的纯文本框，理由写在当时的注释里：「chip 交互的常见 bug
   * 是最后一个没按回车就丢了」。那个担心是真的，所以换成 chip 的同时把它堵死——
   * 草稿由本组件持有，提交前一律走 `commitDraft` 并进去（见 `submitTags()`）。
   * 只换控件不堵这个洞，等于拿一个 bug 换另一个。
   */
  const [tags, setTags] = React.useState<readonly string[]>(initial.tags ?? []);
  const [tagDraft, setTagDraft] = React.useState("");
  /**
   * 迭代 23：新建时就能挂参考图。只在内存里攥着 `File`，项目建好之后由 `handleCreate`
   * 统一上传（见那边的头注：上传失败不静默）。**编辑走另一条路**——已有项目的参考图
   * 在详情页的 `RefImageStrip` 上增删，那里每个动作都是即时的 API 调用。
   */
  const [refFiles, setRefFiles] = React.useState<readonly File[]>([]);
  const submitTags = (): readonly string[] =>
    commitDraft(tags, tagDraft, { maxTags: DESIGN_PROJECT_MAX_TAGS, maxTagLength: DESIGN_PROJECT_TAG_MAX_CHARS });
  const canSubmit = name.trim() !== "" && !busy;

  /*
   * 迭代 13（delta §3）：新建从「填表」改成「问答」。三步：
   *   brief（写一句想做什么）→ questions（逐条回答，都能跳过）→ review（可编辑的指导原则）
   * 编辑既有项目仍是原来那张表——那时上下文早就有了，再问一遍是打扰。
   */
  const [step, setStep] = React.useState<"brief" | "questions" | "review">("brief");
  const [questions, setQuestions] = React.useState<readonly IntakeQuestion[]>([]);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [asking, setAsking] = React.useState(false);
  const [fallbackQs, setFallbackQs] = React.useState(false);

  const answered = () =>
    questions
      /*
       * 迭代 17：**把维度一起交上去**。
       *
       * 维度就在 `q.dimension` 里，此前被丢掉了，于是服务端无从分辨哪一条属于
       * 「成功长什么样」那一维——它退而求其次把全部答案都当成验收标准，
       * 「谁会用这个东西」这种背景句就这样进了验收口径。
       */
      .map((q) => ({ question: q.text, answer: (answers[q.text] ?? "").trim(), dimension: q.dimension }))
      // 跳过的题**不进数组**，不是给一个空串——"没答"和"答了空"是两件事。
      .filter((a) => a.answer !== "");

  /**
   * 迭代 39：这里原来**只有 `finally`，没有 `catch`**——`intakeQuestions` 失败时转圈停下、
   * 停在原地，一个字都不出。用户会再点一次，再什么也没有。而这一步是新建流程的正门。
   * 失败要说，并且指出那条不靠它也能走完的路（「跳过，直接创建」就在旁边）。
   */
  const [askError, setAskError] = React.useState<string | null>(null);
  const ask = async () => {
    setAsking(true);
    setAskError(null);
    briefRef.current = problem;
    try {
      const out = await intakeQuestions(problem.trim() === "" ? name.trim() : problem.trim());
      setQuestions(out.questions);
      setFallbackQs(out.fallback);
      setStep("questions");
    } catch (err) {
      setAskError(`没能让 AI 出题（${describeFailure(err)}）。可以再试一次，或者点「跳过，直接创建」——进去以后照样能在对话里说。`);
    } finally {
      setAsking(false);
    }
  };

  /**
   * 「想做什么」那一段的原文——把答案拼进去之前的样子。
   *
   * ⚠ 有了「上一步」之后这个记忆是必须的：`toReview` 是**在 `problem` 上追加**答案，
   * 而回到问答再点一次「下一步」就会在已经拼过的文本上再拼一遍，越走越长。
   * 每次都从这段原文重拼，走多少个来回结果都一样。
   */
  const briefRef = React.useRef<string>(initial.problem ?? "");
  /** 上一次由本函数拼出来的那版——用来分辨「用户在确认页改过」和「还是我拼的那版」。 */
  const generatedRef = React.useRef<string | null>(null);

  const toReview = () => {
    const a = answered();
    const lines = [briefRef.current.trim(), ...(a.length > 0 ? ["", ...a.map((x) => `- ${x.question}：${x.answer}`)] : [])];
    const next = lines.join("\n").trim();
    // 用户在确认页自己改过的那版不覆盖——他改的是最终要落库的那段字。
    const edited = generatedRef.current !== null && problem.trim() !== generatedRef.current.trim();
    if (!edited) {
      generatedRef.current = next;
      setProblem(next);
    }
    setStep("review");
  };

  /**
   * 迭代 39：填到一半点到遮罩 / 按了 Esc ⇒ **一个字不剩**。新建这张表里有名字、一整段
   * 「想做什么」、标签、参考图，还可能已经答过一轮问题——这是这一屏上最贵的一次输入。
   * 改过就先问一句（同第 16 轮「从对话导入」那道门的理由）。
   */
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const dirty =
    name.trim() !== (initial.name ?? "").trim()
    || problem.trim() !== (initial.problem ?? "").trim()
    || tags.length !== (initial.tags ?? []).length
    || tagDraft.trim() !== ""
    || refFiles.length > 0
    || Object.values(answers).some((a) => a.trim() !== "");
  const requestClose = () => {
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  /** B6.5：焦点进弹窗 / Esc 关闭 / 关闭后焦点回到「新建设计」或模板卡（见 `use-dialog-focus.ts`）。 */
  const panelRef = React.useRef<HTMLDivElement>(null);
  useDialogFocus(panelRef, requestClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="project-dialog">
      <div className="absolute inset-0 bg-inverse/40" onClick={requestClose} aria-hidden />
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={editing ? "编辑设计" : "新建设计"} className="relative flex w-full max-w-md flex-col gap-3 rounded-card border border-border bg-card p-5 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <h3 className="text-16 font-semibold">
          {editing ? "编辑设计" : step === "brief" ? "新建设计" : step === "questions" ? "再问你几个问题" : "确认设计指导原则"}
        </h3>

        {(editing || step === "brief") && (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-11 font-medium text-muted-foreground">类别</span>
              <Select options={TEMPLATE_OPTIONS} value={template} onValueChange={(v) => setTemplate(v as ProjectTemplate)} data-testid="project-dialog-template" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="project-name" className="text-11 font-medium text-muted-foreground">名称</label>
              <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="给这个设计起个名字" data-testid="project-dialog-name" />
              {name.trim() === "" && <p className="text-10 text-muted-foreground" data-testid="err-name">名称必填，起个名字才能创建。</p>}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="project-problem" className="text-11 font-medium text-muted-foreground">
                {editing ? "背景 / 上下文（可选）" : "想做什么？"}
              </label>
              <Textarea
                id="project-problem" value={problem} onChange={(e) => setProblem(e.target.value)} rows={3}
                placeholder={editing ? "想解决的问题、谁会用、现在怎么绕过去的" : "一句话也行，我会再问你几个问题"}
                data-testid="project-dialog-problem"
              />
            </div>
            {!editing && <RefImagePicker files={refFiles} onChange={setRefFiles} disabled={busy} />}
          </>
        )}

        {!editing && step === "questions" && (
          <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto" data-testid="intake-questions">
            {fallbackQs && (
              <p className="text-11 text-muted-foreground" data-testid="intake-fallback-notice">
                AI 没能生成针对性的问题，先按通用的问一遍。
              </p>
            )}
            {questions.map((q) => (
              <div key={q.text} className="flex flex-col gap-1">
                <label className="text-12 font-medium">{q.text}</label>
                <Textarea
                  rows={2}
                  value={answers[q.text] ?? ""}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.text]: e.target.value }))}
                  placeholder={q.hint ?? "答不上来就留空，跳过这条"}
                  data-testid={`intake-answer-${q.dimension}`}
                />
              </div>
            ))}
          </div>
        )}

        {!editing && step === "review" && (
          <div className="flex flex-col gap-1">
            <label htmlFor="project-guideline" className="text-11 font-medium text-muted-foreground">
              设计指导原则（可以改，改完就是这个项目的背景）
            </label>
            <Textarea
              id="project-guideline" rows={8} value={problem}
              onChange={(e) => setProblem(e.target.value)}
              data-testid="intake-guideline"
            />
          </div>
        )}

        {(editing || step === "brief" || step === "review") && (
          <div className="flex flex-col gap-1">
            <span className="text-11 font-medium text-muted-foreground">
              标签（最多 {DESIGN_PROJECT_MAX_TAGS} 个）
            </span>
            <TagInput
              value={tags}
              onChange={setTags}
              knownTags={knownTags}
              noteFor={(n) => `${String(n)} 个设计在用`}
              maxTags={DESIGN_PROJECT_MAX_TAGS}
              maxTagLength={DESIGN_PROJECT_TAG_MAX_CHARS}
              draft={tagDraft}
              onDraftChange={setTagDraft}
              testIdPrefix="project-tags"
              emptyHint="输入即搜索已有标签，回车新建一个——设计列表可按它们筛选"
            />
          </div>
        )}

        {askError !== null && (
          <p className="text-11 text-destructive" role="alert" data-testid="project-dialog-ask-error">{askError}</p>
        )}

        {confirmDiscard && (
          <div className="flex flex-col gap-2 rounded-control border border-border bg-panel p-2" data-testid="project-dialog-discard" role="alertdialog" aria-label="放弃这次填写">
            <p className="text-11">关掉就把刚填的这些丢了。</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" data-testid="project-dialog-discard-keep" onClick={() => setConfirmDiscard(false)}>继续填</Button>
              <Button variant="destructive" size="sm" data-testid="project-dialog-discard-yes" onClick={onClose}>丢掉并关闭</Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          {/*
            * 问答与确认这两步原来都**回不去**：名字打错一个字，只能取消重来（连带丢掉
            * 已经答过的几道题）。回上一步不该收费成重开一次。
            */}
          {!editing && step !== "brief" && (
            <Button variant="ghost" size="sm" data-testid="intake-back"
              onClick={() => setStep(step === "review" ? "questions" : "brief")}>
              上一步
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={requestClose}>取消</Button>
          {!editing && step === "brief" && (
            <>
              {/* 整段跳过：引导是帮忙不是关卡，跳过之后不再拦（delta §3.3 / 取舍 ④=A）。 */}
              <Button variant="ghost" size="sm" disabled={!canSubmit} data-testid="intake-skip-all"
                onClick={() => onCreate({ name: name.trim(), template, problem: problem.trim(), tags: submitTags(), refFiles })}>
                跳过，直接创建
              </Button>
              <Button variant="primary" size="sm" disabled={!canSubmit || asking} data-testid="intake-ask"
                onClick={() => void ask()}>
                {asking && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
                下一步：让 AI 问几个问题
              </Button>
            </>
          )}
          {!editing && step === "questions" && (
            <Button variant="primary" size="sm" data-testid="intake-next" onClick={toReview}>下一步</Button>
          )}
          {(editing || step === "review") && (
            <Button
              variant="primary"
              size="sm"
              disabled={!canSubmit}
              data-testid="project-dialog-submit"
              onClick={() =>
                editing
                  // ⚠ 编辑走 `updateProject`，它的入参是 .strict() 且**没有** intake——
                  // 把空数组也捎上会被服务端判 400（e2e 实测，2026-09-08）。
                  ? onSave({ name: name.trim(), template, problem: problem.trim(), tags: submitTags() })
                  : onCreate({ name: name.trim(), template, problem: problem.trim(), tags: submitTags(), intake: answered(), refFiles })
              }
            >
              {busy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
              {editing ? "保存" : "创建并进入设计"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
