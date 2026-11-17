# 新增一次 S2 补测：执行记录

2026-11-16，用户已明确批准新增最多一次 S2 native 补测。此前的[s2-supplement-prepared](../s2-supplement-prepared.md)保留为审批前历史，不改写成当时已获许可。

当前状态：**首轮模型前选择器断言失败保留；独立0send证明及零SDK诊断后，按root/A1重新开放的同一首send窗口复用同空线程。第二次浏览器已实际发送唯一请求，任务终态 failed / MODEL_CALL_FAILED，测试退出1并停止，不重发。** 资源只由 A1 管理，不复用已关闭的 stack04/restore01 runtime。

## 预算与历史

- 新补测只用独立 `additional-s2-ledger.json`，固定最多1个 `aidt-empathize` 任务；unknown/failed仍占1，无自动新send重试。
- 原七次账本 SHA256：`96ea384f5c3206432ea607d36e16b3439e9cbc17c169433d34c8e838327e9bae`。有效已占旧S1与已取消S2两次，余5次仅供后续S3–S6/SUM逐项授权。
- S1补账 SHA256：`6c05de0c89f39165167e7cf64c6429969444757a2a39aab9400e5a318dbb8b9d`，已用的1次不重置。
- 原S2失败entry、取消run、旧线程/任务卡/来源快照/实际费用、人工fallback V5与phase失败记录均保留。仅新的完整实际成功后才能以“supplemental actual success，原失败保留”完成s2；当前不假完成解锁s3。

## 唯一执行命令与配置来源

由私密wrapper在子进程内存载入新的A1 runtime和本次实际preflight，不打印身份、密码、模型配置或密钥：

```sh
pnpm --filter web exec playwright test \
  --config playwright.aidt-s2-supplement.config.ts \
  --grep 'supplemental S2:'
```

必须显式提供以下环境，不能使用猜测值或旧runtime：

| 组别 | 配置 |
| --- | --- |
| 正常登录 | `REAL_MODEL_E2E_BASE_URL`、`REAL_MODEL_E2E_EMAIL`、`REAL_MODEL_E2E_PASSWORD`；均来自新runtime，实际actor保持既有funded技术管理员，不代表普通学生资金 |
| 新恢复环境 | A1真实`WORKSPACEX_*`隔离键、`AIDT_V2_API_ORIGIN`、`NEXT_PUBLIC_API_PATH_PREFIX=/__fullstack_api`、实际Web/API源码与restore receipt |
| 旧保护文件 | `AIDT_V2_RUN_LEDGER`、`AIDT_V2_SUPPLEMENTAL_S1_LEDGER`、`AIDT_V2_COMPLETION_STATE`，指原文件，执行前后比较旧账原始字节 |
| 新预算 | `AIDT_V2_SUPPLEMENTAL_S2_LEDGER`独立绝对路径、`AIDT_V2_S2_SUPPLEMENT_AUTHORIZED=approved-additional-s2-once`、`AIDT_V2_S2_SUPPLEMENT_ENTRY_ENABLED=1` |
| 原范围 | `AIDT_V2_S2_SUPPLEMENT_PROJECT_ID`、`AIDT_V2_CANCELLED_S2_RUN_ID`；与真实旧取消run、state及已恢复小组一致 |
| canonical事实 | `AIDT_V2_S2_CANONICAL_PREFLIGHT`、`AIDT_V2_S2_REVIEWED_FIXTURE`、`AIDT_V2_API_OWNER_PID`、`AIDT_V2_API_OWNER_START_TICKS`；前者为新鲜、实际PID绑定、仅S2 exec1且其他执行器0/active与占款0的A1只读证明 |
| 测试运行 | `AIDT_V2_REAL_AGENT=1`、有界run timeout、私有`AIDT_V2_OUTPUT_DIR`、现有Playwright浏览器路径；1worker/0retries，原始trace关闭 |

`verifyRestoredReceipt`只用于真正零执行恢复时刻，严格门不改。不得在收费窗伪传exec0重跑它；执行证据将关联此前A1实际验证的restore receipt hash和新的exec1 PID/startTicks预收费证明。普通API只核已有publishedVersionId等字段，instructions digest来自A1受约束只读审计，不假造新产品API。

## 判决

模型前确定性QA失败只在A1实际证明0send/无新run/预算未占用后修复并继续该首send，全部失败保留。一旦已reserve或wire/实际run出现，失败即停，不自动另发。仅真正符合当前合成任务的`confirm_task_intent`可按既有明确审阅路径在同run继续，不能批准其他工具或用编辑掩盖错误基础角色。

新正常plenary线程、同approved S2 pin、canonical新版本、来源冻结与派发、学生实际修订保存/新登录、旧历史和两账不变均须实际核验。远程checkpoint隔离另由A1独立核真实派发，不能仅凭新thread ID当作已验证。S2实际成功后，剩余5个原任务仍逐个等root/A1开窗。

实际结果、run与线程坐标、回执、结算、学生决定及新登录：**待执行，不填写通过。**

## 首次模型前失败及零SDK诊断

- [首轮真红](s2-supplement-attempt01-red.txt)：正常创建并挂载的空线程为 `thr-0a23a022-c27f-43c4-96dc-0f40cd31b9d1`。桌面正常click后 `data-auto-match` 仍为 true，严格5秒断言失败；未调用阶段begin、预算reserve或SDK发送。
- [独立A1证明](../../a1/s2-supplement-20261116/attempt01-zero-send-proof.json)：新线程0消息/0run、唯一approved S2 pin，旧历史/两账不变、新补账不存在；全局physical/usage/credit仍各2、active/holds/unsettled均0。
- [一次零SDK诊断](s2-supplement-picker-zero-model.json)：实际1440宽、popover，真实目录GET200。default目录卡为org/null avatar，始终others且同一DOM节点，未观察搬组；**原失败原因未被确定，不声称产品搬组竞态已证**。目录响应并渲染后一次正常click，auto-match=false、aria-expanded=false通过，nativeRequests为空，浏览器已关闭。
- QA仅新增目录ready+实际渲染守门，保留原严格断言；`AIDT_V2_S2_SUPPLEMENT_REUSE_EMPTY_THREAD_PROOF` 指向上述A1证据才复用同空线程，不再次create/mount。独立GET仍核同project/group/plenary/author/approved pin/messages0，当前两账hash及新账不存在必须匹配；新鲜的实际exec1收费preflight仍必需。
- 定向检查：[8测试通过](s2-supplement-resume-unit.txt)（包含9类恢复拒绝反例）、[scoped TS退出0](s2-supplement-resume-ts.txt)、[ESLint退出0](s2-supplement-resume-lint.txt)、[只发现1用例](s2-supplement-resume-list.txt)。这些不是模型或教学通过。

截至该记录，补测实际send/模型回复/来源派发/学生修订与新登录仍待执行，未写通过；原始失败与未消费的独立max1额度均保留。

## 唯一实际请求：失败即停

2026-11-16 14:20:03 A1实际重新核查并开放exact S2窗口，PID/startTicks、canonical新版本、旧cancel/余额/active与占款0、两旧账和零窗restore receipt均通过预收费门。按root授权，复用上轮空线程，不create/mount；桌面picker严格auto-match=false、关闭通过后，只发一次SDK请求。

- [实际执行记录](s2-supplement-attempt02-execution.json)、[原失败日志](s2-supplement-attempt02-run.txt)、[实际附件](s2-supplement-attempt02-attachments.json)。API源`adbb21d0ea19ce8ad8d822430369005be39b4976`、Web源`ec5ff2e9de501426f3fec9a0dddd6dfb314be4cd`，QA为运行时working-tree增量，不伪称全部已在该commit。
- SDK观察时间14:20:46；actual run `40539aa6-2732-4661-9665-913013af806d`，同新线程`thr-0a23a022-c27f-43c4-96dc-0f40cd31b9d1`。服务端任务终态`failed`、`MODEL_CALL_FAILED`；测试6.9秒退出1，无assistant/HITL审阅、无学生新修订保存/新登录成功，不记教学或机械全链通过。
- 实际浏览器selector仅S1 V2 + S2 V5，单approved `aidt-empathize` pin；prepared snapshot hash `326557fd5f9b8c5f2d30c8c9bec8c2a820ffbbf8e4c7787f071a8106c723968a`。独立GET当时application仅`assembled`，hash `e9527c822d1d11a723ed7676fdc17c5eca5a45de116f04c06c10e4298e73a6f6`；没有派发观察时间，**不据wire或assembled声称供应商消费**。
- 新补账唯一entry `34df8c67-6f56-46b1-b1d9-9a5804bb9c86` 状态`failed-or-interrupted`，已占max1，provider未知状态仍占用，不退款、不删entry、不重置。两旧账原始SHA保持上述值。原s2及supplementalS2 phase仍attempting、未添加completionKind，不解锁S3。
- 已通知A1关闭窗口并独立核实际provider调用/费用/终态；尚无该核对结果时不写0调用或0费用。后续S3–S6/SUM和Design均未启动。

### 独立owner后续事实（不覆盖早期receipt）

[A1实际DB核账](../../a1/s2-supplement-20261116/native-failed-accounting.json)及[实际关窗](../../a1/s2-supplement-20261116/attempt02-paid-window-closed.json)已落盘。14:20:48.750出现晚到`message-dispatch-observed`，hash与冻结block一致，且新API/remote thread/run均与旧echo任务分离；这与browser早期读到assembled是不同时间事实。不能把该原生派发观察等同供应商内部prompt审计或成功模型回复。

本次同一native任务实际产生**2条physical model request、2条failed usage**（当前记录tokens为0），不是只发生一次模型completion。两条credit request仍pending，实际wallet占款8629 hundredths，**费用未结清、不能记0费用或noOutstanding通过**。A1正常关窗后agent与其他执行器均0，active0；原财务状态保留，不SQL释放/伪结算。单SDK无新send重试事实保持；native预算仍占1，不因内部2次physical重置或追加新任务。

[A2实际只读来源与隔离审计](../../a2/s2-supplement-audit-20261116/actual-failed-run-report.json)验证canonical新版本、S1V2/S2V5实际DB投影、同approved pin、冻结/派发hash及新remote namespace；仅来源与隔离事实通过，不替代该失败任务的回复/教学验收。
