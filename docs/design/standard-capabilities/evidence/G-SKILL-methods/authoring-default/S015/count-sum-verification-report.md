# count-sum 技能草稿验证说明

## 范围与触发

- **应触发**：用户提供含 `count` 列的 UTF-8 CSV，要求合计/校验非负计数并返回 JSON `{"total": ...}`。
- **不应触发**：问候语、允许负数的求和、无 `count` 头的表格、需要 pandas/网络/数据库的分析。

## 包结构（packagePath）

- `SKILL.md` – 触发条件、工作流、错误语义、边界。
- `scripts/sum_counts.py` – stdlib-only Python 脚本，参数为 CSV 路径，stdout JSON，stderr 错误。
- `references/validation-guide.md` – 详细校验规则、正反例表。
- `LICENSE.txt` – skill-authoring 上游 Apache-2.0 许可保留。

## 实际脚本执行证据

所有命令均在沙箱内以 `python3 /workspace/count-sum/scripts/sum_counts.py <path>` 真实执行：

| 用例 | 输入摘要 | stdout | exit | 结论 |
|------|----------|--------|------|------|
| 正例-基础 | `count\n1\n2` | `{"total": 3}` | 0 | ✅ 通过 |
| 正例-额外列 | `id,count\na,1\nb,2` | `{"total": 3}` | 0 | ✅ 通过 |
| 正例-全零 | `count\n0\n0\n0` | `{"total": 0}` | 0 | ✅ 通过 |
| 正例-浮点 | `count\n1.5\n2.5` | `{"total": 4}` | 0 | ✅ 通过（整数化） |
| 反例-负数 | `count\n-1` | stderr: negative count -1 at line 2 | 1 | ✅ 正确拒绝 |
| 反例-缺头 | `value\n1` | stderr: CSV must have a 'count' header | 1 | ✅ 正确拒绝 |
| 反例-非触发文本 | `hello world` | stderr: CSV must have a 'count' header | 1 | ✅ 不误算 |

## 草稿工具调用结果

- 使用 `wx_skill_create_draft(stableName="count-sum", semanticVersion="0.1.0", ...)` 提交完整文件映射。
- 返回 `artifact_draft` 与 workspacePath；未生成 skillId，未启用任何技能。
- 随后用 `wx_artifact_publish(mediaType="application/json")` 发布该 JSON 草稿包；附件就绪需等待 run writeback。

## 状态区分

- ✅ 包完整性已验证：文件存在、路径规范、脚本真实执行通过。
- ✅ 脚本测试证据：上表为正反例真实运行结果。
- ⚠️ 依赖：仅声明 python runtime；无第三方包，已在沙箱验证可用。
- ❌ 管理员尚未导入：本流程不触发 importSkillStarterPack；导入是显式管理员动作。
- ❌ 未发布为可用技能：草稿 ≠ 启用；普通用户无法通过此产物直接调用 `/skills`。

## 复现命令

```bash
python3 /workspace/count-sum/scripts/sum_counts.py /workspace/count-sum-tests/pos_basic.csv
python3 /workspace/count-sum/scripts/sum_counts.py /workspace/count-sum-tests/neg_basic.csv
```
