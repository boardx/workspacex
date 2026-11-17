# SUM 真实 Skill 包与注册

任务：按 V2 补齐 `dt-summarize-project`，报告是六步之后的任务，不增加第七个方法步骤。旧 `aidt-methods@1.3.0` 不变。

- 单源内容：`skills/aidt-reporting/dt-summarize-project/SKILL.md`，涵盖 SUM-I1/I2、SUM-O1/O2、六步与循环来源、缺漏、不可信学生材料、学生审阅和可选 PPT。
- 生成器：`apps/api/scripts/build-aidt-summary-pack.ts`；新不可变坐标 `aidt-project-summary@1.0.0`，包为 `skills/starter-packs/aidt-project-summary/1.0.0.json`。
- `aidt-module.ts` 的独立 opt-in 注册坐标和 `ensure-standard-skill-packs.ts` 复用既有导入器。默认关闭时不安装；显式 pack 参数也不能绕过关闭状态。未调用冻结的 POST /skills 410、未手工修改平台目录或权限。
- 旧版本摘要见 `old-release-digest.json`，对应 1.3.0 原始字节 SHA256 `43bd0807885fb9a47d2c4dc56c5403969d2be7fda665b10d83a34a99409d40af`。

## 验证

`red.log` 是新增包生成器不存在时的真实采集失败；`green.log` 是 6 文件 38 项通过，包括真实导入用例的内存 port 验证、幂等、授权失败及不覆盖其他来源同名 Skill。它们不证明数据库安装或模型执行。

```bash
PATH=/tmp/aidt-node/node_modules/node/bin:/tmp/aidt-tools/node_modules/.bin:$PATH \
  pnpm exec tsx apps/api/scripts/build-aidt-summary-pack.ts --check
# 仓库根执行，实际已通过

cd apps/api
PATH=/tmp/aidt-node/node_modules/node/bin:/tmp/aidt-tools/node_modules/.bin:$PATH \
  ../../node_modules/.bin/vitest run --config vitest.aidt-isolation.config.ts
```

A1 在隔离 stack-06 经既有 bootstrap 实际安装后，GET /skills=200、33 项中 `dt-summarize-project` 存在、已启用、currentVersionId 非空；脱敏证据为 `../completion-20261116/a1/real-summary-skill-presence.json`。本条是目录注册验证，真实 SUM 模型调用及生成物的审阅验收由 A3/A6 继续记录，不能将上述 38 项当作真实 Agent 成功。
