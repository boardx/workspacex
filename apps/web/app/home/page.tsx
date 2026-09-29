import { AppShell } from "@/components/shell/app-shell";
import { resolvePreviewRole } from "@/lib/identity";
import { HomeScreen } from "@/components/home/home-screen";

/**
 * 组织首页（束: home）—— 见 `components/home/home-screen.tsx` 头注与
 * `docs/design/org-home-page/README.md`。服务端组件只读 `?as=`（壳层预览视角，
 * 与其余顶层页面同一惯例），数据在客户端组件里读真实 `useSession()`。
 */
export default function HomePage({ searchParams }: { searchParams: { as?: string } }) {
  const previewRole = resolvePreviewRole(searchParams.as);
  return (
    <AppShell previewRole={previewRole}>
      <HomeScreen />
    </AppShell>
  );
}
