"use client";

import * as React from "react";
import { Plus, RefreshCw, Wrench, X } from "lucide-react";
import {
  listThreadMounts,
  mountSkills,
  unmountSkill,
  type ThreadSkillMount,
} from "@/lib/live-skill-mount";
import { listSkills, type SkillListItem } from "@/lib/live-skill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { describeMessageFailure } from "./chat-live-message-panel";
import { useChatPopoverSlot } from "./chat-popover-coordinator";

/**
 * #467 / #509 —— 会话内挂载 / 卸载 skill（F65）。
 *
 * 这个组件是 `/chat` 上第一条**真实**的 skill 路径：读 `GET /threads/:id/skill-deviations`、
 * 写 `POST /threads/:id/skill-mounts`、`DELETE /threads/:id/skill-mounts/:mountId`，
 * 三条都落到 `thread_skill_mounts`。
 *
 * ⚠ **不引用 `@/lib/mock/skill`**。原型里的 `components/skill/skill-temp-mount.tsx`
 *   用 `CHAT_MOUNT` / `TEMP_PICKER` 两份静态常量演示同一块界面，那是签核材料
 *   （`contracts/skills/ui.md`），**不许删**、也**不许**被这条活路径引用——
 *   一个引了 mock 的活路径会让「挂载真的生效了吗」这条断言永远绿。
 *
 * ## 可选池为什么是 `GET /skills` 而不是 `listMountableSkills`
 *
 * 契约的 `listMountableSkills` 要下发 `boundBySegment`（本议程环节已绑定的），
 * 那要读蓝本编排，而 `ProjectOrchestrationStorePort` 今天没有适配器。接出来
 * 只能给一个恒为空的字段配一句解释。所以这里复用**已经存在且真实**的
 * `listSkills`，并按 `已启用` 过滤——服务端 `mountSkillToThread` 对非
 * `已启用` 一律 `SKILL_NOT_ENABLED`，前端这道过滤是**呈现**（不给用户摆一个
 * 点了必然失败的选项），不是权限判断的第二份副本。
 *
 * ## 界面不藏入口，也不复述权限
 *
 * 「谁能挂载」由服务端裁决（组员/组长一律 `MEMBER_CANNOT_SELF_MOUNT` + 写安全审计）。
 * 这里**不**按角色隐藏按钮：隐藏会让「界面没显示」被误读成「权限生效了」，
 * 而真正的越权是直调接口——那条路必须、且只能由服务端挡。被拒时如实显示原因。
 *
 * ## `mentionQuery` —— composer 里敲 `#` 的第二个入口，复用同一套状态
 *
 * 不给 `#` 单独写一条挂载逻辑（第二份 `version`/`mount()` 会和这里的互相踩，
 * 见 `one-serialization-layer-is-never-enough` 那类教训的镜像版：两份状态
 * 才是真正的风险源）。`chat-live-message-panel.tsx` 只负责**检测** `#query`
 * 并把它经由 `ChatReadScreen` 转发到这里；本组件把它当成「+」按钮的另一个
 * 触发源——打开同一个 `picking` 面板、按 `mentionQuery` 过滤同一个 `pool`、
 * 点的是同一个 `mount()`。`mentionQuery` 变回 `null`（用户删掉了 `#`/移开了光标）
 * 时若这次打开是由 mention 触发的，面板跟着关闭；`mount()` 成功且这次是
 * mention 触发时，额外调 `onMentionMounted`，让 composer 把 `#query` 从
 * 输入框正文里删掉——这是**唯一**跨组件的新增耦合面。
 */
export function ChatSkillMountPanel({
  threadId,
  projectId,
  orgId,
  bearer,
  mentionQuery,
  mentionTriggerChar = "#",
  onMentionMounted,
  onMountsChange,
  onMountsSnapshotChange,
  variant = "row",
  openRequest = 0,
  onTriggerStateChange,
}: {
  threadId: string;
  /**
   * 2026-09-02 composer 三层结构（人类最终裁决：技能恢复原样，只把入口搬进「+」菜单）：
   * - `"row"`（默认，旧轨道 `chat-read-screen.tsx`/`personal-chat-screen.tsx`）——
   *   composer 下方常驻一整条：标签 + 挂载 chip + 「加 skill」按钮，逐字节不变。
   * - `"composer"`（v2 composer）—— **触发器不在本组件里**：它是「+」菜单的一项，由
   *   调用方渲染（testid `chat-skill-mount` 与 `data-mounted-count` 跟着搬过去），通过
   *   `openRequest` 递增请求打开候选；本组件在第二行只渲染"偏离默认才露出"的东西——
   *   已挂载 chip（第 1 层状态 chip）、候选浮层与失败横幅（`absolute` 贴调用方的
   *   `relative` 容器向上开，与「+」菜单、能力浮层从同一个角落弹出）。`/` mention
   *   照旧走 `mentionQuery`。挂载/卸载逻辑与 testid 逐字不变，变的只是触发器住在哪。
   */
  variant?: "row" | "composer";
  /**
   * 单调递增的"请打开候选浮层"信号（仅 `variant="composer"`）。调用方每次点菜单项
   * 就 +1；用计数而不是布尔，是因为"连点两次"必须两次都开得起来。初始值 0 不触发。
   */
  openRequest?: number;
  /**
   * 把"触发器该长什么样"回报给渲染它的调用方：能不能打开（乐观锁版本号读到之前
   * 拒绝盲写，与旧触发器自己的 `disabled` 判定同一条）、挂了几个、是否仍在读取。
   */
  onTriggerStateChange?: (state: { readonly canOpen: boolean; readonly mountedCount: number; readonly loading: boolean }) => void;
  /**
   * ⚠ **可选**：个人对话没有项目（人类 2026-08-21 裁决「个人对话必须要可以使用
   * 公共的 skills」）。#1693 起服务端已不把 `?projectId=` 当授权输入——授权从
   * 线程反推项目，所以这里缺省是安全的，不是把一道门关小了。
   */
  projectId?: string;
  orgId: string;
  bearer: string;
  /** `null`/`undefined` = composer 里没有活跃的 mention。 */
  mentionQuery?: string | null;
  /**
   * issue #2046（CK-P2）—— mention 提示里显示的触发符。旧轨道 composer 用 `#`
   * （缺省值，行为零变化）；CopilotKit v2 轨道 2026-08-25 人类裁决改用 `/`
   * （对齐 Claude Code 习惯）。只影响提示文案显示，检测规则在各自 composer 里，
   * 本面板不重复声明。
   */
  mentionTriggerChar?: "#" | "/";
  /** 由一次 mention 触发的挂载成功后调用——composer 借此清掉输入框里的 `#query`。 */
  onMentionMounted?: () => void;
  /**
   * issue #1803 gap #4 —— 把「本对话挂了几个 skill」转发给调用方，供
   * `ChatLiveMessagePanel` 的 longrun hint 判断措辞（不在那边重读一份挂载列表，
   * 单一事实源仍是这里的 `listThreadMounts`）。
   */
  onMountsChange?: (count: number) => void;
  /**
   * D5（chat-main-fidelity-rubric.md）—— 把完整挂载列表（含 `mountedAt`/`removedAt`
   * 时间窗）与已解析的 skill 名称一并转发，供 `ChatLiveMessagePanel` 按「某条消息
   * 发出那一刻哪个 skill 处于挂载状态」渲染身份行的 skill chip。
   *
   * ⚠ 不是转发「当前挂了什么」给消息用——历史消息发出时的挂载状态可能已经变化
   * （挂载会被摘除，`removedAt` 就是为此存在），单一事实源仍是这里的
   * `listThreadMounts`，本回调只是把已经读到的同一份数据**多转发一份**给需要
   * 按时间窗回查的调用方，不是第二次请求、不是第二份状态。
   */
  onMountsSnapshotChange?: (
    mounts: readonly ThreadSkillMount[],
    skillNames: ReadonlyMap<string, string>,
  ) => void;
}) {
  const [mounts, setMounts] = React.useState<readonly ThreadSkillMount[]>([]);
  /**
   * ⚠ 服务端下发的乐观锁版本号，**不在客户端拼**（契约 `listThreadDeviations.out.version`）。
   *   `null` = 还没读到 ⇒ **不提交**。用「读不到就传空串」兜底等于关掉乐观锁，
   *   而关掉之后两个人同时改同一条对话的挂载列表会静默互相覆盖（E5/V8）。
   */
  const [version, setVersion] = React.useState<string | null>(null);
  const [pool, setPool] = React.useState<readonly SkillListItem[]>([]);
  /*
    issue #1803 gap #3（devapp 实测）——这个候选面板与 `AgentPicker`（运行 Agent
    下拉）此前是两个互不相知的私有 `useState<boolean>`，先开一个不关、再开另一个
    会同屏叠在一起。换成 `useChatPopoverSlot`：谁开谁抢占共享的 `activeId`，
    原来开着的那个自动读到 `open === false`。找不到 Provider 时退化为本地
    state（不炸，也不互斥），详见 `chat-popover-coordinator.tsx` 文件头注释。
  */
  const [picking, setPicking] = useChatPopoverSlot("chat-skill-mount");
  const [loading, setLoading] = React.useState(true);
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);
  const generation = React.useRef(0);
  /** 这一次打开是不是由 composer 的 `#` 触发的——决定 `mentionQuery` 归 null 时要不要自动关面板。 */
  const mentionOpenedRef = React.useRef(false);
  /**
   * 同类空缺（`AgentPicker`/`chat-composer-pickers.tsx` issue #1803 gap #2 已经
   * 修过的那个）：这个候选面板此前只有触发按钮/候选项/「取消」自己的 onClick
   * 能关它，没有 outside-click / Escape——用户点面板外任何地方、或按 Esc，
   * 面板纹丝不动，只能精确点中小小的「取消」按钮，不符合标准下拉交互预期
   * （2026-09-01 devapp 实测反馈："skill panel can't be closed"）。仿
   * `AgentPicker` 同一套写法：`containerRef` + `document.addEventListener`。
   */
  const containerRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (!picking) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setPicking(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPicking(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [picking, setPicking]);

  const reload = React.useCallback(async () => {
    const requestGeneration = ++generation.current;
    setLoading(true);
    setFailure(null);
    try {
      const view = await listThreadMounts(threadId, projectId, bearer);
      if (generation.current !== requestGeneration) return;
      setMounts(view.temporary);
      setVersion(view.version);
    } catch (error) {
      if (generation.current !== requestGeneration) return;
      setFailure(describeMessageFailure(error, "读取本对话已挂载的 skill"));
    } finally {
      if (generation.current === requestGeneration) setLoading(false);
    }
  }, [bearer, projectId, threadId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  React.useEffect(() => {
    onMountsChange?.(mounts.length);
  }, [mounts.length, onMountsChange]);

  React.useEffect(() => {
    if (!onMountsSnapshotChange) return;
    const names = new Map(pool.map((item) => [item.skillId, item.name] as const));
    onMountsSnapshotChange(mounts, names);
  }, [mounts, pool, onMountsSnapshotChange]);

  /**
   * ⚠ 挂载态要显示**名称**，而名称只存在于 `pool`（`listSkills`）里——而 `pool`
   * 原本只在点开候选器时才加载。后果很隐蔽：刚挂完能看到名字（那时 pool 在手），
   * **刷新页面后又退回一串 `sk_…` UUID**，因为没人点过候选器。
   *
   * 所以「有挂载但池子是空的」时补读一次。⚠ 读失败**不设 failure**：名字只是显示
   * 增强，拿不到就回落显示 id（见下方 `named`），不该让一条读失败把整个挂载栏
   * 变成错误态——挂载本身是好的。
   */
  React.useEffect(() => {
    if (mounts.length === 0 || pool.length > 0 || !orgId) return;
    let alive = true;
    void (async () => {
      try {
        const items = await listSkills(orgId);
        if (alive) setPool(items.filter((item) => item.status === "已启用"));
      } catch {
        /* 名字拿不到就显示 id，不打断挂载栏 */
      }
    })();
    return () => { alive = false; };
  }, [mounts.length, pool.length, orgId]);

  const openPicker = async (openedByMention: boolean) => {
    mentionOpenedRef.current = openedByMention;
    setPicking(true);
    setFailure(null);
    try {
      const items = await listSkills(orgId);
      setPool(items.filter((item) => item.status === "已启用"));
    } catch (error) {
      setFailure(describeMessageFailure(error, "读取可挂载的 skill"));
    }
  };

  /**
   * `#` 触发：一旦 composer 报来一个非 null 的 query，就把它当成「+」被点了一次
   * ——只在**从 null 变成非 null**那一刻打开，避免每敲一个字符都重新 `openPicker`
   * （`pool` 只需要读一次，过滤是纯前端字符串匹配）。
   */
  React.useEffect(() => {
    if (mentionQuery === undefined || mentionQuery === null) {
      if (mentionOpenedRef.current) {
        // 用户删掉了 `#` 或把光标移开——这次面板是 mention 开的，跟着关掉；
        // 手动点「+」开的面板不受 mentionQuery 变化影响。
        mentionOpenedRef.current = false;
        setPicking(false);
      }
      return;
    }
    if (!picking) void openPicker(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionQuery]);

  const visiblePool = mentionQuery ? pool.filter((item) => item.name.includes(mentionQuery)) : pool;

  /** `openRequest` 变化 ⇒ 打开一次（见该 prop 头注）。 */
  const lastOpenRequestRef = React.useRef(openRequest);
  React.useEffect(() => {
    if (openRequest === lastOpenRequestRef.current) return;
    lastOpenRequestRef.current = openRequest;
    void openPicker(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  React.useEffect(() => {
    onTriggerStateChange?.({ canOpen: !pending && version !== null, mountedCount: mounts.length, loading });
  }, [onTriggerStateChange, pending, version, mounts.length, loading]);

  /**
   * issue #1803 gap #9（人类 2026-08-22 devapp 真实浏览器实测）——此前浮层要等
   * `mountSkills` 网络往返真的返回才 `setPicking(false)`。网络稍有延迟时，
   * 用户点完候选项看不到任何即时反馈（面板照样开着、选项因 `pending` 变灰），
   * 容易怀疑"是不是没点中"而去点别处强行关闭，或在等待期间又点了别的候选项
   * （`pending` 挡得住这一下，但体验上已经是"看起来卡住了"）。
   *
   * 改成**乐观关闭**：点击候选项这一刻就收起浮层（不等网络结果）；一旦
   * `mountSkills` 真的失败，再把浮层**重新打开**并展示错误——用户不会因为
   * 一次静默失败就以为挂载已经生效，仍然能看到错误、重试或换一个 skill。
   * 成功路径肉眼观感不变（面板本来就该关），失败路径从"面板全程不动"变成
   * "先关一下、失败后弹回来"，但错误信息与可重试性一个字节没丢。
   */
  const mount = async (skillId: string) => {
    if (version === null || pending) return;
    const viaMention = mentionOpenedRef.current;
    setPicking(false);
    setPending(true);
    setFailure(null);
    try {
      await mountSkills(threadId, projectId, { skillIds: [skillId], expectedVersion: version }, bearer);
      mentionOpenedRef.current = false;
      // 重读而不是把 POST 的回包拼进本地列表：版本号必须跟着一起更新，
      // 否则下一次挂载会拿着旧指纹去撞 409。
      await reload();
      if (viaMention) onMentionMounted?.();
    } catch (error) {
      // 失败：把浮层重新打开，让用户看到错误、可以重试或换一个 skill——
      // 不是"乐观关闭"就意味着失败也悄悄放过。
      setPicking(true);
      setFailure(describeMessageFailure(error, "挂载 skill"));
    } finally {
      setPending(false);
    }
  };

  const unmount = async (mountId: string) => {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      await unmountSkill(threadId, mountId, projectId, bearer);
      await reload();
    } catch (error) {
      setFailure(describeMessageFailure(error, "卸载 skill"));
    } finally {
      setPending(false);
    }
  };

  /** 挂载态一个 chip。 */
  const mountedChip = (entry: ThreadSkillMount) => {
    /*
      ⚠ 显示「名称」，不是 `skillId`。名字本来就在手边——`pool` 里的
      `item.name` 正是候选列表显示的那一份。此前挂载后退回显示
      `sk_9c652f24-…` 这样的 UUID，等于用户选完就不知道自己挂的是什么，
      而且两条并排时肉眼几乎无法区分（都以 `sk_` 开头）⇒ 误卸载风险。

      ⚠ 读不到名字时「回落到 id」，不显示「未知 skill」：挂载列表与候选池
      是两次独立的读，池子还没到（或该 skill 已不在可见范围）时，
      一个真实的 id 比一个编出来的占位词更有用。
    */
    const named = pool.find((s) => s.skillId === entry.skillId)?.name ?? entry.skillId;
    return (
      <span
        key={entry.mountId}
        className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted/40 py-0.5 pl-2 pr-0.5"
        data-testid={`chat-skill-mounted-${entry.skillId}`}
        title={`skill id：${entry.skillId}`}
      >
        <span className="text-11 text-foreground">{named}</span>
        {/*
          FB-2 —— 对「这个 skill 本身」提反馈。挂在挂载态的 chip 上而不是选择器里：
          有意见的前提是用过它，而选择器里的那些还没被用过。
          传的是真实 `skillId`（不是版本 id）——见契约 `FeedbackTarget` 里
          「skill 只带 skillId，不带 skillVersionId」那条注释。
          ⚠ `targetLabel` 传名字：它会进反馈弹层的标题，UUID 对提交反馈的人没有意义。
        */}
        <FeedbackButton
          target={{ kind: "skill", skillId: entry.skillId }}
          targetLabel={named}
          testid={`chat-skill-feedback-${entry.skillId}`}
        />
        {/*
          ⚠ 只留图标、去掉「卸载」二字：此前同一个动作有 `✕` 和「卸载」两个
          可点区域，占双倍宽度却不增加信息。语义交给 `aria-label` / `title`，
          不靠可见文字撑——屏幕阅读器读得到，视觉上不再重复。
        */}
        <Button
          size="xs"
          variant="ghost"
          className="h-5 w-5 rounded-full p-0"
          disabled={pending}
          aria-label={`卸载 ${named}`}
          title={`卸载 ${named}`}
          data-testid={`chat-skill-unmount-${entry.skillId}`}
          onClick={() => void unmount(entry.mountId)}
        >
          <X aria-hidden className="h-3 w-3" />
        </Button>
      </span>
    );
  };

  /** 挂载候选浮层——常驻在 composer 下方整条内，不是 `absolute` 覆盖层。 */
  const headless = variant === "composer";

  const picker = picking ? (
    <div
      className={
        headless
          ? "absolute bottom-full left-0 z-20 mb-1.5 flex w-72 flex-col gap-0.5 rounded-lg border border-border bg-popover p-1.5 shadow-md"
          : "flex flex-wrap items-center gap-1.5 rounded-md border border-border p-2"
      }
      data-testid="chat-skill-mount-picker"
    >
      {mentionQuery ? (
        <span className="px-1.5 text-9 text-muted-foreground" data-testid="chat-skill-mount-mention-hint">
          {mentionTriggerChar} {mentionQuery}
        </span>
      ) : null}
      {pool.length === 0 ? (
        <span className="px-1.5 py-1 text-11 text-muted-foreground" data-testid="chat-skill-mount-pool-empty">
          本组织没有「已启用」的 skill 可挂载。
        </span>
      ) : visiblePool.length === 0 ? (
        <span className="px-1.5 py-1 text-11 text-muted-foreground" data-testid="chat-skill-mount-mention-no-match">
          没有名字含「{mentionQuery}」的已启用 skill。
        </span>
      ) : headless ? (
        // 竖排列表：名字 + 真实 `duty`（与「浏览 skill」页同一字段），选错了才知道是什么的
        // 横排小按钮不适合"敲 / 快速挑"这个场景（2026-08-30 人类反馈）。
        visiblePool.map((item) => (
          <button
            key={item.skillId}
            type="button"
            disabled={pending}
            data-testid={`chat-skill-mount-option-${item.skillId}`}
            onClick={() => void mount(item.skillId)}
            className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors duration-fast hover:bg-muted disabled:text-disabled-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate text-11 font-medium text-card-foreground">{item.name}</span>
            <span className="line-clamp-1 text-10 text-muted-foreground">
              {item.duty.trim() || "这个 skill 还没有填写说明"}
            </span>
          </button>
        ))
      ) : (
        visiblePool.map((item) => (
          <Button
            key={item.skillId}
            size="xs"
            variant="outline"
            disabled={pending}
            data-testid={`chat-skill-mount-option-${item.skillId}`}
            onClick={() => void mount(item.skillId)}
          >
            {item.name}
          </Button>
        ))
      )}
      <Button
        size="xs"
        variant="ghost"
        data-testid="chat-skill-mount-cancel"
        onClick={() => setPicking(false)}
      >
        取消
      </Button>
    </div>
  ) : null;

  /** 失败横幅。 */
  const failureBanner = failure ? (
    <div
      className={
        headless
          ? "absolute bottom-full left-0 z-20 mb-1.5 flex w-64 items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 shadow-md"
          : "flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2"
      }
      data-testid="chat-skill-mount-failure"
    >
      <p className="text-11 text-destructive">{failure}</p>
      <Button size="xs" variant="outline" data-testid="chat-skill-mount-retry" onClick={() => void reload()}>
        <RefreshCw aria-hidden className="h-3 w-3" />重试
      </Button>
    </div>
  ) : null;

  if (headless) {
    // 触发器在「+」菜单里（见 `variant` 头注）。这里只有已挂载 chip + 浮层；没挂任何
    // skill 且浮层没开时零尺寸——e2e 判"面板已就位"用 `toBeAttached()`。
    return (
      <div
        ref={containerRef as unknown as React.RefObject<HTMLDivElement>}
        className="flex min-w-0 flex-wrap items-center gap-1"
        data-testid="chat-skill-mount-panel"
        data-mounted-count={mounts.length}
      >
        {mounts.map(mountedChip)}
        {picker}
        {failureBanner}
      </div>
    );
  }

  return (
    <section
      ref={containerRef}
      className="flex flex-col gap-2 border-t border-border px-4 py-2"
      data-testid="chat-skill-mount-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-11 text-muted-foreground">
          <Wrench aria-hidden className="h-3 w-3" />本对话的 skill
        </span>

        {loading ? (
          <span className="text-11 text-muted-foreground" data-testid="chat-skill-mount-loading">
            正在读取…
          </span>
        ) : mounts.length === 0 ? (
          // ⚠ 真实空态。这里**不**塞任何示例 skill（契约 A1/V10）。
          <span className="text-11 text-muted-foreground" data-testid="chat-skill-mount-empty">
            还没有挂载任何 skill
          </span>
        ) : (
          mounts.map(mountedChip)
        )}

        <Button
          size="xs"
          variant="outline"
          className="ml-auto"
          /** ⚠ 版本号读不到就不给提交入口——不是禁用「挂载」这个能力，是拒绝盲写。 */
          disabled={pending || version === null}
          data-testid="chat-skill-mount"
          onClick={() => void openPicker(false)}
        >
          <Plus aria-hidden className="h-3 w-3" />加 skill
        </Button>
      </div>

      {picker}
      {failureBanner}
    </section>
  );
}
