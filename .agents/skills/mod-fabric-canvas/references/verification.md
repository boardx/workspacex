# 调试与真实验收

## Debug SOP

1. 确认是 LiveBoard、当前源码/runtime、同一 board/document；排除 stale HMR，不以 preview 通过代替产品。
2. 读 canonical/API export，再读 adapter 和 registry：是数据错、投影错，还是仅 DOM chrome 坐标错？
3. 捕获 pointerId/button/modifiers、CSS canvas bounds、viewportTransform、canonical/world geometry。
   日志不含 token/密码/session state；不把 debug setter 写进生产 API。
4. 若 Fabric 画面正常、toolbar 错位，先查 onViewportChange/transformPreview → React viewport → toolbar helper。
   纯 pan/zoom 若 connector 不跟随，先查其是否处在同一 canvas/VPT，不能当节点 transform 重算。
   实际 node transform 若 connector 不跟随，再查节点 preview、端点局部 offset、rotatedAnchorPoint
   与投影更新，不修改 Mermaid。先证明确实有缺陷，不凭题述判当前源码必然有 bug。
5. 取消/失败后检查临时 preview 消失、canonical 未变、监听器无残留；执行一笔新手势验证恢复。
6. 找出最小反例单测，再真实浏览器 pointer+像素+API+reload 验证修复，不只增加源码字符串断言。

## 执行入口

按影响面选择真实存在的 test 文件；通常先 web typecheck/lint，再定向 UI/core 测试：

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web exec vitest run tests/ui/board-fabric-input.test.ts tests/ui/board-fabric-coordinate.test.ts
pnpm --filter @repo/whiteboard-core exec vitest run
```

运行前核 package scripts 与测试配置；命令成功不意味着所有白板场景已经覆盖。
本候选的 [navigation runner](../../../../scripts/local-session/board-navigation-acceptance.mjs)
使用 [运行来源门](../../../../scripts/local-session/board-acceptance-runtime.mjs) 与
[请求节流](../../../../scripts/local-session/board-navigation-acceptance-scheduler.mjs)。
旧分支的 `board-acceptance-suite.mjs` 和 Connector runner 是条件入口：先确认当前候选存在、
来源和 CLI，缺失时不复制算法来制造存在性。不要复制临时账号密码或安装未经授权的服务。
新 out 目录、防源文件变化 hash、子进程 exit/report.ok、console/pageerror/requestfail、
截图 PNG 签名/hash 和清理结果均需核实；主脚本 exit0 不能掩盖子报告失败。

## 反假绿检查

- 图像/绘图必须像素非空且目标 ROI baseline 合理；整个canvas差异可能只是 selection chrome。
- DPR 一致，压力宽度允许合理 AA/premultiplication 误差，不能临时放宽到任意像素都通过。
- narrow menu 既检查 bounds，也检查每个操作中心真实 hit target；截图需人工看遮挡。
- input 合成证明浏览器事件行为，不证明 Apple 实机 Trackpad/native tablet/OS clipboard。
- 刷新后读 canonical/API、第二浏览器实际同步；脚本直接改 doc 不算用户拖动成功。
- 要求独立进程时，两个 browser context 不等于两个 browser process；记录各进程启动、
  同板授权和双端 API/渲染观察。验收前冻结相关应用源码而不只 hash runner，变化即重跑受影响门。
- Yjs 远端冲突反例先证明注入的 mutation 赢得合并、live canonical 已改变，再触发 release。
  只执行 applyUpdate 但旧值仍胜出的 fixture，不能证明 CAS/删除/锁定拒绝路径。
- 注入503/计划offline/导航abort 只能用 exact URL/method/action window/cause 限定，保留 unexpected errors；
  禁止统一忽略 net::ERR_ABORTED、console error 或所有4xx。
- 安全fixture必须 cleanup/rollback后另连接核零残留，不以finally代码存在当清理成功。

## CI 前提

`apps/web/tests/ui/board-drawing-stroke-path.test.ts` 会 launch Chromium。
运行该测试的 **同一个 CI job** 必须安装 Playwright Chromium 与 OS 依赖；
其他 job 的 install 不共享 VM。检查 `.github/workflows/harness-verify.yml` 的 affected test lane。
2026-10-01 审计看到该 lane 的浏览器安装缺口；本 skill 不宣称已修/CI 已通过。
后续分支曾增加 affected `web#test` 条件安装与
`.harness/scripts/ci-affected-chromium.test.ts`；先查当前候选路径和 PR job。
这段是历史定位提示，技能迁移不携带 CI 修复，也不取代真实 PR job 结果。
不要 skip 像素测试再声称覆盖；Fabric 7.4.0 是本次源码读取时版本，升级读 lock/package 现值。

## 交付证据

记录 exact source/commit、命令退出码、测试范围、浏览器数据回读、PNG/报告路径和未测边界。
本地通过、PR绿、合入main是不同状态，按根 AGENTS/harness 完成定义判断。
Connector C01–C21 设计/验收材料从 #4878 定位当前分支；先前仅设计的状态已被本轮
人类开发批准及本地实现替代，但不能在旧矩阵中冒称新手柄/宽度/标签位置已全套通过。
未合入分支 helper/脚本存在性需按当前树核验，不能要求独立 skill PR
携带全部业务实现来让路径看起来存在。

## R01 实测反例回流

2026-10-02 Run16 证据与后续轮次边界见
[十轮审计](../../../../docs/design/fabric-board-evidence-audit.md)。
运行来源须同时比较当前文件、manifest、exact Git blob；仅 HEAD 字符串一致允许 dirty source 假绿。
Fabric controls 可能绘在 lower canvas，不把 upper canvas 空白当「无选择框」充分证明。
held accessibility mirror 仍可能表示 canonical；用独立 pointer 几何预测实体像素，不能要求 mirror
每帧写入临时角度。选中 chrome 会遮挡笔迹采样：真实 UI 清选择且证明 API 零写后再采样。
fixture 箭头可能合法穿过目标 ROI，须先隔离/清理 fixture，不改变像素阈值来掩盖污染。
Toolbar center-fixed resize 与 viewport clamp 可以不移动；依据单源布局预期而非「位移必须大于零」。
测试节流只减少请求负载，不调整真实业务限流；任何 429 仍失败，不重试吞掉。
