import { ProfileScreen } from "@/components/profile/profile-screen";
import { PreviewSessionProvider } from "@/components/session/session-provider";

/**
 * `/profile/preview` —— 个人资料页的**离线** UI 先行预览（ADR-003 签核第①件材料）。
 *
 * ⚠ 与生产的 `/profile` 是两条独立路径：生产页走真实 session（未登录跳 /login，需后端栈）；
 *   本页把**同一个 `ProfileScreen` 组件**套进 `PreviewSessionProvider`（注入 mock 身份、
 *   零网络），让人类无需后端即可确认「资料编辑表单」这一屏的界面落点。真实数据与写入
 *   仍只发生在生产页。活动记录区因无后端会显示为空/错误态，属预期（本页只为看资料表单落点）。
 */
export default function ProfilePreviewPage() {
  return (
    <PreviewSessionProvider>
      <ProfileScreen />
    </PreviewSessionProvider>
  );
}
