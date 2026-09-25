/**
 * HTTP 状态 → 一句**能照着做**的话。单源。
 *
 * 2026-09-23 从 `lib/design-failure.ts` 里原样搬出来：产物取源
 * （`lib/chat-workbench/artifact-failure.ts`）需要同一份兜底，而这个仓库的头号病
 * 就是同一事实声明在两处——已经因此漂移过十一次。与其抄第二份，不如现在就收敛。
 *
 * 它只负责「不是本束已知错误码」时的兜底；各束自己的码→人话表仍然各归各家
 * （闭集断言要贴着各自的契约，合成一张大表反而会让漏配的码编译得过）。
 */
export function httpFailureText(status: number): string {
  if (status === 401 || status === 403) return "登录状态过期了，刷新页面重新登录";
  if (status === 404) return "要找的东西不在了";
  if (status === 429) return "操作太频繁了，等一下再试";
  if (status >= 500) return "服务器出错了，稍后再试一次";
  return "这次请求没成功，稍后再试一次";
}
