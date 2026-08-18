/**
 * chat 里一条 ```canvas 围栏的 `模板: <key>` 要渲染成什么几何 —— 这里决定。
 *
 * ⚠ 这条路径只服务**工作坊画布模板（便签协作模板）**，与 mermaid 图表那条路径
 *   零交集：不 import mermaid、不查 `MermaidDiagramType`、不共用任何判断函数。
 *
 * 三条出口，与围栏渲染组件的三个状态一一对应：
 *   ① key 是 `fabric-markdown` 的**内置模板**（19 个）→ 直接用它自带的 A0 精美几何，
 *      **不做自动布局**。内置模板的坐标是人调过的（persona 的 `{x:290,y:360,w:460,h:320}`
 *      不是任何算法能算出来的），自动布局覆盖它只会更难看。
 *   ② key 是**组织自建模板** → 走 `GET /canvas/templates` 拿 `SectionDef[]`，
 *      交给 `buildAutoTemplateSpec` 现算几何，`registerTemplate` 进引擎全局表。
 *   ③ 都不是 → 诚实错误态（不静默退回 mock，也不渲染一个空画布）。
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
 *   · **组织模板与内置模板同 key**：内置**恒赢**，我们连查都不查（见出口①）。理由不是
 *     「先到先得」，而是内置几何更好、且覆盖它会让别的会话/别的消息里同一个内置围栏
 *     突然换了长相。代价：组织真建了一个叫 `swot` 的模板，在 chat 里会渲染成内置 SWOT。
 *     这是**已知且故意**的取舍，需要区分时应由后台在建模板时禁用内置 key（后端的事）。
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
  const registered = getTemplate(key);
  // 已注册且不是我们自动生成的 ⇒ 内置模板，用原生几何（出口①）。
  if (registered && !AUTO_OWNER.has(key)) return { ok: true, source: "builtin" };
  if (!orgId) {
    return {
      ok: false,
      reason: "no-org",
      detail: key,
    };
  }

  let rows: readonly CanvasTemplate[];
  try {
    rows = await loadOrgTemplates(orgId);
  } catch (e) {
    return { ok: false, reason: "fetch-failed", detail: e instanceof Error ? e.message : String(e) };
  }

  const matches = rows.filter((t) => t.key === key);
  if (matches.length === 0) return { ok: false, reason: "not-found", detail: key };
  // 同一 key 多版本时取最高版本 —— 「用这个模板」在用户心里就是「用它最新的样子」。
  const row = matches.reduce((a, b) => (b.version > a.version ? b : a));

  const owner = `${orgId}@${row.version}`;
  if (AUTO_OWNER.get(key) !== owner || !registered) {
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
