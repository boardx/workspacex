# A3 验证和交接

2026-11-16。本工作树`worker/aidt-complete-report_history`，基线`15ca37c4d`。

| 检查 | 实际结果 | 证据 |
|---|---|---|
| root统一`./init.sh` | root通知退出0；本worker不重复安装依赖 | root会话与集成证据 |
| 6个定向测试文件 | 39项通过，退出0，6.69秒 | `tests-final.txt` |
| 新增helper/UI与报告组件定向eslint | 退出0，无输出 | `eslint.txt` |
| 完整web typecheck/build | 本worker未执行，按root指令集成后统一跑 | 待root集成证据 |
| 真服务器/真实模型/课堂验收 | 本worker未运行；夹具和DOM测试不能替代 | `review.md`真实验收清单 |

验证命令（Node22、pnpm9.15）：

```bash
export PATH=/tmp/aidt-node/node_modules/node/bin:/tmp/aidt-tools/node_modules/.bin:$PATH
WORKSPACEX_WEB_TEST_MAX_WORKERS=1 pnpm --filter web exec vitest run tests/aidt-report-history.test.ts tests/ui/aidt-report-history.test.tsx tests/ui/aidt-shared-report-preview.test.tsx tests/ui/aidt-ui-v2.test.tsx tests/ui/aidt-ui-v5.test.tsx tests/aidt-stage-history-client.test.ts --reporter verbose
pnpm --filter web exec eslint features/aidt/lib/aidt-report-history.ts features/aidt/components/aidt-report-history.tsx features/aidt/components/aidt-report-preview.tsx tests/aidt-report-history.test.ts tests/ui/aidt-report-history.test.tsx --max-warnings 0
```

## 修复记录

初轮测试在RUN后挂起，主动终止了本worker的进程；`tests.txt`与`helper-tests.txt`保留不完整/失败记录。单个功能测试`helper-debug.txt`通过。根因是测试的`beforeEach(() => mocks.list.mockReset())`返回mock函数，被Vitest当作cleanup无参再次调用：当mock返回不结束的Promise时，cleanup等待不结束。已改为大括号不返回函数；随后全组通过。没有改全局config、弱化断言或改业务超时预算规避测试。

新增反证覆盖：非协作transport取消、总预算超时、12请求/60修订上限、正文摘录截断、部分失败保留、401/403/404丢弃整批、当前编辑不被读取覆盖、插入使用最新编辑、超出正文上限拒绝追加、A→B→A晚到结果、所有scope维度切换、卸载和只读降级、学生主动审阅及保存边界。原历史客户端既有作用域/游标验证一并通过。

## 集成注意

- root在现有`AidtReportPreview`传入`historyScope`；准确结构见`review.md`。不传则不显示入口，既有调用兼容。
- 不修改既有保存/重读testid、报告textarea label或“从成果重新整理”按钮；native acceptance既有流程无需重写。
- 阅读后仅主动追加正文，历史引用保留在正文；现有保存回执的单步来源结构不等同全部历史索引。
- 保持设计签核原状态、共享Backlog和Chat未改。本地提交后交root集成；未部署、合并、外发GitHub或变更权限。
- harness tick缺协调网关沿用root的明确限制；没有伪造tick成功、feature passing或人类签核。
