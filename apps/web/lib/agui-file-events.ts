"use client";
import * as React from "react";
import {
  parseAguiFileCreatedValue,
  parseAguiFileContentDeltaValue,
  AGUI_FILE_EVENT_NAME,
  type AguiFileCreatedValue,
} from "@repo/contracts/agui-state-events";

/**
 * DA-13（双栏联动：Chat + 活动文件工作台）—— DA-15 定义的 `file_created`/
 * `file_content_delta` 两个 AG-UI `CUSTOM {name,value}` 事件的前端消费点。
 *
 * ## 它接的是哪根线
 *
 * `copilotkit-v2-panel.tsx` 用 `useAgent`（`@copilotkit/react-core/v2`）拿到的
 * `agent` 是一个 `AbstractAgent`（`@ag-ui/client`），`agent.subscribe(...)` 对它
 * 而言"总是安全"（该 hook 自己的类型注释原话）。`onCustomEvent` 的签名与
 * `copilotkit-preview-panel.tsx`/`useAguiPlanTodos` 消费 `onStateSnapshotEvent`
 * 是同一套 `@ag-ui/client` `AgentSubscriber` 接口，这里只是换了要认的 `name`。
 *
 * ## 解析纪律：单一事实源，同 `useAguiPlanTodos`
 *
 * `CustomEventSchema.value` 在协议层是 `unknown`——即便后端声称按契约发的，前端仍要
 * 用 `@repo/contracts/agui-state-events` 导出的同一个 zod schema 原地再校验一次。
 * 解析失败：`file_created` 直接丢弃这一帧（没有已知文件可以关联）；`file_content_delta`
 * 引用了未知 `uri` 或解析失败同样丢弃——不编造文件、不编造内容。
 *
 * ## 目前没有真实生产者——如实登记
 *
 * `packages/contracts/src/agui-state-events.ts` DA-15 段落原文：这两个事件"目前没有
 * 真实生产者"。`deepagents` 的 `FilesystemMiddleware` 已经在 `harness.py` 里挂载
 * （`write_file`/`edit_file` 是模型可以真实调用的工具），但它写入的是单次 run 状态内的
 * 临时虚拟文件系统，不落 DB；DA-12 的 VFS（`vfs://<attachment|artifact>/<id>`）明确
 * 要求 `id` 是"该 domain 自己权威表里的主键"，VFS 自己不发号、不落库
 * （`apps/api/src/domain/vfs/vfs-uri.ts` 文件头）。把 `FilesystemMiddleware` 的临时
 * 文件硬套进这两个既有 domain 会谎称它们已经落库——不做这个假映射。因此本任务只交付
 * 消费端（本文件 + `active-file-panel.tsx`），e2e 证据走协议精确的 wire-level 测试
 * 夹具（见 `e2e/copilotkit-v2-active-file-panel.spec.ts` 文件头），真实生产端的接线
 * （FilesystemMiddleware 写入 → 落地为 `chat_message_attachments` → 真实 VFS id）
 * 登记为后续任务，不在本次范围内臆造。
 */

export interface ActiveFile {
  readonly uri: string;
  readonly name: string;
  readonly mime: string | null;
  readonly source: AguiFileCreatedValue["source"];
  /** issue #2321 round 4 —— `AguiFileCreatedValue.bytes` 原样透传，供
   *  `active-file-panel.tsx` 的 `source === "agent_run_output"` 下载卡片显示人读文件
   *  大小；未知时为 `null`（同源字段的 nullable 语义，不是本文件新造的口径）。 */
  readonly bytes: number | null;
  /** 按 `sequence` 顺序累加的内容；`file_created` 到达但还没有任何 delta 时是空字符串。 */
  readonly content: string;
  /** 下一帧期望的 `sequence`（已处理到的最大值 + 1）——用于按序丢弃乱序/重复帧。 */
  readonly nextSequence: number;
}

export function useAguiFileEvents(): {
  /** 按 `file_created` 到达顺序排列，供面板渲染 tab 列表。 */
  readonly files: readonly ActiveFile[];
  readonly onCustomEvent: (params: { event: { name?: string; value?: unknown } }) => void;
  readonly reset: () => void;
  /**
   * 2026-08-30 人类实测反馈：生成完的 docx/pdf/xlsx 一旦刷新页面或重新打开这条线程
   * 就再也看不到下载卡片，只剩消息正文里那句纯文字描述——**不是**样式问题，是这个
   * hook 本身只认"这个浏览器会话亲眼看到的 `file_created` 事件"，没有任何从历史
   * 数据回填的路径。事件是 SSE 一次性推送，不落任何表；`chat_message_attachments`
   * 这张表倒是真落库了，但落库的是文件本身，不是"这条 AG-UI 事件曾经发生过"这件事。
   * 调用方（`copilotkit-v2-panel.tsx`）在回读历史消息时，用 `listThreadAttachments`
   * 读回同一批已落库的附件，为其中挂在助手消息上的那些在本地重建等价的
   * `ActiveFile` 记录，喂给这个函数——不是凭空造事件，是把一件已经真实发生、只是
   * 没被这次页面加载亲眼看到的事实回填进来。
   *
   * ⚠ 只增不减、不覆盖已有 uri：真实 SSE 事件（正在跑的 run）与回填的历史事件
   * 可能在同一次挂载里先后到达，谁先到都不该把后到的那份（内容更完整，例如
   * `content` 字段）冲掉。
   */
  readonly hydrate: (files: readonly ActiveFile[]) => void;
} {
  const [order, setOrder] = React.useState<readonly string[]>([]);
  const [byUri, setByUri] = React.useState<ReadonlyMap<string, ActiveFile>>(new Map());

  const onCustomEvent = React.useCallback((params: { event: { name?: string; value?: unknown } }) => {
    const { name, value } = params.event;
    if (name === AGUI_FILE_EVENT_NAME.FILE_CREATED) {
      const parsed = parseAguiFileCreatedValue(value);
      if (parsed === null) return;
      setByUri((prev) => {
        if (prev.has(parsed.uri)) return prev; // 同一 uri 的重复 file_created 不覆盖已有内容
        const next = new Map(prev);
        next.set(parsed.uri, {
          uri: parsed.uri,
          name: parsed.name,
          mime: parsed.mime,
          source: parsed.source,
          bytes: parsed.bytes,
          content: "",
          nextSequence: 0,
        });
        return next;
      });
      setOrder((prev) => (prev.includes(parsed.uri) ? prev : [...prev, parsed.uri]));
      return;
    }
    if (name === AGUI_FILE_EVENT_NAME.FILE_CONTENT_DELTA) {
      const parsed = parseAguiFileContentDeltaValue(value);
      if (parsed === null) return;
      setByUri((prev) => {
        const existing = prev.get(parsed.uri);
        // 未知 uri（对应的 file_created 没到达或校验失败）—— 不凭空造一个文件条目。
        if (!existing) return prev;
        // 乱序/重复帧：只接受恰好等于期望序号的下一帧，其余丢弃（同 `sequence` 字段的
        // 设计意图，见契约文件头"客户端靠它检测丢失/乱序"）。
        if (parsed.sequence !== existing.nextSequence) return prev;
        const next = new Map(prev);
        next.set(parsed.uri, {
          ...existing,
          content: existing.content + parsed.delta,
          nextSequence: existing.nextSequence + 1,
        });
        return next;
      });
    }
  }, []);

  const reset = React.useCallback(() => {
    setOrder([]);
    setByUri(new Map());
  }, []);

  const hydrate = React.useCallback((incoming: readonly ActiveFile[]) => {
    if (incoming.length === 0) return;
    setByUri((prev) => {
      const additions = incoming.filter((f) => !prev.has(f.uri));
      if (additions.length === 0) return prev;
      const next = new Map(prev);
      for (const file of additions) next.set(file.uri, file);
      return next;
    });
    setOrder((prev) => {
      const additions = incoming.filter((f) => !prev.includes(f.uri)).map((f) => f.uri);
      if (additions.length === 0) return prev;
      return [...prev, ...additions];
    });
  }, []);

  const files = React.useMemo(() => order.map((uri) => byUri.get(uri)).filter((f): f is ActiveFile => f !== undefined), [order, byUri]);

  return { files, onCustomEvent, reset, hydrate };
}
