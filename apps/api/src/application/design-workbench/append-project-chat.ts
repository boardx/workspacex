/**
 * `appendProjectChat`（UC-17.8 B4.3 → B5.2）—— 详情页左侧「设计协作」面板发送。仅 owner。
 *
 * ## B5.2：模型回复 + 写回 `problem/criteria/frames`；B5.3：+ `prototype`（整页重生成）
 *
 * `writeback.prototype` 是 `{frame, root}[]`——服务端拆成 `frames`（标签）+ `prototype`（树）
 * **同一次** `projects.update`，`applied` 同时列出 `frames` 与 `prototype`（两者都真的变了）。
 * `prototype` 与 `frames` 同时给出时以 `prototype` 为准（它自带标签），契约头注逐字。
 *
 * ## 迭代 1：`writeback.patch`（局部修改）
 *
 * 按节点 id 顺序应用到当前 `prototype`（`applyPrototypePatch`，纯函数）；任一条失败 ⇒ 整批不生效、
 * 记日志、`applied` 不含 `prototype`（字段级拒绝，同 I-10）。还没生成过原型时 patch 无处可打，同样拒。
 * 落库前 `ensurePrototypeIds`：整页写回里模型没写 id 的节点补上，模型下一轮看到的每个节点都可寻址。
 *
 *   ① owner 校验（非 owner 不调模型、不写任何东西——契约头注逐字）。
 *   ② `deps.ai.reply`（`DesignChatModel`，唯一实现 `ModelDesignChatReplier`）按**本项目**五个字段
 *      + 本项目完整 `chat`（含这次用户消息）生成回复与可选写回；模型失败时端口自己退回
 *      `DESIGN_WORKBENCH_CHAT_REPLY` 并标 `source: "fallback"`，本用例不区分。
 *   ③ 写回非空 ⇒ `projects.update`（与 `updateProject` 同一条 owner 谓词）；`applied` 只列真的写了的。
 *   ④ `projects.appendChat` 原子追加 `[user, ai(source)]` 两条，返回写回后的完整行。
 *
 * ## 事务边界（诚实版，同 `submit-feedback-draft.ts` 的写法）
 *
 * ③ 与 ④ 是两次独立的仓储调用。顺序选「先写回、后追加」：④ 失败 ⇒ 字段已更新、这轮对话没落
 * 库，用户看到 503 重发一次即可（重发时模型看到的是已更新的字段，不会重复写回同一改动）；
 * 反过来「先追加、后写回」失败 ⇒ 对话里已经写着「已更新验收标准」而字段没变——那是对用户撒谎。
 * ⚠ 首次引导语**不**在这里插入——展示层文案，见契约【待确认点 2】。
 */
import type { z } from "zod";
import { designAiCollab, designPrototype, type designWorkbench } from "@repo/contracts";

const designAiCollabFields = designAiCollab.DesignWritebackField.options;
import type { DesignChatModel } from "./design-chat-model";
import type { DesignProjectPatch } from "./project-ports";
import {
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  projectDesignProject,
  type DesignProjectDeps,
  type DesignProjectView,
} from "./project-shared";
import { ownerNamesFor } from "./project-shared";
// 迭代 11：把行的平行视图拼回屏（`applyPrototypePatch` 的入参形状），与人改那条路共用一份。
import { projectPatchOf, screensOf } from "./patch-prototype";

type DesignChatReply = z.infer<typeof designAiCollab.DesignChatReply>;
type DesignWritebackField = z.infer<typeof designAiCollab.DesignWritebackField>;

export interface AppendProjectChatDeps extends DesignProjectDeps {
  readonly ai: DesignChatModel;
}

/**
 * 2026-09-07 用户实测的数据丢失：用户说「增加设置页」，模型只回了 `writeback.frames`
 * （4 个标签），树还是 3 棵。库里于是存下 frames=4 / prototype=3，而读取侧
 * `pg-design-project-repository.ts` 的 `toPrototype` 长度对不上就整份返回 `[]`——
 * **整个画布下一次读取时全空**，用户看到的就是「怎么全部空了？」。
 *
 * 契约不变量本来就要求 `prototype` 要么为空、要么与 `frames` 等长（按位置对应）。所以
 * 只给 `frames` 的写回，只有在**不改变页数**时才是安全的（纯改标签）；增删页必须整页给
 * `prototype`（它自带标签）。长度对不上就按字段级拒绝丢掉这次 `frames`（同 I-10：
 * 宁可不写，也不写坏），而不是让它把已经画好的几页一起带走。
 */
function framesKeepPagesAligned(
  prototype: readonly (designPrototype.PrototypeNode | null)[],
  frames: readonly string[],
): boolean {
  return prototype.length === 0 || prototype.length === frames.length;
}

/**
 * issue #3340：给有树的页补 id，**未生成的页保持未生成**（落成 `null`）。
 *
 * 不能直接 `ensurePrototypeIds(screens.map(s => s.root))`——那会把 `undefined` 当成一棵树
 * 去遍历。id 要看**整个项目**（跨页唯一），所以补完再按原位置放回去，不是逐页各补各的。
 */
function ensureIdsKeepingHoles(
  screens: readonly { readonly root?: designPrototype.PrototypeNode }[],
): readonly (designPrototype.PrototypeNode | null)[] {
  const withTrees = screens.flatMap((s, i) => (s.root === undefined ? [] : [{ i, root: s.root }]));
  const ids = designPrototype.ensurePrototypeIds(withTrees.map((x) => x.root));
  const byIndex = new Map(withTrees.map((x, k) => [x.i, ids[k]!]));
  return screens.map((_, i) => byIndex.get(i) ?? null);
}

/**
 * patch 的写回必须**带上 `frames`**（页数以它为准，见 `screensOf` 的 ⚠），但 `applied` 是给
 * 用户看的「这次真的改了什么」——一次只改按钮文案的 patch 不该在屏上写着「已更新：页面标签」。
 * 标签一个字没变就把这个键摘掉：写回的内容不变（页数与旧的相同），少一条假的已更新。
 */
function framesTrimmed(patch: DesignProjectPatch, currentFrames: readonly string[]): DesignProjectPatch {
  const next = patch.frames;
  if (next === undefined) return patch;
  if (next.length !== currentFrames.length || next.some((f, i) => f !== currentFrames[i])) return patch;
  const { frames: _dropped, ...rest } = patch;
  return rest;
}

/**
 * 迭代 17：被丢掉的跳转 → 一句给用户看的人话。
 *
 * 原因用**闭集**穷举（`LinkDropReason`），漏一个编译不过——少一种原因的表现是
 * 屏上说「有 1 条跳转没连上」却说不出为什么，那比不说更让人困惑。
 *
 * 最多列三条：一次生成里连错十条通常是同一个原因，全列出来会把回复淹掉；
 * 多出来的只报个数。
 */
const LINK_DROP_TEXT: Record<designPrototype.LinkDropReason, string> = {
  TARGET_OUT_OF_RANGE: "指向的页不存在",
  SELF_LINK: "指向了自己这一页",
  FROM_NOT_FOUND: "这一页上找不到那个节点",
  ITEM_OUT_OF_RANGE: "指定的第几项超出了范围",
  DUPLICATE: "同一个位置重复连了两次",
  TOO_MANY: "这一页的跳转条数超过上限",
};

const DROPPED_NOTICE_MAX = 3;

export function describeDroppedLinks(
  dropped: readonly { readonly screen: number; readonly link: designPrototype.PrototypeLink; readonly reason: designPrototype.LinkDropReason }[],
  frames: readonly string[],
): string {
  if (dropped.length === 0) return "";
  const lines = dropped.slice(0, DROPPED_NOTICE_MAX).map((d) => {
    const page = frames[d.screen] ?? `第 ${String(d.screen)} 页`;
    return `「${page}」上 ${d.link.from} → 第 ${String(d.link.to)} 页：${LINK_DROP_TEXT[d.reason]}`;
  });
  const rest = dropped.length - lines.length;
  return (
    `\n\n⚠ 有 ${String(dropped.length)} 条跳转没连上，预览时点它们不会有反应：\n` +
    lines.map((l) => `· ${l}`).join("\n") +
    (rest > 0 ? `\n· 还有 ${String(rest)} 条同类问题。` : "") +
    "\n告诉我该连到哪一页，我把它们补上。"
  );
}

/** 迭代 2：把前端传来的 `focusNodeId` 解析成给模型看的焦点描述；找不到（已被删）⇒ 当没选。 */
function focusFor(row: { readonly frames: readonly string[]; readonly prototype: readonly (designPrototype.PrototypeNode | null)[] }, id: string | undefined) {
  if (id === undefined) return {};
  const hit = designPrototype.findPrototypeNodePath(row.prototype, id);
  if (hit === null) return {};
  const node = hit.path[hit.path.length - 1]!;
  return { focus: { id, frame: row.frames[hit.frameIndex] ?? "", path: hit.path.map(designPrototype.prototypeNodeLabel), node } };
}

export async function appendProjectChat(
  deps: AppendProjectChatDeps,
  input: {
    readonly projectId: string;
    readonly ownerId: string;
    readonly text: string;
    readonly focusNodeId?: string;
    /** 迭代 20：这一轮最多画几页（服务端强制截断）。不给 ⇒ 不设限。 */
    readonly maxScreens?: number;
    /**
     * 迭代 13：这一轮带给模型看的参考图**字节**。由 controller 用 `loadRefImageBytes` 取好传进来——
     * 本用例不认识对象存储，也不该为了几张图长出一个存储依赖。
     * 模型看不了图时由 `ModelDesignChatReplier` 自己在回复里如实说明（`BLIND_MODEL_NOTICE`），
     * 不在这里静默丢掉。
     */
    readonly refImages?: readonly { readonly filename: string; readonly mime: designWorkbench.ImageMime; readonly bytes: Uint8Array }[];
  },
): Promise<{ readonly project: DesignProjectView; readonly reply: DesignChatReply }> {
  const current = await deps.projects.get(input.projectId);
  if (current === null) throw new DesignProjectNotFoundError();
  if (current.ownerId !== input.ownerId) throw new DesignProjectNotOwnerError();

  /**
   * 迭代 16（#3773 R2）—— **生成期间就把画到一半的结果落库**。
   *
   * 在这之前，首次生成是「一次 HTTP 请求里画完 3–6 页再一次性写回」：用户屏上
   * 几分钟只有一个转圈，画布全程空白，刷新一下前功尽弃。而骨架轮十来秒就已经
   * 知道有哪几页了——那个事实一直被扣着不发。
   *
   * 现在 `generatePaged` 每定下骨架、每画好一页都会叫一次这个回调，这里把它落成
   * 一次**不记版本**的 `projects.update`。前端在这次请求还没返回时轮询项目，
   * 看到的就是页标签先出现、然后一页页长出来。
   *
   * 三条纪律：
   * ① **不记版本快照**——一次生成会叫 N+1 次，每次都记版本会把原型历史刷成一串半成品；
   *    版本只在收尾那次原子写回时记一条（"这一轮生成"是一版，不是六版）。
   * ② **抛了不影响生成**——`ModelDesignChatReplier.publish` 已经把它包在 try 里；
   *    这里再记一次日志，让"中途没存上"是看得见的，而不是悄悄退回老行为。
   * ③ **写的是同一份事实**——中途写和收尾写用同一个 `ensureIdsKeepingHoles`、同一个
   *    页序来源，不是两套拼法。收尾那次照写，中途写只是让它早点可见。
   */
  const persistProgress = async (screens: readonly { readonly frame: string; readonly root?: designPrototype.PrototypeNode; readonly notes?: string; readonly links?: readonly designPrototype.PrototypeLink[] }[]): Promise<void> => {
    const check = designPrototype.validateLinks(screens.map((x) => ({ root: x.root, links: x.links })));
    const written = await deps.projects.update(input.projectId, input.ownerId, {
      frames: screens.map((x) => x.frame),
      prototype: ensureIdsKeepingHoles(screens),
      frameNotes: screens.map((x) => (x.notes ?? "").trim()),
      frameLinks: check.links.map((l) => [...l]),
    });
    if (written === null) {
      deps.logger?.info("design chat: progress write skipped, project no longer owned", {
        projectId: input.projectId, traceId: deps.traceId ?? "",
      });
    }
  };

  const ai = await deps.ai.reply({
    onProgress: persistProgress,
    ...(input.maxScreens === undefined ? {} : { maxScreens: input.maxScreens }),
    name: current.name,
    template: current.template,
    problem: current.problem,
    criteria: current.criteria,
    frames: current.frames,
    prototype: current.prototype,
    ...focusFor(current, input.focusNodeId),
    ...(input.refImages !== undefined && input.refImages.length > 0 ? { refImages: input.refImages } : {}),
    chat: [...current.chat, { role: "user", text: input.text, at: new Date().toISOString() }],
  });

  /**
   * issue #3340：分页生成给的是 `pagedScreens`（**含没画出来的页**，`root` 缺省），
   * 它是服务端事实、优先于模型写回。整页写回（`writeback.prototype`）仍是老形状，
   * 每页都必须有树——两条路在这里汇成同一个「屏数组」，下游只认 `root` 可缺。
   */
  const screens: readonly {
    readonly frame: string;
    readonly root?: designPrototype.PrototypeNode;
    readonly notes?: string;
    readonly links?: readonly designPrototype.PrototypeLink[];
  }[] | undefined = ai.pagedScreens ?? ai.writeback.prototype;
  let patched: readonly {
    readonly frame?: string;
    readonly root?: designPrototype.PrototypeNode;
    readonly notes?: string;
    readonly links?: readonly designPrototype.PrototypeLink[];
  }[] | undefined;
  if (screens === undefined && ai.writeback.patch !== undefined) {
    if (current.prototype.length === 0) {
      deps.logger?.info("design chat: patch rejected, project has no prototype yet", { projectId: input.projectId, traceId: deps.traceId ?? "" });
    } else {
      try {
        patched = designPrototype.applyPrototypePatch(screensOf(current), ai.writeback.patch);
      } catch (e) {
        deps.logger?.info("design chat: patch rejected", { projectId: input.projectId, traceId: deps.traceId ?? "", detail: e instanceof Error ? e.message : "unknown" });
      }
    }
  }
  /**
   * 迭代 11：整页写回里的 `links` 要看整份 screens 才判得了（目标页存不存在），所以在这里过
   * `validateLinks`——**逐条丢、不整页拒**（delta §2 取舍 ①）：悬空的跳转不至于让整页作废。
   * 丢了要记日志：静默丢会让"模型说连好了、屏上点不动"看起来像模型抽风，而不是一条门控。
   */
  const linkCheck = screens === undefined ? undefined : designPrototype.validateLinks(
    screens.map((s) => ({ root: s.root, links: s.links })),
  );
  /**
   * 迭代 17 —— 被丢掉的跳转**要让用户看见**，不能只进服务端日志。
   *
   * 在这之前这里只 `logger.info` 一行。于是链路是这样的：模型在回复里说「点「去结算」
   * 会进结算页」→ 那条 link 指向一个不存在的页 → 服务端逐条丢掉（这是对的，悬空跳转
   * 不该让整页作废）→ 用户切到预览、按下去**没反应**。屏上没有任何痕迹说明这条线被
   * 丢了，用户只会以为"可点击原型"这件事本身不好使。
   *
   * 这正是本仓反复点名的那个形态：**界面声称的事情没有真的发生**。所以把它说出来，
   * 说清是哪一页的哪个节点、以及为什么——用户据此能直接让模型补一句「把 X 连到 Y」。
   *
   * ⚠ 放在**服务端追加的那一段**里，不改模型说的话（同 `BLIND_MODEL_NOTICE` 的成例）：
   *   模型说了什么是它的事实，服务端丢了什么是服务端的事实，两者不混。
   */
  const droppedNotice = linkCheck === undefined || linkCheck.dropped.length === 0
    ? ""
    : describeDroppedLinks(linkCheck.dropped, screens?.map((s) => s.frame) ?? []);
  if (linkCheck !== undefined && linkCheck.dropped.length > 0) {
    deps.logger?.info("design chat: links dropped", {
      projectId: input.projectId, traceId: deps.traceId ?? "",
      dropped: linkCheck.dropped.map((d) => `p${d.screen}:${d.link.from}->${d.link.to}:${d.reason}`).join(","),
    });
  }
  const patch: DesignProjectPatch = {
    /*
     * 迭代 17：骨架轮挑的强调色。只在**首次分页生成**那条路上会有，且只在它与项目现有
     * 档位不同的时候才写——否则每一轮对话都往 patch 里塞一个没变化的字段，
     * 每次都白写一遍库。
     *
     * 它**不进 `applied`**（那个闭集是 problem/criteria/frames/prototype 四项）：
     * 强调色的变化用户在画布上一眼就看见了，屏上再写一行「已更新：强调色」是噪音。
     */
    ...(ai.accent !== undefined && ai.accent !== current.accent ? { accent: ai.accent } : {}),
    ...(ai.writeback.problem !== undefined ? { problem: ai.writeback.problem } : {}),
    ...(ai.writeback.criteria !== undefined ? { criteria: ai.writeback.criteria } : {}),
    ...(screens !== undefined
      ? {
          frames: screens.map((s) => s.frame),
          prototype: ensureIdsKeepingHoles(screens),
          frameNotes: screens.map((s) => (s.notes ?? "").trim()),
          frameLinks: linkCheck?.links.map((l) => [...l]) ?? [],
        }
      : patched !== undefined ? framesTrimmed(projectPatchOf(patched), current.frames)
      : ai.writeback.frames !== undefined && framesKeepPagesAligned(current.prototype, ai.writeback.frames)
        ? { frames: ai.writeback.frames } : {}),
  };
  if (ai.writeback.frames !== undefined && screens === undefined && !framesKeepPagesAligned(current.prototype, ai.writeback.frames)) {
    // 拒绝要留痕：静默丢字段会让「模型说加了页、页数没变」看起来像模型抽风，而不是一条门控。
    deps.logger?.info("design chat: frames writeback rejected, page count would desync prototype", {
      projectId: input.projectId, frames: ai.writeback.frames.length, prototype: current.prototype.length,
      traceId: deps.traceId ?? "",
    });
  }
  // `applied` 只列契约闭集里的项目字段（`frameNotes` 随 `prototype` 一起写，不单列）。
  const applied = Object.keys(patch).filter((k): k is DesignWritebackField => (designAiCollabFields as readonly string[]).includes(k));
  /**
   * ⚠ 写库的条件是 **patch 非空**，不是 `applied` 非空。
   *
   * `applied` 是给**用户**看的「这次改了什么」，它的闭集 `DesignWritebackField` 只有
   * problem/criteria/frames/prototype 四项。迭代 17 往 patch 里加了 `accent`（骨架轮挑的
   * 强调色）——它不在那个闭集里，所以用 `applied.length > 0` 当写库条件的话，
   * 「只改了强调色」这一次会被**静默丢掉**：屏上不报错、库里没变化、用户以为设成功了。
   *
   * 这两件事本来就是两个问题（「要不要写」与「屏上说改了什么」），之前它们恰好同解，
   * 于是被写成了一个条件。现在分开。
   */
  if (Object.keys(patch).length > 0) {
    // 迭代 3：原型真的变了（整页 / patch）⇒ 与 UPDATE 同一事务追加一条版本快照。只改标签（树被清空）不记——那不是一版原型。
    const version = patch.prototype !== undefined ? { source: "model" as const, summary: ai.text.replace(/\s+/g, " ").trim().slice(0, 120) } : undefined;
    const written = await deps.projects.update(input.projectId, input.ownerId, patch, version);
    if (written === null) throw new DesignProjectNotOwnerError();
  }

  const updated = await deps.projects.appendChat(input.projectId, input.ownerId, [
    { role: "user", text: input.text },
    // 迭代 17：模型说的话 + 服务端追加的「哪几条跳转没连上」。
    { role: "ai", text: (ai.text + droppedNotice).slice(0, 4200), source: ai.source },
  ]);
  if (updated === null) throw new DesignProjectNotOwnerError();

  const names = await ownerNamesFor(deps, [updated.ownerId]);
  return {
    project: projectDesignProject(updated, names.get(updated.ownerId) ?? null, input.ownerId),
    reply: { source: ai.source, applied, suggestions: [...ai.suggestions], ...(ai.fallbackReason === undefined ? {} : { fallbackReason: ai.fallbackReason }) },
  };
}
