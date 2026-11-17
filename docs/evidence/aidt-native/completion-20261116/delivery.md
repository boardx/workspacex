# AIDT V2 本轮交付

需求以用户完整V2 Markdown为准；课程方案A已按用户明确批准实现。主体代码7235b9cdcfea2774df913035cb3f2109504213ad，课程同源代理补修4bfb82e268a618d57af25e5596a11ddc04cf38cf。后续提交仅整理证据/文档，不将文档SHA冒充新代码已测试。

## 已交付行为

- 独立AIDT入口、原生Chat宿主与六步输入/成果/历史；共享保存、CAS和原有双停启/双账号基线。
- 正式课程登记与现有组映射，一组一课；成员/权限仍来自现有Project，不自动入组或授予跨组访问。
- 原件上传与实际Artifact版本、独立处理回执、鉴权字节/hash回读；发现卡明确区分原话、解释和模拟AI推测。
- 三份不同点子描述单、多标签/理由与选择分开；逐份/合并原生打印，等待所有源图和打印页图像解码，失败保留预览/可重试。
- 原生静态Design V1/V2、旧被测版本/问题冻结与按需新版关系；小组报告保存/历史及新SUM审阅导入代码。
- 全局成员文字插件：主频道、单层回复、两份会话内未发稿；22处真实界面已巡检，不触发AI生成。

## 实际验证

| 范围 | 实际结果 | 证据 |
|---|---|---|
| 相关Web回归 | 91文件812项同批通过 | integration/v2-web-812.txt；文件选择v2-web-812-files.json |
| 打印最小补修 | 后续6文件50项通过，与前批可能重叠不相加 | integration/v2-print-50.txt |
| API/Web完整类型 | 两者exit0 | integration/v2-api-typecheck.txt、v2-web-typecheck.txt |
| 设计/testid/零外部主机 | 设计lint0，6425 testid引用通过，本地版静态零出网0违规 | integration/v2-design-lint.txt、v2-testid-lint.txt、v2-local-zero-egress.txt |
| 课程API/共享异常处理 | API-only17检查、课程41项、普通Filter独立8项；错误码真实失败后修复 | ../fr01-course-entry/course-final-index.json |
| 原件真实HTTP/PG | 2artifacts/3版本/4回执/3pending、原字节/hash/提交元数据、RLS/权限独立核对；0agent_run | a3/approved-raw-sum-index.json |
| 原件/发现卡/持久图打印 | 实际浏览器1passed；上传/回读/非组员拒绝/三份真实beforeprint图片完整 | a6/v2-raw-materials-and-print-machine.json |
| 临时图/多标签打印 | 实际浏览器1passed；原契约拒绝临时图共享保存且无PUT，旧文本不变，三份print完整 | a6/v2-local-preview-and-print-machine.json |
| 课程最终UI | 补同源路由后3passed/15.4s，0retry/0model，旧三红保留 | ../fr01-course-entry/course-ui-final-02-summary.json |
| 最终新路由旧原件 | 原两份字节/hash/版本/提交者+时间及旧S2严格不变，0新upload/0model | a6/v2-final-rewrite-original-readback.json |
| 真实模型技术链 | 原生S1同run机械恢复、Design两版及计量已核；不证明教学context | a1/native-s1-settlement.json、a1/design-real-accounting.json |

以上不是整个monorepo CI、真人访谈或30人课堂验收，不重复累加复跑。PDF实际另存字节仍待人类操作；自动beforeprint不能代签此项。

## 本机启动与人工验收

源码根目录执行以下已交付入口；Node22和pnpm9.15，首次安装需网络：

```sh
pnpm install --frozen-lockfile
pnpm aidt:local doctor
pnpm aidt:local start
```

启动工具显示ready后用同一电脑浏览器进入它输出的AIDT地址。停止/健康检查分别为`pnpm aidt:local stop`、`pnpm aidt:local health`；完整前提、账号查看与预构建见[本机说明](../../../development/AIDT-LOCAL.md)。不能把云环境内部localhost当外部链接。

[人工手册源](a6/aidt-v2-human-acceptance.md)对应单独交付的24页PDF，H01–H15覆盖FR01–19，操作/预期/实际/缺陷/签名完整；人工结果与签字留白。源码`apps/web/e2e/fixtures/aidt-v2`含同套显式合成材料，可另下载材料ZIP；没有真人照片、密码或私密运行数据。

定向自动验证命令包括：

```sh
pnpm --filter api exec tsc --noEmit --incremental false
pnpm --filter web exec tsc --noEmit --incremental false
pnpm --filter api exec vitest run --config vitest.aidt-course-unit.config.ts
pnpm --filter api exec vitest run --config vitest.aidt-files-unit.config.ts
pnpm --filter web exec vitest run tests/aidt-courses-rewrite.test.ts tests/projects-rewrite.test.ts tests/report-files-rewrite.test.ts --maxWorkers 1 --minWorkers 1
pnpm --filter web run lint:design
```

真实浏览器lane为`apps/web/playwright.aidt-v2.config.ts`，需要显式隔离栈/测试身份/权限和共享预算前提；详情见矩阵，不用缺配置skip补绿。该配置也含尚未通过的收费Agent场景，不能把已通过小场景扩展成整套16例全绿。

## 未完成与真实阻塞

原生AG-UI忽略教学context，S1实际误认阶段；后续S2–S6及SUM收费验证暂停。服务端精确来源快照桥接有[完整待签核束](../../../design/aidt-native-context/design-signoff.md)，新运行契约未实现，不能用课程方案A批准替代。普通学生当前模型资金前提也未满足；funded管理员仅技术actor。

教师进度/点评专门流程、自主叙事展示及3D仍是P1/P2剩余；访谈录音/转写、语音房和评分按用户决定后置。保留P3 createProject缺provenanceEventId合同缺口，未伪造回执。具体逐条见[统一边界](acceptance-boundaries.md)。

未部署、合并、扩大权限或重试此前被自动审批拒绝的GitHub外发；没有PR/CI绿灯或人类签收结论。交付包为源码，不含node_modules、运行数据库、密钥、已构建产物或浏览器截图。
