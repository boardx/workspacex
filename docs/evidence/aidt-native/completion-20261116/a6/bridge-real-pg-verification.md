# 桥接真实PG与适配器集成实证

最终`attempt-05`：**22 passed / 0 failed，20.71秒，退出0**。三份独占测试源的显式TypeScript options/syntax/semantic诊断为0；生产源码已由协调者冻结。基线为`7d1abe52b`，批准桥接的工作树实现当时尚未统一提交，具体源文件SHA256见[机器证据](./bridge-real-pg-machine.json)，不伪造新commit。

入口：`apps/api/tests/aidt-run-context/bridge-real-pg.test.ts`；夹具`support/real-pg-fixture.ts`；实际本机HTTP记录服务`apps/api/tests/support/aidt-recording-native.ts`。正例由隔离组织真实管理员调用既有导入用例导入完整已批准课程包，普通学生仍为consultant、项目collaborator；证明包内容相同，不宣称平台导入血统。

标准运行：

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/aidt-run-context/bridge-real-pg.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism --reporter=verbose
```

本云环境首次两轮在数据库启动前失败：Docker buildx写只读HOME，以及compose强制构建镜像时公共apt HTTP被拒。保留`attempt-01/02`零测试失败。最终在**同一个标准预约子进程内**使用自有`DOCKER_CONFIG`和现有本地`postgres-age:pg16-age1.6.0`镜像，以相同compose/project/PGPORT执行`up --no-build --pull never`；实际TCP就绪后以`WORKSPACEX_REUSE_INFRA=1`跑原Vitest。没有改HOME、Dockerfile、端口、数据库权限或业务断言。子进程finally仅对该预约project执行`down -v`，标准wrapper释放预约。原始日志与启动脚本位于隔离scratch证据目录；不在PDF展示私密环境。

| 范围 | 实际证据与边界 |
| --- | --- |
| 原子受理 | 真实human/run/来源快照同事务；真实插入快照后受控抛错，三者一起回滚。幂等重放不改旧快照；同ID改变selector报封闭conflict码，HTTP409另由协议层/后续浏览器验证。 |
| 来源与权限 | 实际DB独有marker进入冻结快照及真实ModelCall历史槽；额外不可信context/state不进入来源；跨组/org/非成员/管理员非组员、错阶段/未知或缺pin/未知revision/归档拒绝，ModelCall与传输提交均0。 |
| 已批准Skill | 完整canonical包真实授权导入、真实发布版本与thread mount；同stableName而不同正文的独立租户负例拒绝。 |
| 撤权竞态 | owner调用真实移除成员用例；`pg_blocking_pids`观察DELETE被受理中的成员锁阻塞；接受后撤权提交，派发前重新授权拒绝，ModelCall0。无共享GRANT/REVOKE。 |
| 冻结与失效 | 缺失/坏hash的标记run fail closed；真实permission请求、一次决定、跨repo重新claim仍读V1，不偷偷换新head。S6显式选S5 V2而head V3时保留旧问题；原型引用为明确合成legacy文字，不宣称新生成Design。 |
| 实际消息与回执 | 真实Deep适配器经HTTP发送的确切历史槽hash与journal/receipt一致；原human正文含空格、多行与符号仍逐字相等。不是只检查浏览器wire。 |
| 恢复与迟到事实 | 实际execute→本机协议中断→PG待确认/一次决定→同run command-only恢复；远端thread相同、不重发input、旧snapshot保留。把第一轮确实发生的dispatch事实迟到副本append后，receipt仍指新resume并继承原hash。没有伪造新派发。 |
| SUM与普通Chat | SUM独立pin/线程、选定旧历史与当前版、缺阶段和无来源教师点评缺口；原阶段挂载不变。普通Chat没有AIDT端口调用、snapshot或application行，普通传输照常。 |

`attempt-03`的13绿/8红也保留：QA夹具错误使用agent_pins及重复Agent名称，修为真实general目录与不可变新版本，未放宽生产门。`attempt-04`21绿发生于回执迟到事件增量前；最终22绿包含该增量。

**供应商调用0。** 本机协议记录服务不是LangGraph真实运行、供应商模型推理或课堂验收；不验证计费准入，也不把真实DB/消息序列化绿称为真实Agent E2E。后续已单独通过[S2真实浏览器仅受理/prepared回执](./context-prepared-browser-final-machine.json)，修复前红仍保留；它不包含组装、派发或模型消费。本轮不再开启收费执行，人工结果与签字保持空白。
