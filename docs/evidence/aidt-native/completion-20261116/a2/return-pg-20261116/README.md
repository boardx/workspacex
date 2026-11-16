# 精确返工修订：真实 PostgreSQL 补充验收

用户批准上下文桥接后，协调者明确授权补充此前缺失的 returnRevision 真实PG分支。本次只新增 QA，未改产品代码、权限、迁移或 Web；没有供应商或本机模型协议服务，没有执行 worker，也没有原型生成。A6原22场保持独立，不把本次数字误报为其原结果。

首个实际PG执行：**7 passed / 0 failed，15.76秒，退出0**。定向TypeScript退出0。测试第一次PG运行即通过，没有产品红→修复记录，也没有人为制造产品红。最初临时TypeScript配置位于/tmp而未指定typeRoots导致找不到node定义，修正的是本地QA配置；不把它算产品缺陷或课堂迭代。

| 场景 | 实际核对 |
| --- | --- |
| 已确认旧S6→S2 | 真实授权导入已批准课程包，实际挂载S2；使用已保存S5/S6，随后推进两步head，再受理明确旧S6修订。Guarded快照经当前权限resolve后，只包含白名单返工DTO；旧问题、前后认识、原因、下一行动和旧S5来源正确，额外字段及新head标记排除。运行仍prepared，无application派发事件；阶段保存记录不变。 |
| 未确认 | 保存的S6明确未确认，受理拒绝。 |
| 目标不符 | 保存的S6选返回S3，selector要求S2，受理拒绝。 |
| 精确修订缺失 | 请求不存在的S6修订，受理拒绝，无近似历史替换。 |
| 其他组同号修订 | 通过已有Stage用例给另组实际保存S6 V2，当前组只有V1；请求V2拒绝，未跨组读取或借同号版本代替。 |
| 跨组织 | 使用另组织tenant请求当前组，拒绝。 |
| 非组员 | 同组织consultant且未加入当前组的身份请求，拒绝。 |

六个拒绝场景均在操作前后独立计数两个组织的 human message、agent run、snapshot、application；全部不变。这里只证明受理与服务端材料投影，不声称材料已送入模型。原型采用明确合成legacy纸面标签，未伪称真实Design或测试成果。

测试：`apps/api/tests/aidt-run-context/return-real-pg.test.ts`，复用A6已验证的`support/real-pg-fixture.ts`，未修改其22场或fixture。使用标准`with-test-isolation.ts`预约，实际镜像`localhost/workspacex-postgres-age:pg16-age1.6.0`以`--no-build --pull never`运行；同一预约子进程finally只清理自己的compose项目。容器与网络均确认0剩余，不触碰A1唯一业务栈。

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- node /tmp/aidt-return-pg-command.mjs
```

临时runner是A6原受控runner副本，仅将Vitest精确文件改为新增return-only测试；标准单worker配置、隔离数据库、原有migration与RLS均保留。命令日志见`attempt-01.log`；安全事实见`machine.json`，源码哈希与清理复核见`index.json`。全部学生内容为合成夹具，不是真人课堂。
