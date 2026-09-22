# ui-wiring 门控的**行为**测试夹具（issue #397）

一个最小的假仓库：一条已接线的产品路由 `/widgets`
（screen → `lib/live-widgets.ts` → `widgets` 契约 → `WidgetsController`（已挂进
`kernel.module.ts` 的 `controllers[]`）→ `application/widgets/list-widgets`），
外加一条 `/gadgets`（有屏、有适配器，但 controller **没挂进 kernel**）作为反证材料。

`lint-ui-wiring.test.ts` 把这个目录拷进临时目录、注入缺陷、跑真的门控脚本，
断言「干净夹具绿 / 注入缺陷红」。夹具本身不参与产品构建，也不被 tsconfig 收录
（`apps/web/tsconfig.json` 的 exclude 只挡 `__fixtures__`，所以这里的 `.ts` 刻意
用 `.ts.txt` 之外的普通后缀但放在 `.harness/` 下——`.harness` 不在任何 app 的
include 里）。
