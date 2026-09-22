/**
 * 迭代 22 —— 分享页 `/d/<token>`。**免登录**。
 *
 * 路径短是刻意的：这串东西要被粘进微信、飞书、邮件，长一截就多一次折行。
 * 与 `/surveys/[token]`（公开问卷）同一形状：薄薄一层 page，内容全在客户端组件里。
 */
import { SharedDesignView } from "@/components/design-loop/shared-design-view";

export default function Page({ params }: { params: { token: string } }) {
  return <SharedDesignView token={params.token} />;
}
