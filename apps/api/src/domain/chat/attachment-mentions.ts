/**
 * issue #3727 —— `@文件名` 引用历史附件的**服务端解析规则**（纯函数，单测直接钉）。
 *
 * ## 为什么在这里解析，而不是让前端把 id 带上
 *
 * composer 的 `@` 选择器把 `@<filename> ` 当纯文本插进正文，刻意不碰 `attachmentIds`
 * （`ATTACHMENT_NOT_PENDING` 不允许一个附件挂到第二条消息）。这条设计没错，错的是
 * run 侧从来没有把正文里的引用**翻译回附件**：`/inputs` 挂载与视觉输入都只看
 * `message_id = 触发消息`，于是用户 @ 了上一轮的截图，模型在沙箱里什么都找不到
 * （devapp 实测，`maau-recursive-asset-report` 场景）。
 *
 * ## 规则（两条读路径共用，`pg-native-run-inputs.ts` / `pg-run-image-input.ts`）
 *
 *   1. 触发消息自己挂的附件**全部**保留（原有语义不变）。
 *   2. 同线程、同作者、人类消息上的历史附件，只有当正文里出现 `@<filename>` 且其后是
 *      空白 / 行尾 / 常见标点时才纳入——文件名可含空格（`截屏2026-09-18 15.48.24.png`），
 *      所以是"拿已知文件名去正文里找"，不是"从正文里切 token"。
 *   3. 同名多份取最新一份（`created_at` 大者；再平局取 `id` 大者）；触发消息里已经有
 *      同名附件时，历史那份不再重复纳入（用户这轮重新传了）。
 *   4. 顺序：触发消息附件在前（按 id），引用附件在后（按 created_at）。
 *
 * 权限**不在这里**：候选行由 SQL 谓词（同线程 ∧ 同作者 ∧ 人类消息）先框定，本函数只做
 * 文本匹配与去重；它拿不到范围之外的行。
 */

export interface RunAttachmentCandidate {
  readonly id: string;
  readonly filename: string;
  readonly message_id: string | null;
  readonly created_at: string | number | Date;
}

const TRAILING = "(?=\\s|$|[,，。；;:：!！?？)）\\]】])";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 正文里是否以 `@<filename>` 形式点名了这个文件。 */
export function isAttachmentMentioned(body: string, filename: string): boolean {
  if (!filename) return false;
  return new RegExp(`@${escapeRegExp(filename)}${TRAILING}`, "u").test(body);
}

/** 廉价预判：正文里根本没有 `@x` 形态 ⇒ 不必去查历史附件（保持无 @ 的 run 逐字节不变）。 */
export function mayMentionAttachments(body: string): boolean {
  return /@\S/u.test(body);
}

function createdAtMs(value: RunAttachmentCandidate["created_at"]): number {
  const n = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 把 SQL 框定的候选行收敛成本次 run 的附件范围：触发消息附件 + 正文点名的历史附件。
 */
export function selectRunScopedAttachments<T extends RunAttachmentCandidate>(
  rows: readonly T[],
  inputMessageId: string,
  body: string,
): T[] {
  const current = rows.filter((r) => r.message_id === inputMessageId).sort((a, b) => a.id.localeCompare(b.id));
  const taken = new Set(current.map((r) => r.filename));
  const latestByFilename = new Map<string, T>();
  for (const row of rows) {
    if (row.message_id === inputMessageId || taken.has(row.filename)) continue;
    if (!isAttachmentMentioned(body, row.filename)) continue;
    const prev = latestByFilename.get(row.filename);
    if (
      !prev ||
      createdAtMs(row.created_at) > createdAtMs(prev.created_at) ||
      (createdAtMs(row.created_at) === createdAtMs(prev.created_at) && row.id.localeCompare(prev.id) > 0)
    ) latestByFilename.set(row.filename, row);
  }
  const mentioned = [...latestByFilename.values()].sort(
    (a, b) => createdAtMs(a.created_at) - createdAtMs(b.created_at) || a.id.localeCompare(b.id),
  );
  return [...current, ...mentioned];
}
