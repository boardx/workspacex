import { AppShell } from "@/components/shell/app-shell";
import { ItvChainNav } from "@/components/itv/itv-chain-nav";
import { ItvWorkspace } from "@/components/itv/itv-workspace";
import { resolvePreviewState } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import { resolveScreen, resolveScope, resolveItvView } from "@/lib/mock/itv";

/**
 * 访谈能力域 UI 先行原型 v2 —— 顶层路由 `/itv`（并行安全，不覆盖旧的 /studio/interview）。
 *
 * 主线（人类 2026-07-30 裁决 + 真实原型）：
 *   ① 访谈模板库 / 模板编辑器·报告模板
 *   ② 套用模板新建访谈（选模板→选对象→生成提纲）/ 访谈列表
 *   ③ 研究设计 / 质性访谈现场 / 虚拟画像推演访谈
 *   ④⑤ 洞察报告（套报告模板生成）
 *
 * 访谈属于「用户洞察」这一类，与工作坊（项目）平级、互相独立；没有引导师/组长。
 * 屏经 `?screen=`；范围 `?scope=`；角色视角 `?view=`（研究员/受访者/观察者）；七态 `?state=`；
 * 向导步骤 `?step=1|2|3`。视角切换是预览手段，不是权限实现。
 */
export default function ItvPage({
  searchParams,
}: {
  searchParams: {
    screen?: string;
    scope?: string;
    view?: string;
    state?: string;
    step?: string;
    as?: string;
    org?: string;
  };
}) {
  const screen = resolveScreen(searchParams.screen);
  const scope = resolveScope(searchParams.scope);
  const view = resolveItvView(searchParams.view);
  const state = resolvePreviewState(searchParams.state);
  const stepNum = Number(searchParams.step);
  const step: 1 | 2 | 3 = stepNum === 1 || stepNum === 2 ? (stepNum as 1 | 2) : 3;

  // 身份用于三栏骨架的顶栏/图标栏；访谈自有角色模型，identity 仅承载组织与展示名。
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);

  return (
    <AppShell
      identity={identity}
      previewRole={previewRole}
      left={<ItvChainNav screen={screen} state={state} scope={scope} view={view} />}
    >
      <ItvWorkspace screen={screen} state={state} view={view} scope={scope} step={step} />
    </AppShell>
  );
}
