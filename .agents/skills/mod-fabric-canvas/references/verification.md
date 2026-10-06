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
历史 [navigation runner](../../../../scripts/local-session/board-navigation-acceptance.mjs)
使用旧 [运行来源门](../../../../scripts/local-session/board-acceptance-runtime.mjs) 与
[请求节流](../../../../scripts/local-session/board-navigation-acceptance-scheduler.mjs)。
这些是历史诊断入口，不是下述 strong native PostgreSQL 运行来源证明。
旧分支的 `board-acceptance-suite.mjs` 和 Connector runner 是条件入口：先确认当前候选存在、
来源和 CLI，缺失时不复制算法来制造存在性。不要复制临时账号密码或安装未经授权的服务。
新 out 目录、防源文件变化 hash、子进程 exit/report.ok、console/pageerror/requestfail、
截图 PNG 签名/hash 和清理结果均需核实；主脚本 exit0 不能掩盖子报告失败。

<a id="formal-native-acceptance"></a>

### 正式 Native 验收导航

基础设施来源是 [PR #5234](https://github.com/boardx/workspacex/pull/5234)，不代表业务 suites 已通过。
从唯一 [native caller](../../../../apps/web/scripts/run-board-native-acceptance.mjs) 的
`acceptanceCommand`、`suiteDefinition` 与 `run` 读取当前 CLI、允许的完整 suite 和环境要求，
不要另写一套命令或 case 枚举。候选 caller 包含 R01、Connector、Files、Sync 四个入口；
[R01 config](../../../../apps/web/e2e/board-r01-existing-runtime.config.ts) 与
[原生矩阵](../../../../apps/web/e2e/board-r01-native-matrix.spec.ts) 定义八个软件用例，
源码可导航不代表这些用例已经实际运行。

运行来源读 [runtime attestation](../../../../apps/web/e2e/support/native-runtime/runtime-attestation.mjs)
与其调用的 [source selector](../../../../scripts/local-session/board-runtime-source-files.mjs)：
当前文件、完整源码闭包与 exact Git blob/hash 必须一致，还要核真实 PID/CWD、监听器与产物身份。
[producer prepare](../../../../apps/web/e2e/support/native-runtime/wsx-board-native-runtime-prepare.mjs)
与 [producer start](../../../../apps/web/e2e/support/native-runtime/wsx-board-native-runtime-start.mjs)
是 PostgreSQL 16.15/vector 0.8.6、独立非 owner 的 `app_rw` 和 RLS 身份证明入口，
不能用 manifest 字符串或旧运行环境替代实际角色与运行来源核验。
迁移、seed、build 的退出与日志关闭由
[owned lifecycle](../../../../apps/web/e2e/support/native-runtime/native-owned-one-shot.mjs) 管理；
startup 或 lifecycle 纯测试通过不是产品浏览器/API/刷新证明。

caller 的原始 report、R01 receipts 与 owned stop 结果分别核验；`cleanupPending` 是失败边界，
不能因业务断言通过就改成整轮完成。Trackpad、OS IME 等原生硬件仍需人工验收；
R01 receipt 的 `completed: false`、`hardwareTrackpad: unverified` 不得转述成原生通过。
工具链、依赖、机器资源和新候选执行结果必须实际检查，本导航不宣称环境可运行。

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

<a id="ci-前提"></a>

## CI 前提

`apps/web/tests/ui/board-drawing-stroke-path.test.ts` 会 launch Chromium。
运行该测试的 **同一个 CI job** 必须安装 Playwright Chromium 与 OS 依赖；
其他 job 的 install 不共享 VM。检查 `.github/workflows/harness-verify.yml` 的 affected test lane。
2026-10-01 审计看到该 lane 的浏览器安装缺口；本 skill 不宣称已修/CI 已通过。
后续分支曾增加 affected `web#test` 条件安装与
`.harness/scripts/ci-affected-chromium.test.ts`；先查当前候选路径和 PR job。
这段是历史定位提示，技能迁移不携带 CI 修复，也不取代真实 PR job 结果。
不要 skip 像素测试再声称覆盖；Fabric 7.4.0 是本次源码读取时版本，升级读 lock/package 现值。

2026-10-02 的后续单源准备入口是 [commit 1e1eb5d](https://github.com/boardx/workspacex/commit/1e1eb5d5d3219388d6d1472192fcb1ac3688fbcd)
中的 `.github/scripts/run-affected-tests.mjs` 及其同名 test。
读取该 runner 的 `selectsWebTest`、`coreCli` 与计划/执行参数，不在 skill 复制安装命令或判断器。
它从 web 的实际 `playwright-core/package.json` 定位 CLI，而非假设全局/根 CLI 的浏览器
revision 一致；planning、安装与执行使用同一 base/filter/environment 和绝对 browser cache。
历史 #5003 head 8f0e2d2 的 job 110708874417 有 6827 passed/2 failed，两个失败是缺
chromium_headless_shell-1234（不是笔迹像素已失败）。引用这一日志只定位准备缺口，
不声称新 runner 的远端 CI 已绿。无需 web test 的 dry plan 与安装失败的反例见该 runner test。

<a id="像素-oracle-与归因更正"></a>

## 像素 Oracle 与归因更正

选中的 Fabric controls 可能绘在 lower canvas。实际笔迹的 midpoint 恰落在 mt/bt
handle 上时，单点采到白色不能证明笔迹消失。先通过正常 UI 清选择，确认 mirror
仍 attached、对象数量不变、selected count 为零，等两帧，再比较实际 canonical
head/epoch/objects 未变后测实体 ink。不要调用 debug setter、清 doc 或放宽像素阈值。
两帧只为稳定清选择后的绘制，不是凭空加入 latency-ready fence 或宣称解决缓存问题。
Escape 不是清选择的可靠 oracle：run2 的真实 selection diagnostic 中，第一次 Escape
只关闭 Draw panel，第二次仍 selected1；Select 后点击空画布 (50,550) 才 selected0。
`/private/tmp/wsx-r05-selection-diagnostic/result.json` 的五步记录与 PNG 保留此反例，
并记录 canonical head/full objects 未变。必须观察 selected0，不能假设按键次数等于成功；
这只是独立诊断，不是完整 R05 run PASS。

2026-10-02 原 R05 run1 的 pen midpoint (180,200) 为白，保留为原始 RED。
独占 fresh-board no-reload probe 的 zero-frame/two-raf/100ms/500ms lower PNG 中，
邻点 x160/170/174/186/190/200,y200 为 RGB24/24/27、alpha255，仅 x178/180/182 白；
no-reload-final PNG 与 selection handle 对齐。fresh hydrate/reload 后该点黑是消去选择
后的诊断证据，不会把原 run1 变成 PASS。来源见
[审计更正索引](../../../../docs/design/fabric-board-evidence-audit.md#2026-10-02-诊断更正索引)；
正常 UI 清选择 + unchanged-head 的修订仍须实际新 run 验收。
因此不要沉淀「cached drawing blank 已修」或「R05 全通过」这类未证结论。

Fabric mock 的 `Group` natural bounds 若固定为任意默认 width/height，会改变 scale、
translate 与 clipping 的解释，不能把 mock bounds 当真实 Fabric 或 canonical oracle。
Geometry 反例必须先核 mock 对 children/extents/layout 的处理，再用实际 Fabric、真实
浏览器/像素或明确的 canonical frame 独立验证。保留原失败与测试假设更正，
不要仅为了通过而改期望数值。具体反例：initial d5bff870 的 bridge mock 将 Path、
Triangle、Group 全替换为不布局 children 的 MockFabricObject，导致 Group.left 为零；
Surface 的 WeakMap 保存真实 getBoundingRect 与 canonical geometry 的偏移，因此旧 mock
错误地将 held left 投影为零，而非预期 285。测试修订
`fd2ceaf4c2c55f8ac19eb33d40654f0a48aa2de7` 使用实际 Path/Triangle 与实际 Group，
独立断言 held path M285,200/L500,100 与拒绝后 M215,90/L500,100；同时保留
held 零提交、release 一次提交、preview 清空与节点 geometry 恢复断言。
原 RED 为 18 passed/2 failed，修订 focused 20/20；该 commit 的推送、CI、合并
仍须查询当前 PR，不将测试 oracle 修正当业务浏览器验收。

不同 SHA 的截图和报表不能互相借用：准确绑定当前 file/blob、manifest、runtime 和
完整源 SHA，旧截图继续属于旧来源。证据追加 commit 与应用源码测试 commit 分别记录；
source-only review、组件通过和浏览器接受是不同证据层级。

<a id="shape-缓存证据分层"></a>
## Shape 缓存证据分层

2026-10-03，PR #5169 的 exact source
`8ae84fd715eb5018d5f79075f83f05a6c4a592bc`：实际生产构造器缓存支持测试先出现
21 failed/9 passed；修订后的 32 个缓存测试与 6 个逻辑尺寸回归合计 38/38，另有
Web TypeScript/lint 通过。这是当次测试范围的历史收据，不是未来版本的通过计数权威。
入口为该 SHA 的
[缓存支持测试](https://github.com/boardx/workspacex/blob/8ae84fd715eb5018d5f79075f83f05a6c4a592bc/apps/web/tests/ui/board-shape-cache-support.test.ts)。
默认描边、非均匀缩放、更新/重建后逻辑尺寸、实际缓存平移与限制仍须保留反例。

不要从 Node 的 Fabric 默认值推断浏览器缓存配置：本轮安装版本的 Node 入口覆盖缓存默认值，
真实 Chromium 中实例的有效默认值则为开启。独立参考只消费 literal geometry/grid，
不能把实际矩阵、缓存尺寸或观察到的误差反取为 expected。选中 controls 绘在 lower canvas
时，held chrome 与 fresh 清选择后的描边测量要分开，并证明清选择没有 canonical/WS 写入。
本轮独立 Chromium 旧来源的严格像素诊断仍有失败；不能降低像素阈值或借组件结果宣称
PR #5169 产品像素、R01 原生矩阵或硬件触控板已经通过。

截至本次回流实时查询，
[PR #5155](https://github.com/boardx/workspacex/pull/5155) head
`36f94473392a2a924d558c684fb236df7c38bb61` 与
[PR #5169](https://github.com/boardx/workspacex/pull/5169) head 为上述 `8ae84f...`，
均 OPEN/UNSTABLE；这些是 dated 状态，不是当前 main 或未来合并状态。使用前重新查询
PR 与祖先关系，不能把维护候选或 source review 视作依赖已发布。

## Linux CWD 身份诊断边界

真实 run `37077851863` / job `111071628592` 的 merge producer
`1e566d1a875a6af5f318de5d82c8267aa8eecf2c`，两个独立 suite 均在
`STARTUP/IDENTITY_CWD` 失败：Web PID 存活，但 lsof CWD 查询退出 1、路径未取得；
Playwright 尚未启动，不能归因成业务断言失败或记录业务用例通过。原安全收据还记录
`cleanupCompleted: false` 与 owned-runtime-stop 失败，不能把启动失败视作资源已干净释放。
Linux CWD 查询的窄修使用 exact PID 的 `/proc` 链接，macOS 保留 lsof；原 realpath、
root/PID/listener 身份门不能削减。修订
`0eff713c7180a96765e04ae0f85605e9a6357573` 的纯测试及标准发布门通过，不是该
Linux consumer 的重新执行证据；本次回流时消费者尚未继承并重验修订。
对应执行状态从 [issue #4880](https://github.com/boardx/workspacex/issues/4880) 的最新证据定位，
保留启动失败收据，不以 manifest 字符串替代运行进程事实。

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
