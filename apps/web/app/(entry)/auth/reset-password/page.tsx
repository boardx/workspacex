import { ResetPassword } from "@/components/entry/reset-password";

/**
 * 找回密码重置链接落地页（issue #2602）——路由与 `auth/activate/page.tsx` 同一层，
 * 同样是"服务端读 `?token=`、传给客户端组件"的最小 wiring，业务逻辑都在
 * `ResetPassword` 里。
 */
export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const raw = searchParams.token;
  const token = typeof raw === "string" && raw.length > 0 ? raw : null;
  return <ResetPassword token={token} />;
}
