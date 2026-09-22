/**
 * **围栏级身份**（issue #3252）——回答「这份保存版是不是**这一个**围栏的」。
 *
 * ## 被修的缺陷
 *
 * 在此之前，保存版归属判定的唯一判据是 `checkCanvasFence(...).key`，也就是**模板名**。
 * 模板名只能说明「模板一样」，说明不了「是不是这一个围栏」：一条助手消息里两个
 * **同模板**画布，彼此的保存版会互相认领——编辑并保存第一个之后，第二个在「挂载即
 * 读回」时把第一个的字节当成自己的读进来。10 个画布的真实场景里出现重复模板 key
 * 几乎是必然（#3243 人类实测一轮就要了 10 个模板），所以这不是理论风险。
 *
 * ## 身份取什么
 *
 * 取**围栏原文的内容指纹**：`lang` + 归一化后的围栏源码算一个 FNV-1a 32 位摘要。
 *
 * ⚠ **刻意不用「按出现顺序编号」**（issue 交付要求逐字点名）：重排、增删、流式重放
 *   都会让顺序变化，用顺序当身份等于引入一个更隐蔽的错配——第 2 个围栏在下一次渲染
 *   里变成第 3 个，于是去认领别人的保存版，而且看起来一切正常。内容指纹对这三种
 *   变化都免疫：同一个围栏无论排在第几、重放多少次，字节一样，指纹就一样。
 *
 * ⚠ 指纹算的是**围栏原文**（助手消息里那段 `code`），不是编辑后的保存内容。保存内容
 *   会随用户贴便签、改文字而变，拿它算身份等于「编辑一次就换一个身份」。消息正文
 *   不会被回写（见 `chat-canvas-fabric.tsx` 关于「不回写消息 text」的人类裁决），
 *   所以围栏原文在刷新前后逐字节稳定。
 *
 * ## 身份怎么跟着保存版走
 *
 * 落库这一侧**没有**可放围栏身份的列：`chat_artifact_landings` 只有
 * `(threadId, messageId)`，`landAsArtifact.in` 也只有 `mode/title/payloadRef`
 * （见 `packages/contracts/src/chat.ts`）。三者里只有 `title` 是调用方自由字符串，
 * 因此身份**写在标题末尾**的一段机器可读后缀里：
 *
 * ```
 * 工作坊画布 · 2026/9/21 10:00:00 · 围栏 3f2a9c14
 * ```
 *
 * 写进 `payloadRef` 不行——那是围栏源码本体，多一行 `围栏: xxx` 会被
 * `parseTemplateText` 解析成一个表头字段，真的画到画布上去。
 *
 * ⚠ 这里是围栏身份的**唯一**事实源：算指纹、写标题、读标题三件事都只在本文件实现，
 *   调用方不许自己拼这段后缀，也不许再写一个「差不多的」比较函数。
 */
import { checkCanvasFence, type CanvasFenceLang } from "./canvas-fence";

/** 标题后缀：`· 围栏 <8 位十六进制>`。写与读共用同一个来源，避免两处各写一遍格式。 */
const TITLE_TAG_PREFIX = " · 围栏 ";
const TITLE_TAG_RE = /\s·\s围栏\s([0-9a-f]{8})$/;

/**
 * 归一化：只吃掉「同一份内容的无意义排版差异」（行尾空白、首尾空行），不碰正文。
 * 流式重放与最终落定的围栏字节本应完全一致，这一步是保险，不是判据的主体。
 */
function normalize(code: string): string {
  return code.split("\n").map((line) => line.trimEnd()).join("\n").trim();
}

/** FNV-1a 32 位——纯函数、无依赖、浏览器/Node 都能同步算（`crypto.subtle` 是异步的，
 * 而身份要在 `useMemo` 里同步拿到）。这里要的是「同一围栏恒得同一值、不同围栏极大
 * 概率不同」，不是密码学强度。 */
function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * 这个围栏的身份。围栏本身不合法（`checkCanvasFence` 判否）⇒ `null`：连「是不是
 * 一个画布」都不成立的东西不该有身份，也不该去认领任何保存版。
 */
export function canvasFenceIdentity(code: string, lang: CanvasFenceLang): string | null {
  const checked = checkCanvasFence(code, lang);
  if (!checked.ok) return null;
  return fnv1a32(`${lang}\u0000${normalize(code)}`);
}

/** 把围栏身份写进落地标题。`identity === null`（围栏不合法）⇒ 标题原样不加后缀。 */
export function tagCanvasArtifactTitle(title: string, identity: string | null): string {
  return identity === null ? title : `${title}${TITLE_TAG_PREFIX}${identity}`;
}

/** 从落地标题里读回围栏身份；没有后缀（旧存量 / 非围栏落地）⇒ `null`。 */
export function readCanvasFenceIdentity(title: string): string | null {
  return TITLE_TAG_RE.exec(title)?.[1] ?? null;
}

/**
 * 去掉围栏身份后缀，给**人看**的标题。
 *
 * 身份是这条链路的内部关联键，不是用户写的内容——右栏产物列表把它原样显示出来，
 * 等于把一个前端实现细节漏进用户的产物清单里（`fence-template-resolver.ts` 拒绝
 * 命名空间化模板 key 时是同一条理由）。没有后缀的标题原样返回。
 */
export function stripCanvasFenceIdentity(title: string): string {
  return title.replace(TITLE_TAG_RE, "");
}

/**
 * 「这份保存版属于本围栏吗」的**唯一**判据，纯函数，供 `ChatCanvasFabric` 的
 * `accepts` 回调直接转发。
 *
 * 三条，按顺序：
 *
 * ① **模板必须一样**——旧判据原样保留为**必要条件**（不是充分条件）。模板都不同的
 *    保存版连长得像都算不上。
 * ② 标题**带**围栏身份 ⇒ 必须逐字等于本围栏的身份。这是 #3252 的正解：同模板的
 *    两个围栏在这一步分得开。
 * ③ 标题**不带**围栏身份（本次修复之前存下的旧产物，或「落地为产物（草稿）」把
 *    整条消息正文落成的那种非围栏产物）⇒ 只有在**本消息里没有第二个同模板围栏**时
 *    才接受。有第二个时，这份字节归谁**无从判断**，判否、由调用方退回围栏原文——
 *    与 `diagram-readback.ts` 里 #3230 那条「判否就返回 null，诚实降级」同一条纪律。
 *    ⚠ 不能一律判否：那会让本次修复之前保存过画布的用户，刷新后读不回自己的保存版。
 */
export function acceptsSavedCanvasSource(input: {
  /** 本围栏的身份（`canvasFenceIdentity` 的结果）。 */
  readonly fenceIdentity: string | null;
  /** 本围栏的模板 key。 */
  readonly templateKey: string | null;
  /** 候选保存版的落地标题。 */
  readonly savedTitle: string;
  /** 候选保存版解析出的模板 key（不是合法围栏 ⇒ `null`）。 */
  readonly savedTemplateKey: string | null;
  /** 同一条消息里是否还有**另一个**同模板围栏——决定旧存量能不能被归属（第 ③ 条）。 */
  readonly templateKeyAmbiguous: boolean;
}): boolean {
  if (input.fenceIdentity === null || input.templateKey === null) return false;
  if (input.savedTemplateKey !== input.templateKey) return false;
  const tagged = readCanvasFenceIdentity(input.savedTitle);
  if (tagged !== null) return tagged === input.fenceIdentity;
  return !input.templateKeyAmbiguous;
}
