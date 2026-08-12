import { AppShell } from "@/components/shell/app-shell";
import { InterviewStudioHome } from "@/components/itv/interview-studio-home";

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
    tab?: string;
  };
}) {
  return (
    <AppShell previewRole={null}>
      <InterviewStudioHome initialTab={searchParams.tab === "experts" ? "experts" : "history"} />
    </AppShell>
  );
}
