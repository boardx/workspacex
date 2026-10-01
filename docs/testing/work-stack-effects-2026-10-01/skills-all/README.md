# 全部 200 Skills：库存与验收标准

库存基线：`d03fb3b5dacc0d4ff4464dff3af830a9744d2b1c`。库存另聚合机器编译/样本校验及确定性运行报告，没有运行 200 个真实模型任务。`inventory.csv` 为 S001–S200 各一行；保留所有 starter pack 历史版本坐标，不把版本号最高的包自动当作部署版本。目录存在不证明已发布或已验证。

复验命令（仓库依赖已安装）：

```sh
node docs/testing/work-stack-effects-2026-10-01/skills-all/generate-inventory.mjs
node docs/testing/work-stack-effects-2026-10-01/skills-all/generate-inventory.mjs --check
```

生成器读取 320-LIST、两张组合矩阵、作者文档、review、实际 YAML frontmatter、starter JSON、suite 和运行时 subject 注册。CSV 的 machine_validation 与 execution_evidence 来自统一证据报告；报告不存在或来源不可核实时保持 NOT_RUN/STALE_EVIDENCE。schema_present 仅表示字段存在。运行 `--check` 能发现源变更导致的库存过期。

## 已确认库存

| 分类 | 数量 | 意义 |
|---|---:|---|
| 规划 Skill | 200 | 320-LIST 唯一 S ID |
| 已作者化文档 | 86 | 非执行通过 |
| 已有 review 文件 | 63 | 文档评审证据 |
| SKILL.md 文件 | 89 | 包含跨目录重复 |
| 唯一 manifest / starter Skill | 83 | 非导入、执行或质量通过 |
| eval suite | 27 | 26 个尚未注册 loopback subject |
| 当前 loopback subject | 1 | S003；确定性技术回环，不是真实模型质量 |
| 当前整体 PASS / FAIL | 0 / 56 | 56 个实测机器契约无效；没有专业质量 PASS |
| BLOCKED / NOT_IMPLEMENTED | 27 / 117 | 剩余可执行包待完整验收 / 无可执行包 |

320-LIST 的“86/320”不能解释为 86 个 Skill 执行通过。S014、S019、S027 有作者文档但无可执行 starter；另 114 个仍缺作者文档。83 个打包 Skill 中 56 个缺 suite。重复 manifest 为 S009、S010、S017、S063、S157、S161。S009 的历史 sales/product 内容分叉需要按明确权威坐标消费；新的 sales 1.1 排除该旧分叉，旧包仍在库存中。

销售单体 Skills 均进入分母及包检查；完整 CRM/销售 Workflow 暂缓不意味着删除这些 Skills。CRM 依赖必须如实验证，缺配置应 BLOCKED，不能用 mock 成功替代。

## 逐项验收门槛

每项证据必须记录 stableId、stableName、内容 digest、包版本、实际 skillVersionId、代码 SHA、命令、环境、结果及日志路径；复验同一固定坐标。历史不可变包不原地修改。

1. **G1 作者与可追溯性**：目标、输入、产出、边界、来源及许可可追溯；矩阵直接引用准确，依赖不能扩张为组织全部 Skills。
2. **G2 机器契约**：使用生产 parser 校验真实包；所有 `$ref` 真正解析；有效输入通过、错误输入拒绝、合法/非法输出均有反证。仅 YAML/Zod 外层或字段存在检查不足。
3. **G3 导入与冻结**：真实租户数据库导入，verified 精确版本才 pin；候选/缺版本显示 pending；跨租户拒绝、不可变历史、幂等及升级不绕验证。
4. **G4 执行与工具**：生产调用链实际执行固定版本，真实工具/依赖配置；超时、缺权限、缺配置、异常返回有准确失败；工具未返回不能虚报产出。确定性 loopback 单独记录技术通过。
5. **G5 专业效果**：真实模型完成每项 suite 的 must-pass cases；对照同工具通用模型，按作者规则和独立评分验证内容正确、引用可靠及有实际增益。记录模型 ID、用量、评分器版本及盲评依据；禁止把 synthetic fixture 或 loopback 写成此门通过。
6. **G6 产品流程**：成员实际发现/挂载/调用、数字人精确能力范围、切换角色和组织隔离、失败与重试、产物打开/下载在真实浏览器验收。

## 状态定义及更新规则

- **PASS**：对应固定版本的适用 G1–G6 全部有实际通过证据，含真实模型专业质量；明确说明不适用门及原因。
- **FAIL**：验收实际执行并违反目标/契约/权限/专业评分标准；附最小反证。修复后先记录原失败，再在新固定坐标复验。
- **BLOCKED**：实现包存在，但 suite、注册 subject、工具权限/凭据、配置或其他必要证据缺失，导致完整验收无法完成；列具体阻塞，不能按 PASS 关闭。
- **NOT_IMPLEMENTED**：没有可执行发布包；作者文档或规划存在仍按此处理。实现后重新执行完整门槛。

文档 review、静态校验、技术 loopback、真实模型和浏览器门应分开保存状态。当前 CSV 聚合 machine-schema/report.json 和 runtime/per-skill-evidence.json：27 个契约可编译，56 个无效，267 个输入及 248 个 fixture 输出合法，19 个 case 无输出样本；S003 确定性协议通过，其余缺 subject/suite，真实模型质量仍 BLOCKED。这些输入/输出只是样本校验；后续实际失败可覆写相应验收记录，但须保留证据与固定版本，不能把生成器的 presence 检查升级为 PASS。

## 下一步 Backlog

- [x] 200 ID 完整库存、角色/Workflow 引用与包历史坐标。
- [x] 制定逐项门槛、状态和证据格式。
- [x] 83 个实现的严格机器契约扫描与已有样本校验。
- [ ] 修复 56 个无效机器契约及补齐 19 个输出样本。
- [ ] 补 56 个缺 suite 及 26 个已写 suite 的真实执行入口。
- [ ] 验证各项真实配置/工具与冻结版本，执行质量和浏览器验收。
- [ ] 完成 3 个已有文档无实现的 Skills。
- [ ] 作者化并实现剩余 114 个规划 Skills。

这些未完成项是实际缺口，必须继续按单项结果推进，不能据本报告声称全部 Skills 已验收。

证据新鲜度：机器报告必须提供生产编译器与各 SKILL.md 内容指纹，生成器对当前文件逐项核对；运行报告 sourceSHA 对应的 manifest 和 suite 文件须与当前字节一致。固定旧报告不因新源更改继续被当作当前通过。证据文件由对应专项产出，本生成器只读聚合，缺报告不会凭库存推断执行结果。
