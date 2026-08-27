/**
 * chat 里一条 ```canvas 围栏的 `模板: <key>` 要渲染成什么几何 —— 这里决定。
 *
 * ⚠ 这条路径只服务**工作坊画布模板（便签协作模板）**，与 mermaid 图表那条路径
 *   零交集：不 import mermaid、不查 `MermaidDiagramType`、不共用任何判断函数。
 *
 * 三条出口，与围栏渲染组件的三个状态一一对应：
 *   ① 内置原生几何——直接用 `fabric-markdown` 自带的 A0 精美几何，**不做自动布局**。
 *      内置模板的坐标是人调过的（persona 的 `{x:290,y:360,w:460,h:320}` 不是任何算法
 *      能算出来的），自动布局覆盖它只会更难看。命中条件：`key` 是 19 个内置 key 之一，
 *      **且**组织没有把它标成 `layoutSource: "user-edited"`（无 orgId / 查询失败 /
 *      组织没有这个 key 的行 / 有行但还是 `builtin-derived` 默认值，四种情况都算）。
 *   ② 组织自定义几何——走 `GET /canvas/templates` 拿 `SectionDef[]`，交给
 *      `buildAutoTemplateSpec` 现算几何，`registerTemplate` 进引擎全局表。命中条件：
 *      组织有这个 key 的行，**且**（`key` 不是内置 key，**或者** `layoutSource` 是
 *      `"user-edited"`——真人在模板编辑器里改过并保存过）。
 *   ③ 都不是 → 诚实错误态（不静默退回 mock，也不渲染一个空画布）。
 *
 * ## #2221：为什么内置 key 现在也要查一次组织模板库
 *
 * `backfill-canvas-builtin-templates.ts` 给每个开通过的组织把 19 个内置模板的行都建好
 * 了（layout 字段也已推算齐全）——「组织库里有这个 key 的行」对 19 个内置 key **恒真**，
 * 不能拿它当「用户真的在编辑器里改过」的判据（那正是本次要修的根因：旧实现只要
 * `getTemplate(key)` 命中内置注册表就直接用原生几何，从不查 DB，于是模板编辑器里对
 * 内置模板发布的自定义从未真正影响过 chat 渲染）。现在改成查 `layoutSource` 这一列：
 * `"user-edited"` 才代表真人介入过，`"builtin-derived"`（backfill 的默认值）不算数。
 * 查询失败或没有 orgId 时优雅退回出口①，不炸围栏渲染（见下方 catch 分支）。
 *
 * ## 取数走单出口
 *
 * 一律经 `lib/live-canvas.ts` 的 `listCanvasTemplates`（本仓铁律：URL 字面量只许出现在
 * 契约里，`live-canvas.ts` 从 `canvas.operations.*.path` 取路径，有机械门控）。
 * 这里不出现任何路径字符串，也不定义第二份 `TemplateRow`。
 *
 * ## 个人对话为什么也能用
 *
 * `listTemplates` 的鉴权是**组织成员**（`orgId` 来自会话的 `currentOrgId`），不是项目角色，
 * 更不是 `artifact.land` 那个「能不能保存产物」的能力位。个人对话跑在
 * `kind: "personal-local"` 的个人组织里，一样有 `currentOrgId`，所以这条渲染路径
 * 天然可用 —— 它**不读 `projectId`**，这一点由 `tests/ui/chat-canvas-fence.test.tsx`
 * 的「个人对话上下文同样渲染」钉死。
 *
 * ## 全局注册表冲突：怎么处理、边界在哪
 *
 * `registerTemplate` 写的是 `template-engine.ts` 里的**模块级全局 Map**，key 就是模板 key，
 * 而且**没有 `unregisterTemplate`** —— 注册进去就拿不出来。这带来两类冲突：
 *
 *   · **组织模板与内置模板同 key**：内置**默认赢**（出口①），除非组织真的在编辑器里
 *     自定义过这个 key（`layoutSource === "user-edited"`，出口②）——#2221 之前这条
 *     判据写死成「内置恒赢，连查都不查」，代价是模板编辑器对内置 key 的发布永远不生效；
 *     现在改成「先查，`user-edited` 才赢」。若组织的自建行只是 backfill 出来的默认值
 *     （`layoutSource === "builtin-derived"`），仍然是内置几何赢——理由不是「先到先得」，
 *     而是「组织真的建了一个自己维护的同名模板」（自建行是 backfill 默认值时用户根本
 *     没碰过它，用内置几何才是「没人改过」这件事的诚实呈现）。需要精确区分
 *     「组织真同名自建」与「backfill 默认值」时应由后台在建模板时禁用内置 key（后端的事，
 *     不在本次范围）。
 *   · **不同组织的同 key**：只能「最后注册的赢」。我们用 `AUTO_OWNER` 记住每个 key 当前
 *     由哪个 `orgId@version` 占着，owner 不同就重新注册一次（版本升级也走这条路，
 *     所以发布新版后刷新即生效）。**边界**：同一个页面里同时渲染两个不同组织的同 key
 *     模板会互相覆盖 —— chat 一次只处在一个组织上下文里，这种情形在本仓不可达；
 *     真要支持得让 `fabric-markdown` 提供「按调用传 spec」的渲染入口，而那要改包，
 *     vendor 纪律不许（见 VENDOR.md）。所以这里选择**记录边界**而不是发明一个
 *     命名空间化 key —— 命名空间化会让 `serializeTemplate` 把 `模板: org:xxx:swot@v3`
 *     写回 markdown，等于把一个前端实现细节漏进用户的文档里。
 */
import { getTemplate, registerTemplate } from "@repo/fabric-markdown";
import { canvas } from "@repo/contracts";
import { listCanvasTemplates, type CanvasTemplate } from "@/lib/live-canvas";
import { buildAutoTemplateSpec } from "./auto-template-layout";

export type CanvasFenceTemplateSource = "builtin" | "org-generated";

export type ResolveTemplateOutcome =
  | { readonly ok: true; readonly source: CanvasFenceTemplateSource }
  | {
      readonly ok: false;
      /** `no-org` = 还没有会话/组织上下文；`not-found` = 组织里没有这个 key；`fetch-failed` = 请求失败。 */
      readonly reason: "no-org" | "not-found" | "fetch-failed";
      readonly detail: string;
    };

/** key → 当前占用它的 `orgId@version`。只记自动生成的那些，内置模板不进这张表。 */
const AUTO_OWNER = new Map<string, string>();

/** 30 秒的组织模板列表缓存：一条消息里可能有多个围栏，不该打多次同样的 GET。 */
const LIST_TTL_MS = 30_000;
let listCache: { orgId: string; at: number; promise: Promise<readonly CanvasTemplate[]> } | null = null;

function loadOrgTemplates(orgId: string): Promise<readonly CanvasTemplate[]> {
  const now = Date.now();
  if (listCache && listCache.orgId === orgId && now - listCache.at < LIST_TTL_MS) {
    return listCache.promise;
  }
  // 不传 filter：围栏要的是「这个 key 长什么样」，不是「它能不能被绑定」。
  // 用 forBinding 过滤掉草稿，会让作者刚建好、还没发布的模板在 chat 里渲染成
  // 「未知模板」——那是一个看起来像 bug 的正确行为，不如照实渲染。
  const promise = listCanvasTemplates({ orgId })
    .then((out) => out.templates)
    .catch((e: unknown) => {
      // 失败不缓存，否则一次网络抖动会静默毒化随后 30 秒的所有围栏。
      if (listCache?.promise === promise) listCache = null;
      throw e;
    });
  listCache = { orgId, at: now, promise };
  return promise;
}

/** 仅供测试：清掉进程内缓存（注册表本身清不掉，见文件头）。 */
export function __resetFenceTemplateCache(): void {
  listCache = null;
  AUTO_OWNER.clear();
}

/**
 * 保证 `key` 在引擎全局表里有一个可渲染的 spec。返回它来自哪儿 / 为什么失败。
 */
export async function ensureCanvasFenceTemplate(input: {
  readonly key: string;
  readonly orgId: string | null;
}): Promise<ResolveTemplateOutcome> {
  const { key, orgId } = input;
  // ⚠ 判据是契约的 `BUILTIN_CANVAS_TEMPLATES`（O-09 单点事实源），**不是** `getTemplate(key)`
  //   是否返回真值：后者在这个 key 被自动注册（出口②）之后也会变真，两者一旦混用，
  //   「这个 key 本来是不是内置的」这件事在第二次解析起就判不出来了（见 #2221 教训：
  //   旧实现正是靠 `getTemplate` 的可变状态做「内置 vs 自建」的判定，本身没错，但因此
  //   顺手把「命中内置注册表」和「不查 DB」焊在了一起）。
  const isBuiltinKey = canvas.builtinDisplayName(key) !== undefined;

  if (!orgId) {
    // 无组织上下文：内置 key 仍有原生几何兜底；非内置 key 没有任何来源，诚实报错。
    if (isBuiltinKey) return { ok: true, source: "builtin" };
    return { ok: false, reason: "no-org", detail: key };
  }

  let rows: readonly CanvasTemplate[];
  try {
    rows = await loadOrgTemplates(orgId);
  } catch (e) {
    // #2221 verification③：查询失败时内置 key 优雅退回原生几何，不炸围栏渲染；
    // 非内置 key 没有兜底可言，才真的走 fetch-failed。
    if (isBuiltinKey) return { ok: true, source: "builtin" };
    return { ok: false, reason: "fetch-failed", detail: e instanceof Error ? e.message : String(e) };
  }

  const matches = rows.filter((t) => t.key === key);
  if (matches.length === 0) {
    if (isBuiltinKey) return { ok: true, source: "builtin" };
    return { ok: false, reason: "not-found", detail: key };
  }
  // 同一 key 多版本时取最高版本 —— 「用这个模板」在用户心里就是「用它最新的样子」。
  // ⚠ 判据看的是**这一行**（最高版本）的 layoutSource，不是"这个 key 有没有任何一个
  //   版本曾经是 user-edited"——「用这个模板」用的是它现在最新的样子，一个更早的版本
  //   曾被自定义过、但最新版本又被（比如 backfill 的「补齐配置」）铸成新草稿的场景，
  //   要看新版本自己的 layoutSource，而不是翻旧账（且写入侧的单调不可退回已经保证了
  //   "一旦某个新版本继承自 user-edited 谱系就不会被标回 builtin-derived"，见
  //   `pg-canvas-template-repository.ts` 的 `mintVersion`）。
  const row = matches.reduce((a, b) => (b.version > a.version ? b : a));

  // #2221 根因修复：内置 key 只有在组织真的自定义过（layoutSource === "user-edited"）
  // 时才采用组织的行——backfill 建出来的 "builtin-derived" 默认行不算「用户改过」，
  // 否则又会退回旧 bug（DB 里恒有一行 ⇒ 内置模板的自定义判定恒真）。非内置 key 没有
  // 这层判断：库里的行不管 layoutSource 是什么，都是它唯一的来源。
  if (isBuiltinKey && row.layoutSource !== "user-edited") {
    return { ok: true, source: "builtin" };
  }

  const owner = `${orgId}@${row.version}`;
  if (AUTO_OWNER.get(key) !== owner || !getTemplate(key)) {
    const { spec } = buildAutoTemplateSpec({
      key,
      displayName: row.displayName,
      sections: row.sections,
    });
    registerTemplate(spec);
    AUTO_OWNER.set(key, owner);
  }
  return { ok: true, source: "org-generated" };
}
