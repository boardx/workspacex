# DevApp AIDT 只读就绪投影实现

工作树 `/workspace/aidt-pr-20261117`，起始HEAD `1d1e131d89996f416b31f0863a570cb82e9817fc`；仅由本任务修改：

- `scripts/image-release-host-permissions.py`
- `tests/test_image_release_aidt_readiness.py`（新增）

源码已稳定，未commit。workflow的TARGET_ENVIRONMENT传递及其他诊断修改归root/其他owner，本任务未编辑。

行为：仅 `TARGET_ENVIRONMENT=='devapp'` 在既有collect结果增加 `aidtReadiness`。列表与inspect均为有界GET；摘要和API候选只接受workspacex/workspacex-devapp/devapp/wsx-devapp，摘要最多20条，OCI revision仅40位lowercase hex。扫描完整有界列表后才判唯一，避免第21条以后隐藏第二API。无匹配或歧义返回UNKNOWN，不推断应用不存在；仅唯一API且64hex ID才inspect，并复核ID/project/service/running，拒绝竞态或身份变化。

inspect的Config.Env只在内存中用于两固定key投影：enabled/disabled/unset/invalid/duplicate；不输出值、其他环境、Config、容器名称、主机路径或原始异常。未读取private policy或执行SQL/sudo新命令/exec/HTTP写。默认和其他target不增加该可选字段。模块docstring明确Never emits credentials，不错误声称inspect从未读入环境载荷。

root随后隐私收窄覆盖最初允许all-project标签摘要的范围；最终源码及回归明确排除CN/第三方项目。

验证：`python3 -B -m unittest discover -s tests -p 'test_image_release*py' -v` **22 tests通过，exit0**（含新增11测试、旧权限3及既有其他8），无Docker/主机/数据库访问；边界通过subtests覆盖两flag全部状态、读取错误、超限与非法JSON、非法ID、项目排除、歧义不inspect、identity race、停止API、默认collect不变与无敏感输出。日志 `/tmp/aidt-devapp-readiness-unit-final.log`。定向 `git diff --check` 无输出。

稳定字节SHA256：source `cd418b88cb41361be92c37dd6e2f1f5616a305e7d438c0cbe0f71d634d7f9c7b`；test `9374107c72218c114cf183f2d71e04788c7b36685452ae18a084a69c96b15f51`。

测试不是实际host就绪证明。本任务未dispatch/rerun/probe/deploy；live flags和schema adapter仍需root沿既有授权入口取得真实回执。
