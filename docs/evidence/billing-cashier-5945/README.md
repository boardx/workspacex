# #5945 收银台布局与连续购买证据

2026-10-27。基线 `26753a1ccaa5`，复用 e435 worktree。

## 分支目标修正（2026-10-27）

用户明确后续 WorkspaceX 默认向 develop 集成。#5946 在纠正时已由 GitHub 合入 main（合并提交 `607324e8bfd240c56a85317fa0b26a94db4bf31a`），因此无法修改旧 PR 的 base。复用同一个 worktree，基于最新 `origin/develop@fba6efcdd8a029ebab2134300bb3f6ef77b87956` 单独 cherry-pick 支付改动；未携带 main 的其它提交，也未撤销 main 历史。新分支 `codex/billing-cashier-develop`。

支付组件、测试和 lockfile 与此前已验证源完全一致；在 develop 基线上重新执行 80 项相关测试（5.13s）、web typecheck/lint 均退出 0。项目分支约定的唯一落点更新为 `.harness/instructions/project/PROJECT.md`，根 AGENTS 仅路由引用，不复制第二份默认分支声明。

develop 基线浏览器重验：同一三宽度连续两单/晚到 GET 场景再次通过，1 passed（20.3s）。本目录截图已更新为此次运行产物；未复用旧 PR 的 CI 结论。

## 问题与修复

`buyAgain` / `regenerate` 原本在 `pending.current` 非空时静默不执行；已结束订单的 GET 也会占此锁。新增 SUCCESS/CLOSED 延迟 GET 测试均先失败（order 未被清除），再通过。修复只在允许重新购买的状态中止旧读取，同步清理 latest，旧回包检查 abort 信号且 finally 比对 controller 身份，不覆盖新订单。原有不确定 POST/处理中/异常状态的重复支付保护仍在。

弹窗改为桌面左侧 3×2 套餐/渠道/主操作，右侧扫码/结果，底部余额/流水；手机单栏、套餐两列。原生 radio 覆盖整张卡片，支持点击与键盘。订单存在时锁定套餐，明确显示再次购买或正常关闭后的重新选择入口。

## 本轮实际执行

| 命令 | 结果 |
|---|---|
| `./init.sh` | exit 0，默认快速基础检查 |
| `pnpm harness readiness` / `dashboard` / `active-features` | exit 0；本次为用户指定队列外 ad-hoc 修复 |
| 新增 3 项 cashier 测试（修复前） | 3 failed：两项 pending GET 阻塞，一项付款中套餐不可见 |
| `pnpm --filter web exec vitest run tests/ui/billing-cashier.test.tsx tests/ui/billing-overview.test.tsx tests/ui/billing-subscription-live.test.tsx --maxWorkers=1 --minWorkers=1` | 80 passed / 3 files，6.71s |
| `pnpm --filter web lint` | exit 0，ESLint 无警告，light token / design checks 通过 |
| `pnpm --filter web typecheck` | exit 0 |
| `pnpm --filter web exec playwright test --config playwright.billing-cashier.config.ts` | 1 passed，23.5s（含启动/收尾） |
| `git diff --check` | exit 0 |

浏览器在 375×900、768×900、1280×1100 视口验证自然键盘入口/焦点恢复、非空 canvas 二维码、GET 503 保留订单、SUCCESS 后钱包与 +100 流水、三种宽度不横向溢出、宽屏双栏/窄屏堆叠、每种宽度连续创建两笔不同订单（第二单选择不同套餐），共 6 个 POST。额外悬置已成功订单的刷新，创建新单后释放旧响应，确认不会恢复旧单。

初次浏览器运行因 sr-only radio 被文字拦截失败；改为全卡片透明原生 input 后重跑通过。截图来自最后一轮成功运行。

## 独立审查与边界

独立只读 reviewer 两轮检查 hook、UI 与测试，未发现需修复问题；第二轮覆盖透明 radio 与一致的账务 fixture。未声称 GitHub 原生 approve。

这些浏览器数据为本地受控 HTTP fixtures，不是真实微信商户、真实登录或线上支付日志证据。没有执行生产部署/生产写入/数据库写入；未新增 Docker 栈。Playwright 自有 Next 服务已随进程退出清理。tick 缺少 COORD_GATEWAY_URL，未伪造协调身份或心跳。

## 截图

- [桌面待支付](browser/cashier-1280-pending.png)
- [桌面已到账](browser/cashier-1280-success.png)
- [手机待支付](browser/cashier-375-pending.png)
- [手机已到账](browser/cashier-375-success.png)
- [平板待支付](browser/cashier-768-pending.png)
- [平板已到账](browser/cashier-768-success.png)

## 执行计划

```mermaid
flowchart LR
  A[同步基线与定位问题] --> B[调整充值布局与订单切换] --> C[验证连续购买和响应式] --> D[创建 PR 并跟进检查]
  classDef todo fill:#e5e7eb,stroke:#6b7280,color:#111827
  classDef doing fill:#fde68a,stroke:#d97706,color:#111827
  classDef done fill:#bbf7d0,stroke:#16a34a,color:#111827
  classDef tested fill:#ddd6fe,stroke:#7c3aed,color:#111827
  classDef blocked fill:#fecaca,stroke:#dc2626,color:#111827
  class A done
  class B tested
  class C tested
  class D doing
  %% evidence B: pnpm --filter web exec vitest run tests/ui/billing-cashier.test.tsx (45 passed)
  %% evidence C: pnpm --filter web exec playwright test --config playwright.billing-cashier.config.ts (1 passed)
```
