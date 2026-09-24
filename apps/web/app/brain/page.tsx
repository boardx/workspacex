import { AppShell } from "@/components/shell/app-shell";
import { BrainScreen } from "@/components/brain/brain-screen";
import { resolvePreviewRole } from "@/lib/identity";

/**
 * 大脑 —— 登录者自己的记忆：长期记忆（个人空间）+ 各对话里记下的东西；项目 / 组织两层尚未开放。
 *
 * 2026-09-24 人类指令「取消所有的 mockup 的数据」：此前本屏整屏渲染 `lib/mock/brain.ts` 的示例数字
 * （我 86 / 项目 1,482 / 组织 604、编造的决策台账与推演链）并挂着示例数据声明；现在只读真实接口
 * `GET /knowledge-graph/personal` 与 `GET /knowledge-graph/me/overview`，登录态来自根级 SessionProvider。
 * 服务端组件只读 `?as=`（壳层预览视角），数据全部在客户端组件 `BrainScreen` 里取。
 */
export default function BrainPage({ searchParams }: { searchParams: { as?: string } }) {
  const previewRole = resolvePreviewRole(searchParams.as);
  return (
    <AppShell previewRole={previewRole}>
      <BrainScreen />
    </AppShell>
  );
}
