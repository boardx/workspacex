# count-sum 草稿验证说明

## 包内容

- `SKILL.md`：触发条件、执行流程、资源索引与边界。
- `scripts/sum_counts.py`：纯标准库脚本，参数为CSV路径，成功输出JSON，失败非零退出。
- `references/validation.md`：验证清单与已执行命令记录。
- `assets/example_positive.csv`、`assets/example_negative.csv`：最小正反例。
- `LICENSE.txt`：上游 skill-creator Apache-2.0 许可保留。

## 已执行验证

| 用例 | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 正例求和 | `python3 scripts/sum_counts.py assets/example_positive.csv` | 0 | `{"total": 3}` |
| 负数拒绝 | `python3 scripts/sum_counts.py assets/example_negative.csv` | 1 | stderr: `error: negative count -1` |
| 缺表头拒绝 | `python3 scripts/sum_counts.py /tmp/no_header.csv` | 1 | stderr: `error: missing 'count' header` |

## 未验证/已知限制

- 仅在当前沙箱Python3运行；未做多版本矩阵测试。
- 未进行大文件性能基准；实现为流式读取。
- 草稿包尚未被管理员导入；当前不可作为技能被调用。
- 未声明第三方依赖；仅使用Python标准库。

## 状态

- 包完整性：已通过工具校验（见artifact_draft返回）。
- 脚本测试：上述三条真实执行通过。
- 启用状态：**未启用**；需管理员从artifact显式导入。
