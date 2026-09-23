"use client";
import * as React from "react";
import { ArrowLeft, Send, Check, CheckCircle2, Upload, Loader2, PlugZap, Crosshair, X, History, LayoutGrid, Smartphone, MessageSquareText, Play, Import, Plus, Copy, Trash2, Undo2, Share2, Layers, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api-client";
import { LinkBadge } from "./badges";
import { PrototypeCanvas, deviceOf, DEVICE_PRESETS, presetById, rotated, fitScale } from "./prototype-canvas";
import { PrototypeHistoryPanel } from "./prototype-history";
import { PrototypeLayers } from "./prototype-layers";
import { duplicateOps, moveOps, navigate, stripIds } from "@/lib/prototype-node-actions";
import { changedNodeIds } from "@/lib/prototype-diff";
import { RefImageStrip } from "./ref-image-strip";
import { ImportThreadDialog } from "./import-thread-dialog";
import { PrototypeBoard } from "./prototype-board";
import { PrototypeInspector } from "./prototype-inspector";
import { PrototypeExportMenu } from "./prototype-export";
import { ShareDialog } from "./share-dialog";
import { CanvasAppearance } from "./canvas-appearance";
import {
  appendProjectChat as apiAppendProjectChat,
  uploadRefImage,
  deleteRefImage,
  patchPrototype,
  listPrototypeVersions,
  restorePrototypeVersion,
  type PrototypePatchOp,
  updateProject,
  listMyProjects,
  pushToInbox as apiPushToInbox,
  publishProject as apiPublishProject,
  unpublishProject as apiUnpublishProject,
  DESIGN_WORKBENCH_CHAT_INTRO,
  DESIGN_WORKBENCH_STARTERS,
  findPrototypeNodePath,
  prototypeNodeLabel,
  type DesignProject,
  type DesignChatFallbackReason,
  type DesignWritebackField,
  type PrototypeLink,
  type PrototypeVersion,
  type PrototypeAccent,
  PROJECT_TEMPLATE_LABEL,
  type ProjectTemplate,
  type DesignShareScope,
} from "@/lib/live-design-workbench";
import { designWorkbench } from "@repo/contracts";
import { describeFailure } from "@/lib/design-failure";
import { humanTime } from "@/lib/human-time";


/**
 * 2026-09-07：退路原因 → 人话。键集合来自契约闭集 `DesignChatFallbackReason`（穷举，
 * 漏一个编译不过），不另抄一份，也不透传服务端异常细节。
 */
const FALLBACK_REASON_TEXT: Record<DesignChatFallbackReason, string> = {
  MODEL_NOT_CONFIGURED: "这个部署还没配置 AI 模型，画布生成用不了——需要运维在部署配置里补上模型 provider。",
  MODEL_CALL_FAILED: "调用 AI 模型失败（网络或鉴权）。可以重试一次；一直失败就让运维看部署日志。",
  MODEL_TIMEOUT: "这次画的东西太大，AI 没能在时限内画完。试试少要几页、或把要求说得更具体一点再发一次。",
  MODEL_EMPTY_OUTPUT: "AI 模型这次返回了空结果。换个说法再试一次通常就好了。",
  MODEL_BAD_JSON: "AI 这次的输出不是有效的格式，画布没有更新。换个说法再试一次通常就好了。",
  MODEL_OUTPUT_TRUNCATED: "AI 这次没说完就被长度截断了。已经画好的页留着了——没画完的那页可以单独重试，或者把要求拆小一点。",
  MODEL_NO_REPLY_TEXT: "AI 模型这次没给出可用的回复文本；如果画布有变化，那部分已经生效。",
};

/** B5.2：`reply.applied` 的展示文案——键集合来自契约枚举，不另抄一份。 */
const WRITEBACK_LABEL: Record<DesignWritebackField, string> = {
  problem: "背景",
  criteria: "验收标准",
  frames: "画布页",
  prototype: "原型画布",
};

/**
 * 迭代 16（#3773 R2）：生成期间多久读一次项目。
 * 2.5s——比单页生成快得多（一页十几到几十秒），又不至于把列表接口打成心跳。
 */
const GENERATION_POLL_MS = 2500;

/** 改动高亮亮多久（毫秒）。够看清一眼，又不至于变成一个常驻状态。 */
const CHANGED_HIGHLIGHT_MS = 6000;
/** 共用同一个空集：每次渲染新建一个会让画布的 context 每帧都变。 */
const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * 迭代 16（#3773 R7）：刚建好的项目自动发的第一句话。
 *
 * 不重复背景内容——服务端每一轮都带着 `problem`、`criteria` 和澄清问答的结果，
 * 再抄一遍只会把同一件事说两遍。这句话只说"开始"。
 */
const AUTO_FIRST_PROMPT = "按我写的背景和验收标准，画第一版原型。";

/* ── 迭代 17：强调色档位的展示层元数据。**取值闭集来自契约**，这里不另立一份枚举。 ── */
const ACCENT_OPTIONS = designWorkbench.PrototypeAccent.options;
const ACCENT_LABEL: Record<PrototypeAccent, string> = {
  neutral: "不用强调色（中性灰）", blue: "靛蓝", violet: "紫", teal: "青",
  green: "绿", amber: "琥珀", rose: "玫红", slate: "石板灰",
};
/**
 * 选择器上那个小圆点用哪一套值。
 *
 * ⚠ 固定取 `dark` 那一套，**不跟着项目主题变**：这一排按钮长在深色的工具条上，
 * 跟着项目主题切会让做浅色稿时一排色点全部压暗，在深色工具条上糊成一片——
 * 那时它标的就不再是"这个档位长什么样"，而是"这个档位在别处长什么样"。
 */
const ACCENT_SWATCH: Record<Exclude<PrototypeAccent, "neutral">, string> = Object.fromEntries(
  Object.entries(designWorkbench.PROTOTYPE_ACCENTS).map(([k, v]) => [k, v.dark.primary]),
) as Record<Exclude<PrototypeAccent, "neutral">, string>;

/**
 * 迭代 16（#3773 R8）：哪些退路原因值得给一个「再试一次」。
 *
 * ⚠ `MODEL_NOT_CONFIGURED` **不在**这里：这个部署根本没配模型，重试一百次也一样，
 *   给一个必然失败的按钮是在骗人。那一条的下一步是找运维，文案里已经说了。
 * `MODEL_NO_REPLY_TEXT` 也不在：写回可能已经生效了，重发同一句会再改一遍。
 */
/**
 * 迭代 20：「少画几页再试」按几页。
 *
 * 3 是骨架轮页数区间（3–6）的下限——再少就不是"这个产品长什么样"而是一张孤立的屏了。
 * 这个数会作为 `maxScreens` 交上去，由服务端**截断执行**，不是一句提示。
 */
const FEWER_PAGES_CAP = 3;

/** 迭代 30：一句话的字数上限。取自契约单源，不在这里抄第二个 4000。 */
const MAX_CHARS = designWorkbench.DESIGN_TEXT_MAX_CHARS;

const RETRYABLE_FALLBACK: ReadonlySet<DesignChatFallbackReason> = new Set([
  "MODEL_CALL_FAILED", "MODEL_TIMEOUT", "MODEL_EMPTY_OUTPUT", "MODEL_BAD_JSON", "MODEL_OUTPUT_TRUNCATED",
]);

const TEMPLATE_LABEL = PROJECT_TEMPLATE_LABEL;

type Load =
  | { kind: "loading" }
  | { kind: "ready"; project: DesignProject }
  | { kind: "missing" }
  | { kind: "failed"; reason: string };

/**
 * PM 设计详情全屏页（Claude Code 风格深色 IDE）。
 * 用 `.dark` 强制深色 token 体系（app/globals.css 的 `.dark` 那份），不另立颜色。
 * 脱离后台三栏骨架：整屏铺满。
 *
 * UC-17.8 B4.5 —— **真栈**（契约 `designWorkbench`）。切自原型 mock store（已于 B6.1 删除）
 * 的本地 mock。
 *
 * ## 这一屏刻意的几个设计取舍
 *
 *   · **没有单条 `getProject` 契约操作，用 `listMyProjects()` 后按 `id` 客户端查找**——
 *     见 `lib/live-design-workbench.ts` 文件头。找不到这条 id（已删除/属于另一组织）时
 *     渲染既有的「找不到这个设计项目」态，不是把它当网络失败处理。
 *   · **对话面板发消息是真实 `appendProjectChat` 往返**：发送后用服务端返回的
 *     `project.chat`（用户消息 + AI 回复两条一起写入；UC-17.8 B5.2 起回复由模型生成、
 *     模型不可用时退回固定回执并标 `source: "fallback"`）整体替换本地 `chat`，
 *     `reply.applied` 非空时在最后一条 AI 气泡下显示「已更新：…」（模型写回了 `problem`/
 *     `criteria`/`frames`，右侧说明页/画布标签随返回的 `project` 一起变），
 *     不本地拼接乐观消息——服务端在同一次调用里原子写两条，本地拼接容易和它对不上
 *     （比如失败重试会拼出重复的用户消息）。发送中禁用输入框，失败恢复文本框内容
 *     以便重试，不清空用户刚打的字。
 *   · **推送成功页两个出口读真实 id**（backlog B4.5 原文）：`inboxCode` 来自
 *     `pushToInbox` 的真实返回值，不再是本地 mock 生成的 `D-` 编号；「继续设计下一个」
 *     不带 code，只是导航——出口本身不需要 code，是这条路径本来就没有引用它。
 */
export function DesignDetailScreen({
  projectId,
  autoStart = false,
  onBack,
  onOpenInbox,
  onNextDesign,
}: {
  projectId: string;
  /**
   * 迭代 16（#3773 R7）：这是**刚建好**的项目，进来就照背景画第一版。
   * 由创建流程跳转时带上（`?new=1`），不是每次打开详情页都成立——见 `autoStartedRef` 那段。
   */
  autoStart?: boolean;
  onBack?: () => void;
  onOpenInbox?: () => void;
  onNextDesign?: () => void;
}) {
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [tab, setTab] = React.useState<"canvas" | "spec">("canvas");
  const [frame, setFrame] = React.useState(0);
  const [text, setText] = React.useState("");
  /** 迭代 30：超了就不让发——服务端一定会拒，让用户白等一次往返没有意义。 */
  const overLimit = text.length > MAX_CHARS;
  const [sending, setSending] = React.useState(false);
  const [chatError, setChatError] = React.useState<string | null>(null);
  /** 迭代 7：进行中的请求（可取消）、已等待秒数、上一句失败时留下的原文（供「重试」）。 */
  const abortRef = React.useRef<AbortController | null>(null);
  const [elapsed, setElapsed] = React.useState(0);
  const [retryText, setRetryText] = React.useState<string | null>(null);
  /** B5.2：最近一轮模型回复写回了哪些字段（`reply.applied`）——挂在最后一条 AI 气泡下方，发下一句时清掉。 */
  const [lastApplied, setLastApplied] = React.useState<readonly DesignWritebackField[]>([]);
  /**
   * 2026-09-07：最近一轮退路的原因（`reply.fallbackReason`）。屏上必须说清"没配模型"
   * 与"调用失败"的区别——用户实测时只看到一句"稍后会更新画布"，等了很久才发现根本
   * 没有东西在生成。
   */
  const [fallbackReason, setFallbackReason] = React.useState<DesignChatFallbackReason | null>(null);
  /**
   * 迭代 27：**中性通知**，与红色的 `chatError` 分开。
   *
   * 取消不是错误——把它塞进那条红带子，等于告诉用户他刚做错了一件事。
   * 但也不能什么都不说（见 `send` 里取消分支的注释）：已经画好的页留着了、服务端那一次
   * 可能还在跑完，这两件事只有系统知道。
   */
  const [notice, setNotice] = React.useState<string | null>(null);
  /** 迭代 9：最近一轮模型给的下一步建议（`reply.suggestions`），挂在最后一条 AI 气泡下，点一下即发。 */
  const [suggestions, setSuggestions] = React.useState<readonly string[]>([]);
  /** 迭代 2：画布上选中的节点 id——发消息时随 `focusNodeId` 一起发，模型优先针对它改。 */
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  /** 迭代 3：版本历史面板开关 + 正在预览的旧版本（画布临时显示它的树，不写库）。 */
  const [historyOpen, setHistoryOpen] = React.useState(false);
  /** 迭代 4：画布视图——「画板」把所有页并排铺开可平移缩放（默认），「单页」只看当前页。 */
  const [viewMode, setViewMode] = React.useState<"board" | "single">(
    () => (typeof window !== "undefined" && window.innerWidth < 768 ? "single" : "board"),
  );
  /**
   * 迭代 11（design-delta `prototype-navigation`，待签核）：编辑 / 预览。预览下点有跳转的节点 = 换页，
   * 没跳转的节点点了没反应也不选中；属性面板与焦点 chip 收起（预览不是编辑）。
   */
  const [canvasMode, setCanvasMode] = React.useState<"edit" | "preview">("edit");
  /*
   * 迭代 26：**窄屏默认单页**。
   *
   * 画板（所有页并排）在手机上会被"适应"到 20% 上下——三台指甲盖大小的手机，里面一个字
   * 都读不出来。那是"我的原型长什么样"这个问题的最差答案，而它偏偏是第一眼。
   * md 及以上仍然默认画板（那里三页并排正是它的价值）。
   *
   * 只在挂载时判一次：之后用户自己切过的选择不该因为转屏被冲掉。
   */
  /**
   * 迭代 16（#3773 R6）—— 预览模式的**返回栈**。
   *
   * 预览的承诺是「像用真的 App 一样走一遍」，而真的 App 里每一次跳转都能退回来。
   * 在这之前点进详情页就只能靠上面那排页签自己跳回去——那是设计稿的操作，不是用 App
   * 的操作，走两层就断了，于是"走一遍主流程"这件事根本走不完。
   *
   * 栈只在预览态存在：退出预览时清掉（回到编辑态再点页签是"我要看这一页"，不是"后退"）。
   */
  const [backStack, setBackStack] = React.useState<readonly number[]>([]);
  /** 预览里的一次跳转：记下从哪来，再换页。 */
  const navigateTo = React.useCallback((to: number) => {
    setBackStack((prev) => [...prev, frame].slice(-50));
    setFrame(to);
  }, [frame]);
  const goBack = React.useCallback(() => {
    setBackStack((prev) => {
      const last = prev[prev.length - 1];
      if (last === undefined) return prev;
      setFrame(last);
      return prev.slice(0, -1);
    });
  }, []);
  /**
   * 迭代 14：预览用的**镜头**——设备预设与横竖。刻意**不写库**：它是"我现在用什么尺寸看"，
   * 不是"这稿是给什么设备的"（后者由项目 template 决定，见 `lib/prototype-devices` 头注）。
   * `null` = 跟随项目模板的默认镜头；用户切过之后才有值。
   */
  const [deviceId, setDeviceId] = React.useState<string | null>(null);
  const [landscape, setLandscape] = React.useState(false);
  const [preview, setPreview] = React.useState<PrototypeVersion | null>(null);
  const [stage, setStage] = React.useState({ w: 0, h: 0 });
  /**
   * 迭代 13（delta §2）：「从对话导入」弹窗。**不确认不写**——弹窗自己只在确认那一步
   * 才调写入，这里拿到的 `project` 已经是写入之后的那一份（见 `import-thread-dialog.tsx`）。
   */
  const [importing, setImporting] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  /** 迭代 22：发布与分享。 */
  const [sharing, setSharing] = React.useState(false);
  /** 迭代 24：窄屏下右侧那栏（图层 / 属性 / 历史）要不要展开；md 及以上恒展开，见渲染处。 */
  const [sideOpen, setSideOpen] = React.useState(false);
  const [shareBusy, setShareBusy] = React.useState(false);
  const [shareError, setShareError] = React.useState<string | null>(null);
  const [pushBusy, setPushBusy] = React.useState(false);
  const [pushError, setPushError] = React.useState<string | null>(null);
  const [pushed, setPushed] = React.useState<{ project: DesignProject; code: string } | null>(null);
  const chatRef = React.useRef<HTMLDivElement>(null);
  /**
   * 迭代 16（#3773 R7）—— **刚建好的项目自动画第一版**，不让用户把刚说过的话再说一遍。
   *
   * 在这之前的路径是：新建 → 回答六个澄清问题 → 写背景 → 进详情页 → **画布是空的**，
   * 还要在左边再描述一遍要什么，才开始画。用户刚刚才把这个产品讲了一遍，进来看到的
   * 却是一句「在左边描述你要的界面」——这一步纯粹是让他重说，是「基本上不能用」里
   * 最没道理的一段摩擦。
   *
   * 触发条件四条**同时**成立，缺一不可：
   *   ① 调用方明确说了这是**刚建好**的项目（`autoStart`，由创建流程跳转时带上）。
   *      ⚠ 这一条最重要：只看"没有原型 + 没说过话"的话，半年前建了没画的老项目
   *      被打开时也会自动跑起来——替用户花掉一次生成，他没要过。
   *   ② 还没有任何原型（不覆盖已有的画布）；
   *   ③ 用户一句话都还没说过（`chat` 里没有 `user` 轮——导入留痕是 `system`，不算）；
   *   ④ 背景非空（没有背景就真的无从画起，那时候该让他先说）。
   * 并且**每个项目只自动发一次**（`autoStartedRef` 按 id 记），失败也不重试——
   * 自动重试会让一个必然失败的请求在用户面前反复跑。
   */
  const autoStartedRef = React.useRef<string | null>(null);
  /**
   * 迭代 16（#3773 R2）——**生成期间轮询项目，画布一页页长出来**。
   *
   * 首次生成要画 3–6 页、每页一次模型调用，最坏几分钟。在这之前这段时间里屏上只有
   * 一个转圈、画布全程空白，用户没法判断是在画还是已经死了——这是「基本上不能用」
   * 最大的一处来源。服务端现在每定下骨架、每画好一页就落一次库（`append-project-chat.ts`
   * 的 `persistProgress`），这里在同一轮请求还没返回时把它读出来。
   *
   * ⚠ 轮询结果**不许盖掉最终结果**：`send` 在写最终 `project` 之前先 `stopPoll()`，
   *   而每个 tick 落地前再查一次 `pollRef.current !== null`。少了后面那道，
   *   一个在途的 tick 会在收尾之后把画布退回上一帧。
   * ⚠ 只更新**画布相关**的事实。`chat` 这时候服务端还没写（它在收尾时才追加两条），
   *   整份替换正好也把 chat 保持在"还没有这一轮"的状态，与实际一致。
   */
  const pollRef = React.useRef<number | null>(null);
  /**
   * 迭代 16（#3773 R5）：这一轮模型改动过的节点 id，画布上给一圈虚线。
   *
   * 几秒之后自动清掉——它说的是"刚刚"，不是一个持续状态。留着不清会让用户下一次
   * 打开项目时看到一圈莫名其妙的高亮，而那时"刚刚"早已过去。
   */
  const [changed, setChanged] = React.useState<ReadonlySet<string>>(EMPTY_SET);
  const changedTimer = React.useRef<number | null>(null);

  const reload = React.useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const { items } = await listMyProjects();
      const found = items.find((p) => p.id === projectId) ?? null;
      setLoad(found === null ? { kind: "missing" } : { kind: "ready", project: found });
    } catch (err) {
      setLoad({ kind: "failed", reason: describeFailure(err) });
    }
  }, [projectId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const project = load.kind === "ready" ? load.project : null;
  /**
   * 迭代 16（#3773 R2）：这一轮**真实**画到第几页。`null` = 还没有骨架（无事可报）。
   * 只在生成中有意义——不在生成中时画布本来就是最终状态，报进度只会让人以为还在跑。
   */
  /** 迭代 16（#3773 R8）：最后一句**用户**说的话——退路重试要原样重发它。 */
  const lastUserText = React.useMemo(() => {
    const turns = project?.chat ?? [];
    for (let i = turns.length - 1; i >= 0; i -= 1) if (turns[i]?.role === "user") return turns[i]!.text;
    return null;
  }, [project]);
  const drawnPages = React.useMemo(() => {
    if (project === null || project.prototype.length === 0) return null;
    const total = project.prototype.length;
    const done = project.prototype.filter((r) => r !== null).length;
    return done >= total ? null : { done, total };
  }, [project]);
  /** 迭代 14：当前镜头 = 用户选的，没选过就跟项目模板走。 */
  const lens = deviceId === null ? deviceOf(project?.template ?? "mobile") : presetById(deviceId);
  const lensSize = rotated(lens, landscape);
  /* `- 32` 是单页视图那层 `p-4` 的左右内边距：量的是外栏，可用空间要把它扣掉。 */
  const scale = fitScale({ w: Math.max(0, stage.w - 32), h: Math.max(0, stage.h - 32) }, { w: lensSize.w, h: lensSize.h + 40 });
  // 迭代 2：选中节点在当前树里的路径；节点被上一轮删掉/整页重生成后找不到 ⇒ 视为未选中（不留悬空引用）。
  const focus = React.useMemo(
    () => (project !== null && selectedId !== null && canvasMode === "edit" ? findPrototypeNodePath(project.prototype, selectedId) : null),
    [project, selectedId, canvasMode],
  );
  /** 迭代 11：每页出发的跳转表（服务端接线前可能没有 ⇒ 空）。 */
  // 预览旧版本时不画连线：版本快照里还没有 links（存储形状是 delta §5 要人类拍板的取舍 ②）。
  const frameLinks = React.useMemo(() => (preview === null ? project?.frameLinks : undefined) ?? [], [preview, project]);
  /**
   * 迭代 11：属性面板改跳转目标 ⇒ 发一条 `setLinks`（delta §3）——**与模型走同一条写回路径**
   * （I-11），所以人手连的线同样会过 `validateLinks`、同样记一条 `user` 版本。
   * 失败不吞：把服务端的拒绝原因交给属性面板显示（它已有 `REJECT_TEXT` 那套人话映射）。
   */
  const setPageLinks = async (pageIndex: number, links: readonly PrototypeLink[]) => {
    if (project === null) return;
    const out = await patchPrototype(project.id, [{ op: "setLinks", screen: pageIndex, links: [...links] }], "改了跳转");
    setLoad({ kind: "ready", project: out.project });
  };

  /**
   * 迭代 15：节点动作的**唯一入口**。属性面板的按钮、图层面板、键盘快捷键都调它，
   * 三处不各写一遍"复制是什么意思"（op 怎么算见 `lib/prototype-node-actions`）。
   * 走的是与模型写回同一条 `patchPrototype`（I-11）。
   */
  const runNodeOps = async (ops: readonly PrototypePatchOp[] | null, summary: string) => {
    if (project === null || ops === null || ops.length === 0) return;
    try {
      const out = await patchPrototype(project.id, [...ops], summary);
      setLoad({ kind: "ready", project: out.project });
    } catch (err) {
      setChatError(`没能${summary}（${describeFailure(err)}）`);
      window.setTimeout(() => setChatError(null), 3000);
    }
  };

  /**
   * 迭代 16：页级动作。契约的 `addScreen`/`removeScreen` 从迭代 12 起就在，
   * 但**从来没有 UI 够得着**——模型能加删页，用户不能。这里接上。
   * 与节点动作共用 `runNodeOps`：同一条 patchPrototype，同一套失败提示。
   */
  const pageCount = project?.frames.length ?? 0;
  const addPage = () => void runNodeOps(
    [{ op: "addScreen", at: frame + 1, frame: `新页面 ${pageCount + 1}` }], "加一页",
  ).then(() => setFrame(frame + 1));
  const duplicatePage = () => {
    const root = project?.prototype[frame];
    void runNodeOps(
      // 复制整页要**去掉树里的 id**，理由同复制节点：id 项目内唯一，
      // 带原 id 插进去会造出两页同 id 的节点，之后按 id 寻址一律命中第一页。
      [{ op: "addScreen", at: frame + 1, frame: `${project?.frames[frame] ?? "页面"} 副本`,
         ...(root === undefined || root === null ? {} : { root: stripIds(root) }) }],
      "复制这一页",
    ).then(() => setFrame(frame + 1));
  };
  const removePage = () => void runNodeOps(
    [{ op: "removeScreen", screen: frame }], "删掉这一页",
  ).then(() => setFrame(Math.max(0, frame - 1)));
  const renamePage = (name: string) => {
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === project?.frames[frame]) return;
    void runNodeOps([{ op: "renameScreen", screen: frame, frame: trimmed }], "给这一页改名");
  };

  /**
   * 迭代 16：一键撤销 —— 回到上一版。
   * 此前要开历史面板、找条目、点恢复，三步。而"刚才那下改坏了"是最常见的需求。
   * 复用既有的 `restorePrototypeVersion`，不另造一条回滚路径。
   */
  const [undoing, setUndoing] = React.useState(false);
  const undoLast = async () => {
    if (project === null) return;
    setUndoing(true);
    try {
      const { items: versions } = await listPrototypeVersions(project.id);
      // 版本按 seq 升序；"上一版"是倒数第二个——最后一个就是现在这份。
      const target = [...versions].sort((a, b) => a.seq - b.seq).at(-2);
      if (target === undefined) { setChatError("没有可回退的版本了。"); window.setTimeout(() => setChatError(null), 3000); return; }
      const out = await restorePrototypeVersion(project.id, target.id);
      setLoad({ kind: "ready", project: out.project });
      setSelectedId(null);
    } catch (err) {
      setChatError(`没能撤销（${describeFailure(err)}）`);
      window.setTimeout(() => setChatError(null), 3000);
    } finally {
      setUndoing(false);
    }
  };

  /**
   * 迭代 13（delta §5.2）：切**原型自己的**明暗主题。走 `updateProject`，与改名同一条路径。
   * 乐观更新——切主题是纯视觉的，等一次往返会让开关手感发黏；失败就回滚并说一声。
   */
  const changeTheme = async (theme: "light" | "dark") => {
    if (project === null || project.theme === theme) return;
    const before = project;
    setLoad({ kind: "ready", project: { ...project, theme } });
    try {
      const out = await updateProject(project.id, { theme });
      setLoad({ kind: "ready", project: out.project });
    } catch {
      setLoad({ kind: "ready", project: before });
      setChatError("没能切换主题，稍后再试。");
      window.setTimeout(() => setChatError(null), 3000);
    }
  };

  /**
   * 迭代 17：切**原型的强调色档位**。与切主题同一条路径、同一套乐观更新与回滚。
   * 它是项目的属性（导出的 HTML 也跟着它），不是看的人的偏好，所以落库而不是存在本地。
   */
  const changeAccent = async (accent: PrototypeAccent) => {
    if (project === null || project.accent === accent) return;
    const before = project;
    setLoad({ kind: "ready", project: { ...project, accent } });
    try {
      const out = await updateProject(project.id, { accent });
      setLoad({ kind: "ready", project: out.project });
    } catch {
      setLoad({ kind: "ready", project: before });
      setChatError("没能切换强调色，稍后再试。");
      window.setTimeout(() => setChatError(null), 3000);
    }
  };

  /**
   * 迭代 26：用**回调 ref** 装观察器，不再是 `useRef` + `useEffect`。
   *
   * 这处已经错过两次，两次都是同一种：**effect 跑的那一刻，要观察的那块 DOM 还不在**。
   *   · 迭代 24 之前：ref 挂在单页视图上，而默认是画板视图 ⇒ 挂载时 `ref.current === null`；
   *   · 迭代 26 第一版：改成量外面那一栏、依赖清空，可详情页**先渲染加载态**——
   *     项目还没取回来时那一栏同样不存在，`[]` 依赖于是再也不会重跑。
   * 两次的表现都一样：`stage` 永远 `{0,0}`、`fitScale` 永远 1、自适应缩放形同虚设。
   *
   * 回调 ref 由 React 在**元素真正挂载/卸载时**调用，不依赖任何"我猜它这时候在不在"。
   */
  const roRef = React.useRef<ResizeObserver | null>(null);
  const stageRef = React.useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry?.contentRect;
      if (r !== undefined) setStage({ w: r.width, h: r.height });
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);


  /**
   * 迭代 15：画布快捷键。**只在编辑态、且不在输入框里**时生效——
   * 少了后面那个判断，用户在对话框里按 Delete 会把选中的节点删掉，
   * 而他只是想删一个字。这是这类快捷键最常见的翻车方式。
   */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t !== null && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      /*
       * 迭代 16（#3773 R6）：预览态只认一个键——返回（Backspace / ←），与浏览器一致。
       * 其余快捷键（删除、复制、方向选节点）是编辑态的语义，预览里按下去应该什么都不发生。
       */
      if (typing || preview !== null) return;
      if (canvasMode === "preview") {
        if (e.key === "Backspace" || e.key === "ArrowLeft") { e.preventDefault(); goBack(); }
        return;
      }
      if (canvasMode !== "edit") return;
      if (e.key === "Escape") { setSelectedId(null); return; }
      if (selectedId === null || project === null) return;
      const tree = project.prototype;
      const NAV: Record<string, "up" | "down" | "prev" | "next"> = {
        ArrowUp: "up", ArrowDown: "down", ArrowLeft: "prev", ArrowRight: "next",
      };
      const dir = NAV[e.key];
      if (dir !== undefined) {
        const next = navigate(tree, selectedId, dir);
        // 走不动就保持原选中——按一下方向键选中就没了，比没反应更让人困惑。
        if (next !== null) { e.preventDefault(); setSelectedId(next); }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void runNodeOps([{ op: "remove", id: selectedId }], "删掉这个节点");
        setSelectedId(null);
        return;
      }
      // ⌘D / Ctrl+D 复制——与 Figma 一致
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        void runNodeOps(duplicateOps(tree, selectedId), "复制这个节点");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  React.useEffect(() => {
    if (project === null || sending) return;
    if (!autoStart || autoStartedRef.current === project.id) return;
    const saidSomething = project.chat.some((t) => t.role === "user");
    if (project.prototype.length > 0 || saidSomething || project.problem.trim() === "") return;
    autoStartedRef.current = project.id;
    // 发的是一句**真的会出现在对话里**的话——不是隐形的自动行为。
    // 用户看得见它说了什么，也就能接着改它。
    void send(AUTO_FIRST_PROMPT);
    // `send` 每次渲染都是新函数，进依赖数组会让这个 effect 每帧都重跑；
    // 真正的守卫是 `autoStartedRef`（每个项目只发一次），不是依赖数组。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, sending, autoStart]);

  React.useEffect(() => {
    // jsdom（测试环境）没有实现 `Element.scrollTo`——同 `inbox-screen.tsx` 的既有成例，
    // 生产浏览器里才真正滚动。
    chatRef.current?.scrollTo?.({ top: chatRef.current.scrollHeight });
  }, [project?.chat.length]);

  if (load.kind === "loading") {
    return (
      <div className="dark grid h-dvh place-items-center bg-background text-background-foreground" data-testid="loading">
        <Loader2 aria-hidden className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (load.kind === "failed") {
    return (
      <div className="dark grid h-dvh place-items-center bg-background text-background-foreground" data-testid="dep-failed">
        <div className="flex flex-col items-center gap-2 text-center">
          <PlugZap aria-hidden className="h-8 w-8 text-muted-foreground" />
          <p className="text-14 font-medium">这个设计项目暂时读不到（{load.reason}）</p>
          <Button variant="outline" size="sm" onClick={() => void reload()} data-testid="design-detail-retry">重试</Button>
        </div>
      </div>
    );
  }

  if (load.kind === "missing" || project === null) {
    return (
      <div className="dark grid h-dvh place-items-center bg-background text-background-foreground" data-testid="design-detail-missing">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-14 font-medium">找不到这个设计项目</p>
          <Button variant="outline" size="sm" onClick={onBack}>返回工作台</Button>
        </div>
      </div>
    );
  }

  if (pushed !== null) {
    return <PushSuccess project={pushed.project} code={pushed.code} onOpenInbox={onOpenInbox} onNextDesign={onNextDesign} />;
  }

  const send = async (override?: string, maxScreens?: number) => {
    const value = (override ?? text).trim();
    if (value === "") return;
    const controller = new AbortController();
    abortRef.current = controller;
    setSending(true);
    setChatError(null);
    setRetryText(null);
    setSuggestions([]);
    setElapsed(0);
    const started = Date.now();
    const tick = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    const stopPoll = () => {
      if (pollRef.current !== null) { window.clearInterval(pollRef.current); pollRef.current = null; }
    };
    pollRef.current = window.setInterval(() => {
      void (async () => {
        if (pollRef.current === null) return;
        try {
          const { items } = await listMyProjects();
          const found = items.find((p) => p.id === project.id);
          // 再查一次：这个 await 期间 send 可能已经收尾了。
          if (found !== undefined && pollRef.current !== null) setLoad({ kind: "ready", project: found });
        } catch {
          // 轮询失败不打扰用户——它只是"早点看见"，失败了照旧等最终结果。
        }
      })();
    }, GENERATION_POLL_MS);
    try {
      const { project: updated, reply } = await apiAppendProjectChat(
        project.id,
        value,
        focus !== null ? selectedId ?? undefined : undefined,
        controller.signal,
        // 迭代 13：项目当前的**全部**参考图随每一轮发出去——它是"贴在墙上的参考"，
        // 不是某一句话的附件（理由见 `ref-image-strip.tsx` 头注）。
        project.refImages.map((r) => r.id),
        maxScreens,
      );
      stopPoll();
      /*
       * 迭代 16（#3773 R5）：先算 diff 再换 project——换完就拿不到"之前"那一份了。
       * 首次生成（之前没有任何树）不高亮：整页都是新的，满屏闪烁说明不了任何事。
       */
      const marks = changedNodeIds(project.prototype, updated.prototype);
      setLoad({ kind: "ready", project: updated });
      if (changedTimer.current !== null) window.clearTimeout(changedTimer.current);
      setChanged(marks);
      if (marks.size > 0) {
        changedTimer.current = window.setTimeout(() => { setChanged(EMPTY_SET); changedTimer.current = null; }, CHANGED_HIGHLIGHT_MS);
      }
      setLastApplied(reply.applied);
      setFallbackReason(reply.fallbackReason ?? null);
      setSuggestions(reply.suggestions);
      // 整页重生成（`frames` 被写回 ⇒ 树是新的，id 重新分配过）：旧的选中 id 可能撞上一个不相干的新节点，
      // 不能靠「id 字符串还找得到」判断身份延续——一律清掉。patch 保留 id，选中延续。
      if (reply.applied.includes("frames")) setSelectedId(null);
      setText("");
    } catch (err) {
      if (controller.signal.aborted) {
        // 用户自己取消的：不是错误，草稿原样留在输入框。⚠ 服务端那次调用可能仍会完成并落库——
        // 下次读取会看到它；这里不假装它一定没发生。
        setText(value);
        // 迭代 16（#3773 R2）：取消之前**已经画好并落库**的页要留在屏上。
        // 在这之前取消等于前功尽弃——服务端照样画完、照样计费，用户什么也没拿到。
        stopPoll();
        void reload();
        /*
         * 迭代 27：取消之后**屏上说一句话**。
         *
         * 在这之前按下「取消」只是悄悄回到静止：已经画好的页留在那儿，而用户不知道
         * 那是取消之前画的、还是取消之后又画的、还是根本没动。上面那条注释自己写着
         * 「服务端那次调用可能仍会完成并落库——这里不假装它一定没发生」，
         * 而这件事从来没有告诉过用户。
         */
        setNotice("已取消。取消之前画好的页留着了；那一次调用可能还在服务端跑完，稍后刷新可能会看到更多页。");
        window.setTimeout(() => setNotice(null), 6000);
      } else {
        setText(value);
        setRetryText(value);
        setChatError(`没能发送（${describeFailure(err)}），已保留草稿`);
      }
    } finally {
      stopPoll();
      window.clearInterval(tick);
      abortRef.current = null;
      setSending(false);
    }
  };
  const cancel = () => abortRef.current?.abort();

  /**
   * 迭代 22：发布 / 取消发布。两条都把**服务端返回的整个项目**放回状态，而不是在本地
   * 拼一个 `share` 对象——`stale` 是服务端逐字段比出来的，本地拼等于第二份判断，
   * 而它一定会先于服务端那份过期。
   */
  const doPublish = async (scope: DesignShareScope) => {
    setShareBusy(true);
    setShareError(null);
    try {
      const out = await apiPublishProject(project.id, scope);
      setLoad({ kind: "ready", project: out.project });
    } catch (err) {
      setShareError(
        err instanceof ApiError && err.reasonCode === "NOTHING_TO_PUBLISH"
          ? "这个项目还没有画出来的页，没什么可发布的。"
          : `没能发布（${describeFailure(err)}）`,
      );
    } finally {
      setShareBusy(false);
    }
  };

  const doUnpublish = async () => {
    setShareBusy(true);
    setShareError(null);
    try {
      const out = await apiUnpublishProject(project.id);
      setLoad({ kind: "ready", project: out.project });
    } catch (err) {
      setShareError(`没能取消发布（${describeFailure(err)}）`);
    } finally {
      setShareBusy(false);
    }
  };

  const confirmPush = async (note: string) => {
    setPushBusy(true);
    setPushError(null);
    try {
      const out = await apiPushToInbox(project.id, note === "" ? undefined : note);
      setConfirming(false);
      setPushed({ project: out.project, code: out.inboxCode });
    } catch (err) {
      setPushError(`没能推送到收件箱（${describeFailure(err)}）`);
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <div className="dark flex h-dvh flex-col bg-background text-background-foreground" data-testid="design-detail">
      {/* 顶部条 */}
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="design-detail-back">
          <ArrowLeft aria-hidden className="h-4 w-4" /> 工作台
        </Button>
        {/*
          * 迭代 24：375 档下「返回 + 面包屑 + 三个动作」放不下，整个页面因此横向滚动 49px。
          * 面包屑里唯一的新信息是项目名，而项目名在窄屏上本来就会被截断——先让它退场。
          */}
        <span className="hidden min-w-0 truncate text-12 text-muted-foreground sm:inline">工作台 / <span className="text-background-foreground">{project.name}</span></span>
        {project.linkedFeedbackId !== null && <LinkBadge text="源自反馈" testid="design-detail-linked" />}
        <div className="ml-auto flex items-center gap-2">
          {/* 迭代 8：导出菜单——设计文档 / 原型 JSON / 当前页 PNG / 复制 */}
          <PrototypeExportMenu project={project} frame={Math.min(frame, Math.max(0, project.frames.length - 1))} />
          {/*
            * 迭代 22：分享。已发布时按钮说"已分享"，快照过期时**在按钮上就说出来**——
            * 把它藏进弹窗里，等于要用户先怀疑才会去看。
            */}
          <Button
            /*
             * 迭代 26：primary 从「推送到收件箱」换到「分享」。
             *
             * 三个动作里推送是**内部流程**（进运营收件箱排期），而第一次来做原型的人做完
             * 第一件想做的事是给人看。实心按钮是一屏上最强的指路牌，它此前指着一条
             * 与新手无关的路。
             */
            variant={(project.share ?? null) === null ? "primary" : "outline"}
            size="sm"
            onClick={() => { setSharing(true); setShareError(null); }}
            data-testid="design-detail-share"
          >
            <Share2 aria-hidden className="h-3.5 w-3.5" />
            {(project.share ?? null) === null ? "分享" : project.share?.stale === true ? "已分享（有更新）" : "已分享"}
          </Button>
          {/*
            * 迭代 24：窄屏只留图标。三个动作里「推送到收件箱」是**内部流程**——它对第一次
            * 来做原型的人最没有意义，却一直是唯一的 primary 按钮、还是最长的一个标签。
            * 宽屏保持原样（那里放得下，文字也确实更好认），窄屏让位给「分享」和「导出」。
            */}
          {project.pushed ? (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)} data-testid="design-detail-push" title="已推送到收件箱">
              <Check aria-hidden className="h-3.5 w-3.5" /> <span className="hidden sm:inline">已推送到收件箱</span>
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)} data-testid="design-detail-push" title="推送到收件箱">
              <Upload aria-hidden className="h-3.5 w-3.5" /> <span className="hidden sm:inline">推送到收件箱</span>
            </Button>
          )}
        </div>
      </header>

      {/* B6.5（U8）：md 以下两栏改为上下堆叠——对话面板在上、限高 40dvh 自身滚动，画布/说明占剩余高度。
          取舍：不折叠成抽屉（对话是这一屏唯一的修改入口，藏起来等于把功能藏起来）；不并排缩窄
          （360px 对话 + 260px 手机画布在 375/768 下装不下，实测 375 文档溢出 90px）。md 及以上不变。 */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* 左：对话面板 360px（md+）；md 以下全宽、限高 */}
        <div className="flex max-h-[40dvh] shrink-0 flex-col border-b border-border bg-panel md:max-h-none md:w-[360px] md:border-b-0 md:border-r">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-12 font-medium">
            {/*
              * 迭代 25：原文是「设计协作」——一个不说明这里能做什么的词。第一次进来的人
              * 需要知道的是「在这儿说话，右边就会变」，不是这块区域在产品体系里叫什么。
              */}
            <span>说需求，AI 画界面</span>
            {/* 迭代 13（delta §2.3）：入口在对话面板顶部——「已经在别处聊过了」是**开工之前**
                的动作，放在输入框旁边等于要求用户先想起来自己还有那条对话。 */}
            <button
              type="button"
              onClick={() => setImporting(true)}
              className="ml-auto flex items-center gap-1 rounded-control border border-border px-1.5 py-0.5 text-10 font-normal text-muted-foreground transition-colors duration-fast hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="design-detail-import-thread"
            >
              <Import aria-hidden className="h-3 w-3" /> 从对话导入
            </button>
          </div>
          <div ref={chatRef} className="flex flex-1 flex-col gap-2 overflow-y-auto p-3" data-testid="design-detail-chat">
            {project.chat.length === 0 && (
              <div className="flex max-w-[90%] flex-col gap-2 self-start">
                <div className="rounded-card bg-card px-2.5 py-1.5 text-12 text-card-foreground">{DESIGN_WORKBENCH_CHAT_INTRO}</div>
              </div>
            )}
            {/*
              * 迭代 30：起手模板原来锁在 `chat.length === 0` 里——也就是说，**只要说过一句话**，
              * 哪怕那句是「你好」、哪怕那一轮失败了一页没画出来，三条示例就永远消失。
              * 第一次来的人最可能干的事恰恰是先随便说一句。真正的条件是「还没画出来东西」，
              * 这个条件原本就写在里层（`prototype.length === 0`），只是被外层那道门挡住了。
              */}
            {/*
              * ⚠ 迭代 30 的修法在真浏览器上撞到了一条既有约定（`design-prototype-loop.spec.ts`
              *   「空项目：起手模板 → 发送 → …」）：点了一条起手模板、AI 回过话并给出
              *   **它自己的下一步建议**之后，那三条通用示例就该让位——两排 chip 叠在一起，
              *   更贴题的那一排反而被淹掉。
              *
              *   所以条件不是「说过话就收起」（那正是迭代 30 要修的 bug：随口一句「你好」
              *   把示例永久关掉），而是「还没画出东西 **且** 还没有更贴题的建议」。
              */}
            {project.prototype.length === 0 && suggestions.length === 0 && (
              <div className="flex max-w-[90%] flex-col gap-2 self-start">
                {project.chat.length > 0 && (
                  <p className="text-10 text-muted-foreground" data-testid="design-detail-starters-again">
                    还没画出东西？直接点一条试试：
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5" data-testid="design-detail-starters">
                    {DESIGN_WORKBENCH_STARTERS.map((s) => (
                      <button key={s.label} type="button" onClick={() => void send(s.prompt)} disabled={sending}
                        className="rounded-full border border-border px-2.5 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground"
                        data-testid={`design-detail-starter-${s.label}`}>
                        {s.label}
                      </button>
                    ))}
                </div>
              </div>
            )}
            {project.chat.map((turn, i) => (
              <div
                key={i}
                data-testid={`design-detail-turn-${turn.role}`}
                className={cn(
                  /*
                   * 迭代 30：`whitespace-pre-wrap`。输入框的 placeholder 一直写着
                   * 「Shift+Enter 换行」，而气泡把换行全折成了一行——教了一个手势，
                   * 又把它的结果吞掉。粘一段分行的需求进来时尤其明显。
                   */
                  "max-w-[90%] whitespace-pre-wrap rounded-card px-2.5 py-1.5 text-12",
                  turn.role === "user" ? "self-end bg-primary text-primary-foreground" : "self-start bg-card text-card-foreground",
                )}
              >
                {turn.text}
                {/* 迭代 13（delta §2）：`source: "system"` 不是一次模型回合，是服务端留下的痕迹。
                    标成「系统」而不是「未生成」——后者的含义是"模型本该说话却没说成"，这里模型压根没被叫过。 */}
                {turn.role === "ai" && turn.source === "system" && (
                  <span className="ml-1.5 rounded-control border border-border px-1 text-10 text-muted-foreground" title="这条不是 AI 说的，是系统在这里留下的一条记录（比如你从别处导入了一段对话）" data-testid="design-detail-turn-system">
                    系统
                  </span>
                )}
                {/* B5.2：模型不可用时服务端退回固定回执并标 source=fallback——如实显示，不装成模型说的 */}
                {turn.role === "ai" && turn.source === "fallback" && (
                  <span className="ml-1.5 rounded-control border border-border px-1 text-10 text-muted-foreground" title="这一轮 AI 没能给出画布，下面那句话说了原因；这条回执是系统写的，不是 AI 的答复" data-testid="design-detail-turn-fallback">
                    未生成
                  </span>
                )}
                {/* 2026-09-07：退路原因（闭集 → 人话），只挂最后一条，说清该重试还是该找运维 */}
                {turn.role === "ai" && i === project.chat.length - 1 && fallbackReason !== null && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-10 text-muted-foreground">
                    <p data-testid="design-detail-fallback-reason">{FALLBACK_REASON_TEXT[fallbackReason]}</p>
                    {/*
                      * 迭代 16（#3773 R8）：退路里**该重试的那几种**给一个「再试一次」。
                      *
                      * 在这之前这里只有一句解释，而屏上唯一的重试入口挂在"没能发送"那条
                      * 错误条带上——也就是说：网络层失败给了重试，**模型层失败反而没有**，
                      * 而后者才是用户真正会撞上的那一类（超时、被截断、输出不是 JSON）。
                      * 用户当时能做的只有把刚才那句话再手打一遍。
                      *
                      * 「没配模型」不给重试：它不是"再来一次就好"的事，重试一百次也一样，
                      * 那句话已经说了该找运维。给一个必然失败的按钮是在骗人。
                      */}
                    {/*
                      * 迭代 20：超时的那句话一直写着「试试少要几页」，而用户**没有任何
                      * 控制页数的手段**——页数由骨架轮自己定，界面上没有旋钮，
                      * 说「只画 3 页」也只是一句模型可以不听的话。又一句做不到的许诺。
                      * 现在这个按钮把那句话变成一个真的动作：`maxScreens` 是服务端
                      * 强制截断的上限，不是提示。
                      * 只在**超时**时给——别的退路原因（输出不是 JSON、没配模型）
                      * 与页数无关，给了只会把人往错的方向引。
                      */}
                    {fallbackReason === "MODEL_TIMEOUT" && lastUserText !== null && !sending && (
                      <button
                        type="button"
                        onClick={() => void send(lastUserText, FEWER_PAGES_CAP)}
                        className="rounded-control border border-border px-1.5 py-0.5 transition-colors duration-fast hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="design-detail-fewer-pages"
                      >
                        只画 {FEWER_PAGES_CAP} 页再试
                      </button>
                    )}
                    {RETRYABLE_FALLBACK.has(fallbackReason) && lastUserText !== null && !sending && (
                      <button
                        type="button"
                        onClick={() => void send(lastUserText)}
                        className="rounded-control border border-border px-1.5 py-0.5 transition-colors duration-fast hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="design-detail-fallback-retry"
                      >
                        再试一次
                      </button>
                    )}
                  </div>
                )}
                {/*
                  * 迭代 30：每条气泡说一句「什么时候」。这条对话就是这个项目的全部来龙去脉，
                  * 隔一天回来接着做时，「哪些是今天说的」只能靠猜。`at` 契约里一直有，
                  * 只是从来没显示过。时间格式走 `humanTime` 这一份，不另写。
                  */}
                <span className={cn("ml-1.5 align-baseline text-10", turn.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground")} data-testid={`design-detail-turn-at-${String(i)}`}>{humanTime(turn.at)}</span>
                {/*
                  * 迭代 30：用户那一侧的「再说一遍这句」。原来只有模型退路那一类给了重试，
                  * 而「这轮画得不对，我想用同一句话再要一次」是普通人最常想做的事——
                  * 他能做的只有把刚才那句手打一遍。
                  */}
                {turn.role === "user" && !sending && (
                  <button
                    type="button"
                    onClick={() => void send(turn.text)}
                    className={cn("ml-1.5 rounded-control px-1 text-10 underline underline-offset-2 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", turn.role === "user" ? "text-primary-foreground/80 hover:text-primary-foreground" : "text-muted-foreground hover:text-background-foreground")}
                    data-testid={`design-detail-resend-${String(i)}`}
                  >
                    再发一次
                  </button>
                )}
                {/* B5.2：这轮回复写回了哪些字段（服务端 `reply.applied`），只挂在最后一条 AI 气泡下 */}
                {turn.role === "ai" && i === project.chat.length - 1 && lastApplied.length > 0 && (
                  <div className="mt-1 text-10 text-muted-foreground" data-testid="design-detail-chat-applied">
                    已更新：{lastApplied.map((f) => WRITEBACK_LABEL[f]).join(" / ")}
                  </div>
                )}
              </div>
            ))}
            {/* 迭代 9：下一步建议 chips——只跟最后一条 AI 气泡，发下一句时清掉 */}
            {suggestions.length > 0 && !sending && (
              <div className="flex max-w-[90%] flex-wrap gap-1.5 self-start" data-testid="design-detail-suggestions">
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)}
                    className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-11 text-primary transition-colors duration-fast hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid="design-detail-suggestion">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          {sending && (
            <div className="mx-3 mb-1 flex items-center gap-1.5 text-11 text-muted-foreground" data-testid="design-detail-generating" role="status">
              <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
              <span className="truncate">
                {/*
                 * 迭代 16（#3773 R2）：有了中途落库，这里终于能说**真实进度**而不是按秒数猜。
                 * 骨架一回来 `frames` 就有了，每画好一页 `prototype` 里就多一棵树——
                 * 「3 / 5 页」是从库里读出来的事实，不是文案编的。
                 * 还没有骨架时（前十几秒）仍然按秒数给分阶段文案，那时候确实无事可报。
                 */}
                {drawnPages === null
                  ? elapsed < 4 ? "正在理解你的要求…" : "正在规划页面…"
                  : `正在画：已完成 ${drawnPages.done} / ${drawnPages.total} 页`}
                <span className="ml-1 font-mono text-10" data-testid="design-detail-elapsed">{elapsed}s</span>
              </span>
              <button type="button" onClick={cancel} className="ml-auto rounded-control px-1.5 py-0.5 text-10 transition-colors duration-fast hover:bg-card" data-testid="design-detail-cancel">取消</button>
            </div>
          )}
          {/*
            * 迭代 27：中性通知带（取消、以及以后别的"不是错误但要说一句"的事）。
            * 与下面那条红色的 `chatError` 刻意分开：把取消塞进红带子，等于告诉用户
            * 他刚做错了一件事。
            */}
          {notice !== null && (
            <div className="mx-3 mb-1 flex items-center gap-2 rounded-card border border-border bg-card px-2.5 py-1 text-11 text-card-foreground" data-testid="design-detail-notice" role="status">
              <span className="min-w-0 flex-1">{notice}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="关闭" className="shrink-0 rounded-control p-0.5 transition-colors duration-fast hover:bg-panel"><X aria-hidden className="h-3 w-3" /></button>
            </div>
          )}
          {chatError !== null && (
            <div className="mx-3 mb-1 flex items-center gap-2 rounded-card bg-destructive px-2.5 py-1 text-11 text-destructive-foreground" data-testid="design-detail-chat-error" role="alert">
              <span className="min-w-0 flex-1 truncate">{chatError}</span>
              {retryText !== null && (
                <button type="button" onClick={() => void send(retryText)} className="shrink-0 rounded-control border border-destructive-foreground/40 px-1.5 py-0.5 text-10 transition-colors duration-fast hover:bg-destructive-foreground/10" data-testid="design-detail-retry">重试</button>
              )}
              <button type="button" onClick={() => { setChatError(null); setRetryText(null); }} aria-label="关闭" className="shrink-0 rounded-control p-0.5 transition-colors duration-fast hover:bg-destructive-foreground/10"><X aria-hidden className="h-3 w-3" /></button>
            </div>
          )}
          <RefImageStrip
            images={project.refImages}
            disabled={sending}
            onUpload={async (file) => {
              const out = await uploadRefImage(project.id, file);
              setLoad({ kind: "ready", project: out.project });
            }}
            onDelete={async (imageId) => {
              const out = await deleteRefImage(project.id, imageId);
              setLoad({ kind: "ready", project: out.project });
            }}
          />
          {/* 迭代 2：焦点 chip——告诉用户「这句话会针对它」，可一键清除 */}
          {focus !== null && (
            <div className="mx-3 mb-1 flex items-center gap-1.5 text-11 text-muted-foreground" data-testid="design-detail-focus">
              <Crosshair aria-hidden className="h-3 w-3 text-primary" />
              <span className="truncate">
                针对：<span className="text-background-foreground">{prototypeNodeLabel(focus.path[focus.path.length - 1]!)}</span>
                <span className="ml-1 text-10">（{project.frames[focus.frameIndex]} › {focus.path.slice(0, -1).map(prototypeNodeLabel).join(" › ") || "根"}）</span>
              </span>
              <button type="button" onClick={() => setSelectedId(null)} aria-label="取消针对" className="ml-auto rounded-control p-0.5 transition-colors duration-fast hover:bg-card" data-testid="design-detail-focus-clear">
                <X aria-hidden className="h-3 w-3" />
              </button>
            </div>
          )}
          {/*
            * 迭代 30：字数上限在契约里是 `DESIGN_TEXT_MAX_CHARS`，而界面上**一次都没出现过**——
            * 从别处粘一段长需求进来，按下发送才被服务端拒掉，那时已经等了一次往返。
            * 快到上限时才出现（平时不占地方），超了就把发送按钮关掉。
            */}
          {text.length > MAX_CHARS * 0.9 && (
            <p
              className={cn("px-3 pt-2 text-10", overLimit ? "text-destructive" : "text-muted-foreground")}
              role={overLimit ? "alert" : undefined}
              data-testid="design-detail-input-count"
            >
              {overLimit
                ? `超了 ${text.length - MAX_CHARS} 个字——一次最多 ${MAX_CHARS} 字。删掉一些，或者分两次说。`
                : `还能再打 ${MAX_CHARS - text.length} 个字`}
            </p>
          )}
          <div className="flex items-end gap-2 border-t border-border p-3">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // 2026-09-07 人类指令：回车直接发，Shift+Enter 换行。
                // ⚠ 输入法组字期间的回车是**在选词**，不是在发送——不判 `isComposing` 会把
                //   中文/日文用户的半截词直接发出去。`e.nativeEvent.isComposing` 是这件事的
                //   标准信号（KeyboardEvent.isComposing），jsdom 里为 undefined，视作非组字。
                if (e.key !== "Enter" || e.shiftKey || (e.nativeEvent as { isComposing?: boolean }).isComposing === true) return;
                e.preventDefault();
                if (text.trim() === "" || sending) return;
                void send();
              }}
              rows={2}
              disabled={sending}
              /*
               * 迭代 30：画布还空着的时候，「告诉我要改什么」问的是一件**还不存在**的事。
               * 第一次来的人需要被问的是"你想做个什么"，不是"你要改什么"。
               */
              placeholder={
                focus !== null
                  ? "要怎么改这个节点？（回车发送，Shift+Enter 换行）"
                  : project.prototype.length === 0
                    ? "说说你想做个什么，比如「一个记账 App，能记一笔、看这个月花了多少」（回车发送）"
                    : "告诉我要改什么，我来更新画布（回车发送，Shift+Enter 换行）"
              }
              data-testid="design-detail-input"
              className="flex-1"
            />
            <Button
              variant="primary"
              size="icon"
              disabled={text.trim() === "" || sending || overLimit}
              onClick={() => void send()}
              aria-label="发送"
              data-testid="design-detail-send"
            >
              {sending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Send aria-hidden className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* 右：画布 / 说明 两 Tab */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex gap-1 border-b border-border px-4 pt-2">
            <DetailTab active={tab === "canvas"} onClick={() => setTab("canvas")} testid="design-detail-tab-canvas">原型画布</DetailTab>
            <DetailTab active={tab === "spec"} onClick={() => setTab("spec")} testid="design-detail-tab-spec">说明与验收标准</DetailTab>
          </div>

          {tab === "canvas" ? (
            <div className="flex min-h-0 flex-1 flex-col" data-testid="design-detail-canvas">
              {/*
                * 迭代 24：`flex-wrap` —— 放不下就换行，而不是把整个页面撑出横向滚动。
                * 宽屏一行照旧放得下，所以这一条对桌面是零改动。
                */}
              <div className="flex flex-wrap items-center gap-1 border-b border-border px-4 py-2">
                {/*
                  * 迭代 24：页签自己横向滚，不把工具条撑宽。此前在 375 档页签被 flex 压到
                  * 每字一行（「历」「史」「会」「话」竖着排），而整条工具条仍然溢出——
                  * 两个毛病同一个根：一行里塞了太多东西，却既不许滚也不许换行。
                  */}
                <div
                  className="flex min-w-0 max-w-full items-center gap-1 overflow-x-auto"
                  data-allow-x-scroll="页签多时自己横向滚动，不撑宽工具条"
                  data-testid="design-detail-frames"
                >
                {(preview ?? project).frames.map((f, i) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFrame(i)}
                    // 迭代 11：这排页签是一组互斥的"当前页"选择，读屏得知道哪一个是选中的
                    // （同顶栏视图/模式切换的既有做法）。e2e 也据此断言预览模式真的换了页。
                    aria-pressed={frame === i}
                    data-testid={`design-detail-frame-${i}`}
                    className={cn(
                      "shrink-0 whitespace-nowrap rounded-control px-2 py-1 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      frame === i ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60",
                    )}
                    onDoubleClick={() => {
                      // 双击页签改名：就地编辑，不弹窗——改一个词不值得一个 Dialog。
                      if (i !== frame || canvasMode !== "edit") return;
                      const name = window.prompt("页面名字", f);
                      if (name !== null) renamePage(name);
                    }}
                    title={i === frame && canvasMode === "edit" ? "双击改名" : undefined}
                  >
                    {f}
                  </button>
                ))}
                {/*
                  * 迭代 16：页管理。契约的 addScreen/removeScreen 从迭代 12 起就在，
                  * 但从来没有 UI 够得着——模型能加删页，用户不能。
                  */}
                {canvasMode === "edit" && preview === null && (
                  <>
                    {/*
                      * 迭代 26：页签与「改名/加页/复制/删页」之间加一道分隔线。
                      * 它们此前只隔着 4px，而最后一颗是**删这一页**——在手机上手指宽度
                      * 远大于那个间距，点最后一个页签与删掉它只差几个像素。
                      */}
                    <span className="mx-1 h-4 w-px shrink-0 bg-border" aria-hidden />
                    <span className="flex shrink-0 items-center gap-0.5" data-testid="design-detail-pages">
                    {/*
                      * 迭代 25：改名此前**只有双击页签**一条路（还用 `window.prompt`）。
                      * 手机上没有双击这回事，而这排按钮在哪都点得到——改名与加/复制/删同级，
                      * 本来就该并排。
                      */}
                    <button
                      type="button"
                      onClick={() => {
                        const current = (preview ?? project).frames[frame] ?? "";
                        const name = window.prompt("页面名字", current);
                        if (name !== null) renamePage(name);
                      }}
                      title="给这一页改名"
                      data-testid="design-detail-page-rename"
                      className="rounded-control px-1 py-1 text-muted-foreground transition-colors duration-fast hover:bg-card hover:text-background-foreground"
                    >
                      <Pencil aria-hidden className="h-3 w-3" />
                    </button>
                    <button type="button" onClick={addPage} title="加一页" data-testid="design-detail-page-add"
                      className="rounded-control px-1 py-1 text-muted-foreground transition-colors duration-fast hover:bg-card hover:text-background-foreground">
                      <Plus aria-hidden className="h-3 w-3" />
                    </button>
                    <button type="button" onClick={duplicatePage} title="复制这一页" data-testid="design-detail-page-duplicate"
                      className="rounded-control px-1 py-1 text-muted-foreground transition-colors duration-fast hover:bg-card hover:text-background-foreground">
                      <Copy aria-hidden className="h-3 w-3" />
                    </button>
                    <button type="button" onClick={removePage} disabled={pageCount <= 1} title={pageCount <= 1 ? "只剩一页了，删不得" : "删掉这一页"}
                      data-testid="design-detail-page-remove"
                      className="rounded-control px-1 py-1 text-muted-foreground transition-colors duration-fast hover:bg-card hover:text-destructive disabled:bg-disabled disabled:text-disabled-foreground">
                      <Trash2 aria-hidden className="h-3 w-3" />
                    </button>
                  </span>
                  </>
                )}
                </div>
                <div className="ml-auto inline-flex rounded-control border border-border p-0.5" role="group" aria-label="画布视图">
                  <button type="button" onClick={() => setViewMode("board")} aria-pressed={viewMode === "board"} data-testid="design-detail-view-board" title="画板：所有页并排，可平移缩放"
                    className={cn("inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-10 transition-colors duration-fast", viewMode === "board" ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60")}>
                    <LayoutGrid aria-hidden className="h-3 w-3" /> 画板
                  </button>
                  <button type="button" onClick={() => setViewMode("single")} aria-pressed={viewMode === "single"} data-testid="design-detail-view-single" title="单页：只看当前页"
                    className={cn("inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-10 transition-colors duration-fast", viewMode === "single" ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60")}>
                    <Smartphone aria-hidden className="h-3 w-3" /> 单页
                  </button>
                </div>
                {/* 迭代 11：编辑 / 预览。预览点有跳转的节点 = 换页；进预览时清掉选中，退出再选。 */}
                <div className="inline-flex rounded-control border border-border p-0.5" role="group" aria-label="画布模式">
                  <button type="button" onClick={() => { setCanvasMode("edit"); setBackStack([]); }} aria-pressed={canvasMode === "edit"} data-testid="design-detail-mode-edit" title="编辑：点节点选中它去改"
                    className={cn("inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-10 transition-colors duration-fast", canvasMode === "edit" ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60")}>
                    <Crosshair aria-hidden className="h-3 w-3" /> 编辑
                  </button>
                  <button type="button" onClick={() => { setCanvasMode("preview"); setSelectedId(null); setBackStack([]); }} aria-pressed={canvasMode === "preview"} data-testid="design-detail-mode-preview" title="预览：点有跳转的按钮，像用真的 App 一样走一遍"
                    className={cn("inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-10 transition-colors duration-fast", canvasMode === "preview" ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60")}>
                    <Play aria-hidden className="h-3 w-3" /> 预览
                  </button>
                </div>
                {/*
                  * 迭代 24：明暗 / 强调色 / 设备三组收进一个「外观」面板。
                  *
                  * 它们的共同点是**设一次就不再动**，而此前它们在工具条上平铺了十几个控件，
                  * 其中八个是没有名字的彩色圆点——第一次来做原型的人最显眼看到的就是它们，
                  * 既不知道那是什么，也不知道该不该动。收起来之后，常态工具条只剩每天真用得上的
                  * 那几个；点开之后每一节有中文小标题，圆点第一次有了名字。
                  *
                  * 顺带把 375 档那 460px 的横向滚动消掉（见 `canvas-appearance.tsx` 头注）。
                  */}
                <CanvasAppearance
                  theme={project.theme}
                  onTheme={(t) => void changeTheme(t)}
                  accent={project.accent}
                  accentOptions={ACCENT_OPTIONS}
                  accentLabel={ACCENT_LABEL}
                  accentSwatch={ACCENT_SWATCH}
                  onAccent={(a) => void changeAccent(a)}
                  devices={DEVICE_PRESETS}
                  deviceId={lens.id}
                  onDevice={setDeviceId}
                  landscape={landscape}
                  onLandscape={() => setLandscape((v) => !v)}
                  rotatable={lens.rotatable}
                />
                {/* 迭代 24：窄屏才有的「图层」开关——md 及以上那一栏一直在，不需要这个按钮。 */}
                <button
                  type="button"
                  onClick={() => setSideOpen((v) => !v)}
                  aria-pressed={sideOpen}
                  data-testid="design-detail-side-toggle"
                  title="图层与属性"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 transition-colors duration-fast md:hidden",
                    sideOpen ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60",
                  )}
                >
                  <Layers aria-hidden className="h-3 w-3" /> 图层
                </button>
                {/* 迭代 16：一键撤销。此前要开历史面板、找条目、点恢复——三步。 */}
                <button
                  type="button"
                  onClick={() => void undoLast()}
                  disabled={undoing || preview !== null}
                  data-testid="design-detail-undo"
                  title="回到上一版"
                  className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 text-muted-foreground transition-colors duration-fast hover:bg-card/60 disabled:bg-disabled disabled:text-disabled-foreground"
                >
                  {undoing ? <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> : <Undo2 aria-hidden className="h-3 w-3" />} 撤销
                </button>
                <button
                  type="button"
                  // 迭代 24：点「历史」就是要看历史——窄屏下顺手把收起的那一栏打开，
                  // 否则按钮按下去 `aria-pressed` 变了而屏上什么也没发生。
                  onClick={() => { setHistoryOpen((o) => !o); if (historyOpen) setPreview(null); else setSideOpen(true); }}
                  aria-pressed={historyOpen}
                  // 迭代 25：旁边就是「撤销」，而两者的差别对第一次来的人完全不明显。
                  // 撤销那颗已经写了「回到上一版」，这颗一直没有说明。
                  title="看所有版本，可以恢复到任意一版"
                  data-testid="design-detail-history-toggle"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-control px-2 py-1 text-11 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    historyOpen ? "bg-card text-card-foreground" : "text-muted-foreground hover:bg-card/60",
                  )}
                >
                  <History aria-hidden className="h-3 w-3" /> 历史
                </button>
              </div>
              <div className="relative flex min-h-0 flex-1">
                {/*
                  * 迭代 24：单页视图改成**填满可用空间的一列**，不再是 `grid place-items-center + overflow-auto`。
                  *
                  * 旧写法把画板居中，而画板（手机 852px + 内边距 = 884px）比容器高——居中的结果是
                  * 它的顶部被顶到容器上边之外、滑到页头底下：实测 1280×720 下原型的导航栏落在 y=15，
                  * 而页头占 0–49，**导航栏根本点不到**（`design-prototype-loop` 的预览用例就卡在这里）。
                  * 而自适应缩放对单页视图**从来没生效过**：量尺寸的 ResizeObserver 只在挂载时装一次，
                  * 那时默认是画板视图、`stageRef` 还是 null（见该 effect 的依赖数组那条注释）。
                  *
                  * 改成 flex 列之后 stage 是 `flex-1`，量到的是真正的可用空间，画板按它缩小；
                  * 普通人也就不必先上下滚一段才看得到手机顶部。
                  */}
                <div ref={stageRef} className={cn("relative min-w-0 flex-1 overflow-hidden bg-background", viewMode === "single" && "flex flex-col")}>
                  {/*
                    * 迭代 16（#3773 R6）：预览里的「返回」。只在真的有地方可退时出现——
                    * 一个永远在那里、点了没反应的返回按钮，比没有更糟。
                    */}
                  {canvasMode === "preview" && preview === null && backStack.length > 0 && (
                    <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-card border border-border bg-card px-2.5 py-1.5 text-11" data-testid="design-detail-preview-back-bar">
                      <button
                        type="button"
                        onClick={goBack}
                        className="inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 transition-colors duration-fast hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="design-detail-preview-back"
                      >
                        <ArrowLeft aria-hidden className="h-3 w-3" />返回
                      </button>
                      <span className="text-muted-foreground">
                        从「{project.frames[backStack[backStack.length - 1]!] ?? ""}」过来
                      </span>
                    </div>
                  )}
                  {preview !== null && (
                    <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-card border border-primary/40 bg-card px-2.5 py-1.5 text-11" data-testid="design-detail-preview-banner">
                      正在看<span className="font-medium">第 {preview.seq} 版</span>的样子，画布没有被改动
                      <Button variant="ghost" size="sm" onClick={() => setPreview(null)} data-testid="design-detail-preview-exit">退出预览</Button>
                    </div>
                  )}
                  {(preview ?? project).frames.length === 0 ? (
                    /*
                     * 2026-09-08：新建项目不再预填三个「草稿页」（人类实测：「不要默认三个页面，
                     * 有点奇怪」）。0 页时看板视图会 map 出空数组 ⇒ 整块画布全白，比原来更糟——
                     * 所以两种视图共用这一个空态，把"下一步该干什么"直接说出来。
                     */
                    <div className="grid h-full place-items-center p-8 text-center" data-testid="design-detail-canvas-empty">
                      <div className="max-w-sm space-y-3">
                        <p className="text-13 font-medium">还没有页面</p>
                        <p className="text-12 text-muted-foreground">
                          {/*
                            * 迭代 25：这句原文是「**在左边**描述你要做的产品」。md 以下对话面板在
                            * **上方**（`flex-col md:flex-row`），于是手机上这句话把人指向一个空的地方。
                            * 方位词在响应式布局里天然会说谎——改成说**做什么**，不说**去哪**。
                            */}
                          在对话里描述你要做的产品，我会先拆出页面划分，再一页页把界面画出来。
                        </p>
                        {/*
                          * 迭代 25：**画布中央给可点的下一步**。
                          *
                          * 起手的三条 brief 此前只在左栏对话里作为一排小 chip 存在，而第一次进来的人
                          * 眼睛在**画布**上——那是整屏最大的一块，而它此前只有两行灰字。
                          * 同一份 `DESIGN_WORKBENCH_STARTERS`（契约常量），不是第二份清单。
                          */}
                        <div className="flex flex-wrap justify-center gap-1.5" data-testid="design-detail-canvas-starters">
                          {DESIGN_WORKBENCH_STARTERS.map((st) => (
                            <button
                              key={st.label}
                              type="button"
                              disabled={sending}
                              onClick={() => void send(st.prompt)}
                              data-testid={`design-detail-canvas-starter-${st.label}`}
                              className="rounded-full border border-border px-2.5 py-1 text-11 transition-colors duration-fast hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground"
                            >
                              {st.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : viewMode === "board" ? (
                    <PrototypeBoard
                      frames={(preview ?? project).frames}
                      prototype={(preview ?? project).prototype}
                      activeFrame={Math.min(frame, (preview ?? project).frames.length - 1)}
                      onFocusFrame={setFrame}
                      selectedId={preview === null && focus !== null ? selectedId : null}
                      onSelect={preview === null ? setSelectedId : null}
                      device={lens}
                      landscape={landscape}
                      links={frameLinks}
                      mode={canvasMode}
                      theme={project.theme}
                      drawing={preview === null && sending}
                      changed={preview === null ? changed : undefined}
                      accent={project.accent}
                      wireframe={project.template === "wireframe"}
                      onNavigate={navigateTo}
                    />
                  ) : (
                    /*
                     * 迭代 14：画板按**逻辑分辨率**渲染，再整体缩放塞进可用空间。
                     * `transform: scale` 而不是改宽高——改宽高等于换了个更小的设备，
                     * 那就不是"在 1280 的笔记本上长什么样"了。`origin-top` 让它从顶部往下缩，
                     * 与人看设备的习惯一致（不是从中心散开）。
                     */
                    <div
                      className="flex min-h-0 flex-1 justify-center overflow-auto p-4"
                      data-testid="design-detail-stage"
                      data-scale={scale.toFixed(3)}
                    >
                      {/*
                        * 迭代 24：外层按**缩放后的尺寸**占位，内层才做 transform。
                        * `transform` 不改变布局盒子——只写 transform 的话，容器仍按 852px 算高度，
                        * 于是画面明明已经缩小放得下了，旁边还挂着一条滚不出任何东西的滚动条。
                        */}
                      <div style={{ width: lensSize.w * scale, height: lensSize.h * scale }}>
                      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: lensSize.w, height: lensSize.h }}>
                    <PrototypeCanvas
                      label={(preview ?? project).frames[Math.min(frame, (preview ?? project).frames.length - 1)] ?? ""}
                      root={(preview ?? project).prototype[Math.min(frame, (preview ?? project).frames.length - 1)] ?? null}
                      selectedId={preview === null && focus !== null && focus.frameIndex === frame ? selectedId : null}
                      onSelect={preview === null ? setSelectedId : null}
                      device={lens}
                      landscape={landscape}
                      /**
                       * issue #3340：区分两种空。
                       * · 整个项目还没有原型（`prototype.length === 0`）⇒ 引导语；
                       * · 这一页规划了但没画出来（别的页有树、这页是 `null`）⇒ 说出事实 + 「补画这一页」。
                       * 两种空说同一句话，等于把「有几页没画出来」这个事实藏起来。
                       */
                      ungenerated={
                        preview === null &&
                        !sending &&
                        (project.prototype.length > 0) &&
                        (project.prototype[Math.min(frame, project.frames.length - 1)] ?? null) === null
                      }
                      /* 迭代 16（#3773 R2）：这一轮还在生成 ⇒ 空页说的是「正在画」，不是「没画出来」。 */
                      drawing={
                        preview === null &&
                        sending &&
                        (project.prototype.length > 0) &&
                        (project.prototype[Math.min(frame, project.frames.length - 1)] ?? null) === null
                      }
                      changed={preview === null ? changed : undefined}
                      accent={project.accent}
                      wireframe={project.template === "wireframe"}
                      onRegenerate={preview !== null || sending ? null : () => {
                        // 补画走**普通对话**，不新开接口——与建议 chip「补画「X」」同一条路。
                        const label = project.frames[Math.min(frame, project.frames.length - 1)] ?? "";
                        void send(`补画「${label}」`);
                      }}
                      frameIndex={Math.min(frame, (preview ?? project).frames.length - 1)}
                      theme={project.theme}
                      mode={canvasMode}
                      links={frameLinks[Math.min(frame, (preview ?? project).frames.length - 1)]}
                      onNavigate={navigateTo}
                    />
                      </div>
                      </div>
                    </div>
                  )}
                </div>
                {/* 迭代 5：右栏——选中节点时顶部是属性面板（预览态不显示），下方按需是版本历史 */}
                {/* md 以下：右栏盖在画布上（absolute），不把 375px 撑出横向溢出（B6.5 同一纪律）；md 及以上并排 */}
                {/* 迭代 15：编辑态下侧栏常驻（图层面板），不再只有选中时才出现 */}
                {(historyOpen || (preview === null && canvasMode === "edit") || (focus !== null && preview === null)) && (
                  /*
                   * 迭代 24：窄屏下这块**默认收起**。
                   *
                   * 它此前是 `absolute inset-y-0 right-0 w-64 max-w-[85%]`，而显示条件基本等于
                   * 「编辑态」——也就是默认状态。结果：在手机上打开一个设计，画布被这块盖掉 85%，
                   * 而且**原型里的任何东西都点不到**（点击落在面板上）。里面装的又恰好是
                   * 「纵向布局 / 横向布局 / 卡片」这类只有做过设计的人才懂的词。
                   *
                   * 所以窄屏改成"要看才打开"，由工具条上的「图层」按钮开关；md 及以上**一个像素都不变**
                   * （那里它是并排的一栏，不挡任何东西）。
                   */
                  <div
                    className={cn(
                      "absolute inset-y-0 right-0 z-10 w-64 max-w-[85%] shrink-0 flex-col border-l border-border bg-card/95 md:static md:flex md:max-w-none md:bg-card/40",
                      sideOpen ? "flex" : "hidden",
                    )}
                    data-testid="design-detail-side"
                  >
                    {/*
                      * 迭代 15：图层面板。一个 stack 套 stack 在画板上分不出层级，
                      * 想选中"外面那个容器"只能反复试点——摊平成可点的一列是最直接的解法。
                      * 预览态不显示：那时候没有"选中"这回事。
                      */}
                    {preview === null && canvasMode === "edit" && (
                      <PrototypeLayers
                        root={project.prototype[Math.min(frame, project.frames.length - 1)] ?? null}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                      />
                    )}
                    {focus !== null && preview === null && (
                      <PrototypeInspector
                        projectId={project.id}
                        prototype={project.prototype}
                        onNodeOps={runNodeOps}
                        node={focus.path[focus.path.length - 1]!}
                        path={focus.path}
                        onSaved={(p) => setLoad({ kind: "ready", project: p })}
                        onDeleted={(p) => { setLoad({ kind: "ready", project: p }); setSelectedId(null); }}
                        frames={project.frames}
                        frameIndex={focus.frameIndex}
                        links={frameLinks[focus.frameIndex] ?? []}
                        onSetLinks={(links) => setPageLinks(focus.frameIndex, links)}
                      />
                    )}
                    {historyOpen && (
                      <PrototypeHistoryPanel
                        projectId={project.id}
                        revision={project.updatedAt}
                        isOwner
                        previewId={preview?.id ?? null}
                        onPreview={setPreview}
                        onRestored={(p) => { setLoad({ kind: "ready", project: p }); setFrame(0); setSelectedId(null); }}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-6" data-testid="design-detail-spec">
              <section className="mb-6">
                <h3 className="text-14 font-semibold">问题与目标</h3>
                <p className="mt-1.5 whitespace-pre-wrap text-13 text-muted-foreground">
                  {project.problem || "还没填背景。在对话里说清楚要解决的问题，我会补到这里。"}
                </p>
                {project.linkedFeedbackId !== null && (
                  <p className="mt-2 text-12">
                    关联反馈：<span className="font-mono">{project.linkedFeedbackId}</span>
                  </p>
                )}
              </section>
              <section>
                <h3 className="text-14 font-semibold">验收标准</h3>
                <ul className="mt-1.5 flex flex-col gap-1.5">
                  {project.criteria.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-13">
                      <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </section>
              {/* 迭代 8：每页交互说明（模型随整页写回给出；没有就不显示这一节） */}
              {project.frameNotes.some((n) => n.trim() !== "") && (
                <section className="mt-6" data-testid="design-detail-notes">
                  <h3 className="text-14 font-semibold">各页交互说明</h3>
                  <ol className="mt-1.5 flex flex-col gap-2">
                    {project.frames.map((f, i) => {
                      const note = (project.frameNotes[i] ?? "").trim();
                      if (note === "") return null;
                      return (
                        <li key={i} className="flex items-start gap-2 text-13" data-testid={`design-detail-note-${i}`}>
                          <MessageSquareText aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                          <span><span className="font-medium">{f}</span>：<span className="text-muted-foreground">{note}</span></span>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 底部状态条 */}
      <footer className="flex items-center gap-3 border-t border-border bg-panel px-4 py-1.5 text-11 text-muted-foreground" data-testid="design-detail-statusbar">
        {/* 2026-09-07 人类指令：不显示模型名。它此前是**硬编码的字面量**，与这个部署实际用的
            模型无关（真实值在服务端 `KERNEL_MODEL_*`，前端拿不到）——写死一个名字在屏上，
            部署换了模型它照样这么写，属于会骗人的静态痕迹。要显示就得有真数据源，先删。 */}
        {/*
          * 迭代 25：原来这里写的是「设计系统 WorkspaceX UI」——对第一次来的人零信息，
          * 它既不是这份原型的属性，也不是他能改的东西（真正决定外观的是「外观」面板里的档位）。
          * 换成他**现在正在做的那份东西**的事实：几页、画出来几页。
          */}
        <span>{TEMPLATE_LABEL[project.template]}</span>
        <span data-testid="design-detail-statusbar-pages">
          {project.frames.length === 0
            ? "还没有页面"
            : `${project.frames.length} 页 · 已画出 ${project.prototype.filter((r) => r !== null).length} 页`}
        </span>
        {/*
          * 2026-09-23 本地真栈实测（`scripts/local-session/design-loop-session.mjs` S04）发现：
          * 这里还写着「2026/9/23」——各屏的时间早就统一成了「刚刚 / N 分钟前 / 今天 HH:mm」，
          * 只有这一格漏了。而它恰好是人改完东西后看一眼「存上了没有」的地方：只有日期，答不了。
          */}
        <span className="ml-auto" data-testid="design-detail-statusbar-updated">{project.ownerName ?? "—"} · 更新于 {humanTime(project.updatedAt)}</span>
      </footer>

      {importing && (
        <ImportThreadDialog
          projectId={project.id}
          onClose={() => setImporting(false)}
          onImported={(next) => setLoad({ kind: "ready", project: next })}
        />
      )}

      {sharing && (
        <ShareDialog
          project={project}
          busy={shareBusy}
          error={shareError}
          onClose={() => { if (!shareBusy) { setSharing(false); setShareError(null); } }}
          onPublish={(scope) => void doPublish(scope)}
          onUnpublish={() => void doUnpublish()}
        />
      )}

      {confirming && (
        <PushConfirm
          project={project}
          busy={pushBusy}
          error={pushError}
          onClose={() => { if (!pushBusy) { setConfirming(false); setPushError(null); } }}
          onConfirm={(note) => void confirmPush(note)}
        />
      )}
    </div>
  );
}

function DetailTab({ active, onClick, children, testid }: { active: boolean; onClick: () => void; children: React.ReactNode; testid: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testid}
      className={cn(
        "rounded-t-control px-3 py-1.5 text-12 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-b-2 border-primary font-medium text-background-foreground" : "border-b-2 border-transparent text-muted-foreground hover:text-background-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PushConfirm({
  project, busy, error, onClose, onConfirm,
}: {
  project: DesignProject;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = React.useState("");
  return (
    <div className="dark fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="design-push-confirm">
      <div className="absolute inset-0 bg-inverse/50" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="推送到收件箱" className="relative flex w-full max-w-md flex-col gap-3 rounded-card border border-border bg-card p-5 text-card-foreground shadow-lg">
        <h3 className="text-16 font-semibold">推送「{project.name}」到收件箱</h3>
        <p className="text-12 text-muted-foreground">
          推送后会在运营收件箱生成一条「设计方案」条目（待处理），供工程排期。
          {project.linkedFeedbackId !== null && " 来源反馈会被标注「已生成」。"}
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor="push-note" className="text-11 font-medium text-muted-foreground">给工程的说明（可选）</label>
          <Textarea id="push-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} disabled={busy} placeholder="需要工程特别注意的边界、依赖、验收口径" data-testid="design-push-note" />
        </div>
        {error !== null && (
          <p className="text-11 text-destructive" data-testid="design-push-error" role="alert">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>取消</Button>
          <Button variant="primary" size="sm" onClick={() => onConfirm(note)} disabled={busy} data-testid="design-push-confirm-submit">
            {busy && <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />}
            确认推送
          </Button>
        </div>
      </div>
    </div>
  );
}

function PushSuccess({ project, code, onOpenInbox, onNextDesign }: { project: DesignProject; code: string; onOpenInbox?: () => void; onNextDesign?: () => void }) {
  return (
    <div className="dark flex h-dvh flex-col items-center justify-center gap-4 bg-background p-16 text-center text-background-foreground" data-testid="design-push-success">
      <CheckCircle2 aria-hidden className="h-14 w-14 text-success" />
      <div>
        <p className="text-20 font-semibold">已推送到收件箱</p>
        <p className="mt-1 text-13 text-muted-foreground">
          方案 <span className="font-mono">{code}</span> · {project.name}
          {project.linkedFeedbackId !== null && <> · 已与来源反馈互相关联</>}
        </p>
      </div>
      <p className="max-w-sm text-12 text-muted-foreground">
        运营会在收件箱看到这条待处理的设计方案，排期后进入开发。你可以继续设计下一个，或去收件箱确认。
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onNextDesign} data-testid="design-success-next">继续设计下一个</Button>
        <Button variant="primary" size="sm" onClick={onOpenInbox} data-testid="design-success-inbox">查看收件箱</Button>
      </div>
    </div>
  );
}
