import { redirect } from "next/navigation";

/**
 * ⚠ 已退役（2026-07-30）——访谈能力域的**现行**实现是 v2 束 `/itv`（interview 束，
 * ui-material-map.json 声明目录 itv-v2；旧 itv/ 44 张已被保真度审计推翻）。
 *
 * 本路由（旧「访谈 Studio」骨架屏，`components/interview/`）与 `/itv`（`components/itv/`）
 * 曾是**同一概念的两套活实现并存**，导致「评审签的和用户用的不是同一个产品」。
 * 收敛为单一实现：本路由永久重定向到现行束路由，导航不再指向它。
 *
 * 组件 `components/interview/*` 保留留痕（不删），但不再有任何入口。
 */
export default function DeprecatedInterviewStudioPage() {
  redirect("/itv");
}
