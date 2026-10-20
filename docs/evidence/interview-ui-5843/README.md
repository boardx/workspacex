# 用户访谈 UI 三轮优化 · #5843

范围：`/itv` 历史卡、创建弹窗、工作台长标题、需求输入可见标签。复用专属 worktree，基线 `0acfa6628f9380c64ece5732c066e999d2e57651`，分支 `codex/interview-ui-5843`。产品映射 `coord-user-research = 用户访谈`；合法协调凭据缺失，未认证/未持租，按人类直接授权推进。

设计边界：既有已确认访谈主链的呈现/可用性修复，不改数据/API/鉴权/修订/模型/录音/报告证据。技术版本和状态继续sr-only，保留既有测试定义；不实施上轮方案里的可见技术元数据。不改共享shell/token/workflow基础组件，不代签。

## R1 · 视觉和信息层级

实现 `39d944731`：完成卡去重复满进度，保留真实完成专家数和报告动作；创建范围提示去多余边框；工作台长标题允许断行；需求输入标签从仅屏幕阅读器改为可见。没有删除业务字段或更改状态判断。

新增完成卡行为测试 RED：27通过、1失败，预期失败为完成卡仍有progressbar。修改后 home/create-scope/header/intake 46项通过。记录见 r1-red.txt / r1-green.txt。本轮组件测试不是浏览器/DB证据。

## R2 · 交互友好

发现：创建失败后焦点仍留提交按钮；空名称禁用缺少关联解释。补失败alert可聚焦且失败后定位，空名称输入关联提示；保留原输入与相同payload的requestId。R2独立回归覆盖错误焦点、保留名称、重试同一requestId与成功导航，另测空名称不请求服务。RED两项均按预期失败，见r2-red.txt。实现 `304d22a23`；受影响5文件48项测试通过，见r2-green.txt。

## R3 · 真实浏览器检查与修正

实现 `b7b0e6e87`：浏览器在375×667、10个长标签+创建503错误组合中量出弹窗top=-36.75/bottom=703.75，超出视口；增加本模块弹窗视口高度上限与内部滚动。5项创建/项目scope回归通过（r3-green.txt）。修复前几何在browser-before-results.json与r3-before-long-tags-375x667.png；修复后同数据top=16/bottom=651（viewport667），scrollHeight739/clientHeight633；错误提示聚焦、内部滚动和再次请求可达。见browser-check-results.json、browser-check-final.txt和修复后r3-long-tags-375x667.png。

使用模块独占本地端口35843、独立Next构建目录、单worker。页面来自本分支真实Next组件，HTTP/session使用仓库既有受控fixture模式；不冒充真实后端鉴权、模型或Postgres验收，不写生产数据。浏览器记录和截图由独立验证agent写入本目录；未完成的检查不能标通过。

## 验证与交付边界

独立design lint与完整web lint通过；48项受影响UI回归通过。pre-push中的web typecheck与完整web lint均退出0（4/4任务成功，见typecheck-lint.txt）。为避免双跑，终止过更早的手动tsc，以hook成功结果为准。最终./init.sh快速健康检查exit0（init-final.txt），未运行full。未执行全仓重验证。旧任务四轮证据不计入本次三轮。产品最终SHA为b7b0e6e87，主会话已审查三轮产品diff与代表截图并阶段验收通过；最终证据提交不再改产品，完整base..HEAD文件清单见files.txt。


### 当前已取得的浏览器结果

- `browser-check.cjs`：本地Chromium在1280/375验证完成卡与创建焦点/空名称/503保留输入和再次请求；受控pending HTTP显示加载后恢复；375空态打开创建、错误态重新加载恢复列表均有显式DOM断言和页面无横溢检查。
- 同一脚本十长标签+503先暴露越界，R3修复后通过高度边界、滚动至CTA、再次点击请求检查。这里“重试”指再发受控503请求并保留输入，不冒称成功服务端创建。
- 既有 `digital-interview-research-quality.spec.ts` 的新setup与六阶段journey两项本轮通过（5.1m，1 worker，见browser-existing-spec-retry.txt）；初次冷编译导航失败/停止重试日志另存browser-existing-spec-initial.txt，不混作成功。
- 精确产品HEAD `b7b0e6e87`，浏览器版本由结果JSON的sha绑定。无真实DB/鉴权/模型结论。长标题与成功创建导航专项已通过，见browser-long-header-results.json与browser-report.md。报告失败保留部分正文及重试入口另1项通过（browser-report-failure.txt）。


## 交付索引与后续

| 轮次 | 产品提交 | 结果 |
| --- | --- | --- |
| R1 视觉层级 | 39d944731 | RED1→46项定向回归通过；1280/375完成卡浏览器检查通过 |
| R2 交互反馈 | 304d22a23 | RED2→48项定向回归通过；双宽错误焦点/输入保留/空名称/Escape通过 |
| R3 浏览器修正 | b7b0e6e87 | 十长标签+503真实越界→局部高度/滚动修复；同场景after通过，5项创建回归通过；六阶段/新setup/报告失败共3项浏览器回归通过 |

三轮不是历史任务轮次复用。源码独立review见source-review.md（无新增P1/P2），浏览器完整说明/复现见browser-report.md。所有浏览器结果是本地真实Chromium+当前Next页面，HTTP/session为受控夹具，不验证真实DB、鉴权或模型输出，不写生产数据。产品状态、API、修订和证据契约不变。

### 截图绝对路径

前缀 `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/`。下方逐个路径为本轮文件，不引用旧任务截图。

- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/analysis-1280.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/input-tools-inside-frame-desktop.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/list-1440.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/r1-list-1280.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/r1-list-375.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/r2-create-failure-1280.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/r2-create-failure-375.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/r3-after-long-tags-cta-375x667.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/r3-before-long-tags-375x667.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/r3-created-analysis-375.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/r3-empty-375.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/r3-error-375.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/r3-header-long-1280.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/r3-header-long-375.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/r3-long-tags-375x667.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/report-1280-end.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/report-1280.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/report-390-end.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/report-390-table.png`
- `/Users/shenyangjun/.codex/worktrees/c3a4/workspacex/docs/evidence/interview-ui-5843/report-390.png`

### 干净交接

- 已复用唯一worktree，没有新建第二个。
- 35843本会话Next服务已退出，lsof无监听；浏览器/测试专属进程已清理；没有创建Docker栈。tsconfig没有本地构建目录残留。
- 未修改feature_list状态，不标passing，不自行合并。
- 主会话对产品b7b0e6e87已阶段验收，PR自动关联#5843；接下来仅跟进PR CI/review到绿，合并仍交主会话。
- 协调凭据仍缺失，不宣称真实认证或持租；本轮依据人类直接开发授权进行。

归档说明：typecheck-lint.txt仅清理终端输出的行尾空格；长标题专项以非空JSON结果及截图为证据，未保留空stdout文件。
