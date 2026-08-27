/**
 * `adoptTemplate` —— 把平台模板库的一份母版复制成本组织自己的模板（B2 的「用时 fork」）。
 *
 * ## 🟡 本用例实现的契约面**尚未经人类签核**
 *
 * 人类 2026-08-26 裁决「新建的模板是给所有的组织使用的」，在 B1（库里一份大家共享）与
 * B2（全局母版 + 用时 fork）之间选定 B2，并同意「等实现做完、连真实界面一起签」。
 * 登记为 design-delta 待补签；`status` 只由人类在束级 `design-signoff.md` 里改。
 *
 * ## 它是**编排**，不是第 N 个写入口
 *
 * 实现走已有的 `createTemplate` → `publishTemplate`，与
 * `backfill-canvas-builtin-templates.ts` 完全同一条路径。
 *
 * ⚠ **不新增仓储方法**。「把一行抄成另一行」下沉成一条 SQL 会绕开三样东西：
 *   key 占用判定（并发下的原子性）、发布前置校验、以及 `requireTemplateAdmin` 鉴权。
 *   而它们正是这条路径必须照走一遍的——复制出来的行，与人类手点「新建 + 发布」
 *   得到的行应当在库里逐字节同型。
 *
 * ## 为什么复制的是「已发布」的那一版
 *
 * 平台库里同一个 key 可能有多版（母版自己也会迭代）。组织要的是**当前能用的那一版**，
 * 而不是最新的草稿——把一个未发布的母版复制过去，组织拿到的是一份平台自己都还没
 * 认可的东西。所以判据是 `status === "published"`，不是 `max(version)`。
 *
 * ## `TEMPLATE_KEY_CONFLICT` 是幂等的正确形状，不是失败
 *
 * 再点一次「加入我的组织」必然撞上它。用例如实抛出，由前端译成「已在你的库里」——
 * 在这里吞掉它会让「真的加进去了」与「本来就有」变成同一个响应，而那两件事
 * 对使用者的下一步操作是不同的。
 */
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { DecisionIdFactory } from "../identity/ports";
import { CanvasError } from "./errors";
import { requireTemplateAdmin } from "./template-admin";
import { listTemplates } from "./list-templates";
import { createTemplate } from "./create-template";
import { publishTemplate } from "./publish-template";
import type { CanvasTemplateRepository } from "./template-ports";

export interface AdoptTemplateDeps {
  readonly identity: IdentityRepository;
  readonly templates: CanvasTemplateRepository;
  readonly ids: DecisionIdFactory;
}

export interface AdoptTemplateInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly key: string;
  readonly displayName?: string | undefined;
}

export interface AdoptedTemplate {
  readonly key: string;
  readonly version: number;
  readonly status: "published";
  readonly displayName: string;
  readonly platform: false;
}

export async function adoptTemplate(
  deps: AdoptTemplateDeps,
  input: AdoptTemplateInput,
): Promise<AdoptedTemplate> {
  // 与其余写操作**同一个**判定函数：不变量写六遍，漏掉的那一遍不会有任何东西报警。
  const membership = await requireTemplateAdmin({ identity: deps.identity }, input);

  // `listTemplates` 在 B2 下同时返回「本组织的行」与「平台母版」（仓储的 WHERE 放宽了
  // 读，见 `pg-canvas-template-repository.list`）。所以这一次读同时回答两个问题：
  // 母版存在吗、本组织是不是已经有这个 key 了。
  const { templates: visible } = await listTemplates(deps, {
    userId: input.userId,
    orgId: input.orgId,
    filter: "all",
  });

  const master = visible.find(
    (t) => t.key === input.key && t.platform && t.status === "published",
  );
  if (master === undefined) {
    // ⚠ `CanvasError` 只收 reasonCode，**不收消息**——这是刻意的（错误细节不外泄，
    //   见 `errors.ts`）。所以「平台库里没有 key=X 的已发布母版（org=org-platform）」
    //   这句话只能留在这里给读代码的人，不能塞进异常。
    throw new CanvasError("TEMPLATE_NOT_FOUND");
  }

  const created = await createTemplate(deps, {
    userId: input.userId,
    orgId: input.orgId,
    key: input.key,
    // 省略时沿用母版的名字——这是「加入我的组织」，不是「另起一个」。
    displayName: input.displayName ?? master.displayName,
    underlyingType: master.underlyingType,
    // ⚠ 深拷贝：`sections` 是从母版那一行读出来的引用，直接传下去会让本组织的行与
    //   母版共享同一个对象。今天它们各自落库互不影响，但共享引用是一个**没有理由
    //   存在**的耦合——下一个在 create 前顺手改一下 sections 的人就会改到母版。
    sections: master.sections.map((sec) => ({ ...sec })),
    visibility: "org-wide",
    tags: [...master.tags],
    // 母版的纸张尺寸原样带过来——「加入我的组织」复制的是母版当前的样子，
    // 不该让 fork 出来的行悄悄退回默认 A1（母版若是 A3/A4，分区坐标是按那个
    // 尺寸摆的，换成 A1 会让贴纸容量/mm 体检结果与母版实际长相对不上）。
    size: master.size,
  });

  await publishTemplate(deps, {
    userId: input.userId,
    orgId: input.orgId,
    key: created.key,
    version: created.version,
    visibility: "org-wide",
  });

  // ⚠ `membership` 已被 `requireTemplateAdmin` 用掉（鉴权），这里不再读它——
  //   `createTemplate` 自己会取创建者的团队填 `ownerTeamId`（C_CANVAS_8 ①）。
  void membership;

  return {
    key: created.key,
    version: created.version,
    status: "published",
    displayName: created.displayName,
    platform: false,
  };
}
