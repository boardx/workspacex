"use client";

/**
 * #848 —— `/admin/skill` 点「编辑」原来只有「名称/可见范围/归属团队」三个字段，没有
 * 文件树 / 代码编辑，用户看不到 skill 的真实源码。两栏「左文件树 + 右代码」的
 * `Editor` 其实早就写好了（`asset-governance/ag-screens.tsx` 的 `AgSkillEditor`），
 * 但只挂在孤立的 `/asset-governance` 原型路由下，且一直用写死的示例 skill
 * （`AG_SKILL_MAIN.slug`），不接调用方传入哪个 skill。
 *
 * 这里把它接进来时补的**唯一**改动是让 `AgSkillEditor` 接受 `assetId`/`assetLabel`
 * 覆盖那个写死的示例——组件内部真正的读写路径（`GetAssetDirectory` / `ReadAssetFile` /
 * `WriteAssetFile`）本来就是真的：`kind === "skill"` 时 `PgAssetFileRepository`
 * （#785）已经把它们接到真实 `skills`/`skill_versions`/`skill_version_files`
 * （模型 A——`pg-agent-run-repository.ts` 里 `/chat` 执行 skill 时唯一真读的那套），
 * `capability_listings.id` 与 `skills.id` 是同一个值（`pg-skill-url-import-repository.ts`
 * / `pg-skill-starter-import-repository.ts` 落库时同一事务写两张表、用的是同一个
 * 生成的 id），所以 `row.id` 直接就是 `AgSkillEditor` 需要的 `assetId`，不用另外查一次映射。
 *
 * ⚠ 范围收紧：只支持编辑**已存在**的文件内容（含多文件浏览——目录里有几个文件就能
 * 看到几个），不支持新增 / 重命名 / 删除文件——`createAssetFile` 至今没有 controller
 * （见 `lib/asset-directory.ts` 头注 2026-08-11 复核那段），`deleteAssetFile` /
 * `renameAssetFile` 虽然后端有 controller，但 `apps/web` 还没有对应的客户端封装，
 * 接了个只有一半功能的按钮不如老实不接——见 issue #848。
 *
 * ⚠ 本文件**只**给 `skill-screen.tsx` 用，不要从 `agent-screen.tsx` 或
 * `capability-catalog-screen.tsx` / `capability-mutate.tsx` 里静态 `import` 它——
 * 它传递性依赖 `lib/mock/asset-governance.ts`（`AgSkillEditor` 为保留
 * `/asset-governance` 原型路由的七态演示而依赖 mock 常量作 fallback），
 * `agent-admin-route-no-mock.test.ts`（#458）机械断言 `/admin/agent` 的整棵依赖树
 * 不含任何 `lib/mock/**` 边，从共享文件里 import 这个模块会把那条边一起拖进去。
 *
 * 人类反馈（2026-08-17）：点击「编辑」现在打开一个独立页面（`CapabilityEditPage`），
 * 这个区块因此**只**渲染在那个专门的编辑页上，不再和"列表页里展开一行"共用——
 * 页面本身就是编辑器，不需要再套一层「查看/编辑源码」折叠开关，那只是多一次点击
 * 去看本来就是这一页唯一目的的内容。折叠态因此删除，恒直接渲染。
 *
 * 人类截图实测反馈（2026-08-24，#1971）：这个区块的标题 + 一整段常驻说明文字挤占了
 * 页面上半部分的空间，而这一页唯一的目的就是文件树 + 代码编辑——说明文字收进原生
 * `<details>`（默认折叠，点了才展开），标题行压成一行小字，把空间让给 `AgSkillEditor`
 * 本体（该组件同时传 `compact`，跳过它内部重复的大标题 + 说明段落）。
 */
import { AgSkillEditor } from "@/components/asset-governance/ag-screens";
import type { CapabilityListing } from "@/lib/live-capabilities";

export function SkillContentEditorSection({ id, row }: { id: string; row: CapabilityListing }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 border-t border-border-subtle pt-2">
      <details className="group text-10 text-muted-foreground" data-testid={`${id}-content-hint`}>
        <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-11 font-medium text-background-foreground">
          内容（文件树 / 代码）
          <span className="text-9 text-muted-foreground">ⓘ 说明</span>
        </summary>
        <p className="mt-1 leading-relaxed">
          只支持编辑已存在文件的内容（可浏览这个 skill 的完整目录），不支持新增 /
          重命名 / 删除文件——见 issue #848。
        </p>
      </details>
      <div className="min-h-0 flex-1" data-testid={`${id}-content-editor`}>
        <AgSkillEditor state="default" view="admin" assetId={row.id} assetLabel={row.name} compact />
      </div>
    </div>
  );
}
