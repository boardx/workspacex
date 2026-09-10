/**
 * issue #3356 —— 个人对话列表的**键集游标**（keyset / seek pagination）。
 *
 * ## 为什么是游标，不是 offset
 *
 * 这条列表的排序键 `last_activity_at` 一直在动：每收到一条消息，那条对话就跳到
 * 最前面；而侧栏本身每 10 秒 + 每次窗口回焦各刷新一次（见
 * `copilotkit-v2-shell.tsx` 的 `useIntervalFocusRefresh`）。在这种列表上：
 *
 *   · `OFFSET 30` 说的是「跳过当前排序下的前 30 行」。翻第二页之前只要有**任意
 *     一条**老对话被顶到最前，原来的第 30 行就整体后移一格 ⇒ 它会**在第二页里
 *     再出现一次**（重复）；反过来有对话下沉，第 30 行前移 ⇒ 那一条**谁都看不到**
 *     （漏项）。这正是 issue 里点名的「分页最经典的坑」。
 *   · 游标把「从哪儿继续」钉在**一个具体的行**上（它的排序键值），不依赖它前面
 *     还剩几行。前后两页因此**永不重复**。
 *
 * 游标也不是完美的：一条已经翻过去的对话被顶到最前之后，后续页不会再返回它
 * （它已经不在游标之后了）——但它**仍然在用户已加载的列表里**（第一页那份还在），
 * 所以用户看不到「丢了一条」。用 offset 时同样的事件造成的是**重复**和**真的漏项**，
 * 两者不是一个量级。
 *
 * ## 排序键必须与 SQL 的 ORDER BY 逐字对应
 *
 * `ORDER BY t.pinned DESC, t.last_activity_at DESC, t.id DESC`，游标就是这个三元组。
 * 三列**同方向（全 DESC）**是刻意的：只有全同向才能写成一次行值比较
 * `(pinned, last_activity_at, id) < (...)`——混方向（例如 id ASC）就得手写三层
 * OR 嵌套，那种手写谓词在本仓的历史里正是边界条件出错的地方。
 *
 * ⚠ 原来的 `ORDER BY t.last_activity_at DESC, t.id`（id 升序）改成 `t.id DESC`：
 *   `id` 在这里只承担**打破并列**的职责（见 `list-personal-threads.ts` 里那段关于
 *   不稳定排序导致「点第 N 行选中相邻行」的头注），方向本身没有语义，改成 DESC
 *   仍然是同一个稳定全序。
 * ⚠ `pinned` 排最前，是因为前端会把置顶卡片摘进「置顶」组。若置顶的对话按时间散落
 *   在深页，那个组在翻到那一页之前都是**残缺**的——用户置顶恰恰是为了「一直看得见」。
 */

/** 游标里编码的排序键三元组——与 SQL 的 ORDER BY 一一对应。 */
export interface ThreadListCursor {
  readonly pinned: boolean;
  /** ISO-8601，与 `ThreadCard.lastActivityAt` 同一个字符串。 */
  readonly lastActivityAt: string;
  readonly threadId: string;
}

const SEP = " ";

/**
 * 编码成一个**不透明**字符串。用 base64url 不是为了保密（里面没有秘密），
 * 而是为了让它**看起来就不该被解析**：调用方一旦开始拼 `id` 或者比较大小，
 * 「从哪继续」这件事就有了第二个事实源。
 */
export function encodeThreadListCursor(cursor: ThreadListCursor): string {
  const raw = [cursor.pinned ? "1" : "0", cursor.lastActivityAt, cursor.threadId].join(SEP);
  return Buffer.from(raw, "utf8").toString("base64url");
}

/**
 * 解码。**任何形状不对的输入一律返回 `null`**（不抛）——调用方把 `null` 当作
 * 「没有游标 = 从头开始」处理。一个用户手改过的 query string 不该变成 500。
 */
export function decodeThreadListCursor(encoded: string | undefined | null): ThreadListCursor | null {
  if (!encoded) return null;
  let raw: string;
  try {
    raw = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const parts = raw.split(SEP);
  if (parts.length !== 3) return null;
  const [pinned, lastActivityAt, threadId] = parts;
  if (pinned !== "0" && pinned !== "1") return null;
  if (lastActivityAt === undefined || lastActivityAt === "" || threadId === undefined || threadId === "") return null;
  if (Number.isNaN(Date.parse(lastActivityAt))) return null;
  return { pinned: pinned === "1", lastActivityAt, threadId };
}
