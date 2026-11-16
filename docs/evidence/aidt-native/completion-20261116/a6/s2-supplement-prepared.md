# S2 补测：已备实现，尚未批准执行

本文件供新增一次任务审批。当前只做离线开发、单元反例、类型/lint与用例发现；未启动环境、未创建线程、未保留任何真实补测额度、未发送模型。旧S2已取消的任务、实际费用、phase历史和两个旧账本均保留。

## 可审阅的入口

- 专属配置：`apps/web/playwright.aidt-s2-supplement.config.ts`，仅1个场景、1 worker、0 retries、没有webServer或原始trace。
- 场景：`apps/web/e2e/aidt-v2-s2-supplement.spec.ts`。
- 独立预算门：`apps/web/e2e/support/aidt-v2-s2-supplement-ledger.ts`，固定最多1个aidt-empathize任务。
- A1预收费只读证据校验：`apps/web/e2e/support/aidt-v2-s2-supplement-preflight.ts`。这是QA审计证据，不是新增产品HTTP契约。
- phase收口：`beginSupplementalS2Attempt` / `completeSupplementalS2Attempt`，仅在新的实际成功/来源回执/学生保存/新登录都完成后，把原s2标为`supplemental-actual-success-original-failed-retained`；原startedAt、原失败evidence、continuations及旧账entry不删除、不覆盖。

正常确定性fullstack与原V2付费lane均**精确排除**本新spec。缺少明确开关时本专属lane直接失败，不skip补绿、不退回旧7或S1额度。

## 开窗条件（目前没有执行授权）

| 配置/前提 | 强制判据 |
| --- | --- |
| `AIDT_V2_S2_SUPPLEMENT_ENTRY_ENABLED` | 仅明确设为1后才允许该入口准备浏览器；默认关闭 |
| `AIDT_V2_S2_SUPPLEMENT_AUTHORIZED` | 必须是本次明确的`approved-additional-s2-once`，不是S1开关或泛用true |
| `AIDT_V2_SUPPLEMENTAL_S2_LEDGER` | 独立绝对JSON路径；不得等于旧7或S1账，软链接/硬链接别名也拒绝 |
| 旧7与S1账 | 保留原路径供只读保护；新的reserve/record/finish只写S2独立账。unknown/failed也占1，跨进程原子锁，无自动退额或新send重试 |
| `AIDT_V2_S2_SUPPLEMENT_PROJECT_ID` / `AIDT_V2_CANCELLED_S2_RUN_ID` | 与当前同组state、旧S2失败entry、实际正常GET的cancelled run一致；S1已完成，s2仍attempting且未做过补测 |
| `AIDT_V2_S2_CANONICAL_PREFLIGHT` | A1实际受约束app_rw只读预收费receipt；fresh≤5分钟、同org/user/project/oldrun，actual oldcancel；active/holds/unsettled0，native executor仅获准S2后为1 |
| API owner绑定 | receipt的PID/startTicks必须与`AIDT_V2_API_OWNER_PID` / `AIDT_V2_API_OWNER_START_TICKS`对应；不把离线恢复的exec0证据误作真正收费窗口 |
| `AIDT_V2_S2_REVIEWED_FIXTURE` | 已审阅A5私有隔离QA append-only应用证据；actual published版本必须是新canonical版本、旧版本不同且digest精确一致 |

canonical默认版本来自已审阅的隔离测试夹具修复，不声称旧legacy行已通过正常publish API修好。普通`GET /agents/:agentId`能力图只返回`publishedVersionId`等既有字段，本spec用它核指针；instructions digest由A1受约束只读审计提供，**不假造普通API有该字段**。E2E无SQL写入、无角色/权限/余额变更。

## 唯一任务的计划操作

1. 正常UI登录原实际技术actor，正常GET核旧run确实cancelled、旧线程同project与plenary、旧消息和来源回执。保存两个旧账本原始字节及原phase失败记录。
2. 校验上述A1实际预收费receipt和正常Agent能力图，确认当前真实新canonical不可变版本。校验真实已启用aidt-empathize目录、旧挂载与原approved pin；目录已换版时停止，不自动升级旧pin。
3. 通过既有`POST /chat/threads/mutate`创建新plenary组线程，完全复用旧线程的project/group/visibilityScope；服务端返回真实ID与审计事件。通过既有GET skill-deviations取得乐观version，再POST skill-mounts挂同一个approved S2 pin。GET回读新线程消息为空。
4. 打开现有AIDT `step=2&tool=chat&thread=<新ID>`，在现有原生能力选择器显式选择同一个默认Agent，不换成会触发agent_pins范围的普通新Agent。
5. 仅一次SDK send；学生prompt明确合成范围、当前人工清单及“内部核对、不回显、一句核心澄清问题、等学生回答”。用现有严格helper核人话原文、strict坐标、actual immutable agentVersion、focus pin、服务端快照与真实派发/合法同run恢复、无AI自动保存。
6. 学生审阅实际回复后自行修订清单与反思，原提纲/发现卡/原件保留；正常共享保存、新登录精确回读。旧人工fallback修订仍可按精确历史GET读取；旧取消run/旧消息/旧receipt与两本旧账逐字不变。
7. 只有全部实际条件通过才完成supplemental phase，保留原S2失败并解锁原S3。基础角色错认、其他工具等待、失败或未知状态不自动新发。

新项目线程、空消息及实际run.threadId可由浏览器正常API证明；Deep远程checkpoint/remoteThreadId与旧echo隔离仍需A1独立实际派发审计，因为现有公开receipt DTO不提供remoteThreadId。不能把新thread UI就当成远程checkpoint已实证隔离。

## 本次实际离线检查

独立S2账门4项、只读preflight/原失败保留3项及既有31项共38项单元检查通过，含默认关闭、错skill/project/path/旧账别名、unknown/failed跨进程占1与锁冲突，wrong/stale preflight、未取消/错误版本/digest/占款拒绝，不能以假成功解锁phase。owned TS与ESLint退出0、专属场景发现1条。所有测试仅用临时无网络文件。

实际旧7账SHA保持`96ea384f5c3206432ea607d36e16b3439e9cbc17c169433d34c8e838327e9bae`，S1补账SHA保持`6c05de0c89f39165167e7cf64c6429969444757a2a39aab9400e5a318dbb8b9d`。新S2真实账尚未创建。先前testid门两次红保留；仅改为真实button name精确定位后全门通过，没有豁免或业务修改。

安全发现命令（不建线程、不发送）：

```sh
pnpm --filter web exec playwright test --config playwright.aidt-s2-supplement.config.ts --list
```

真正执行须待新的明确一次额度批准、A1新隔离环境恢复与exact单任务窗口，再由owner在私密子进程载入实际身份和以上证据。当前文档不是执行许可，不复用已关闭runtime或旧checkpoint冒称通过。
