# V2 验证结果

运行时代码：`b7256029d1e4eaa34031a085e76ff9c53f109ab7`。验收脚本：`f11304c715eac46588871b3b946a8f61f9e44bce`。后续文档提交不改变已验运行时代码。

| 层级 | 实际执行及结果 |
| --- | --- |
| AIDT Web 回归 | 49文件、481测试通过，无失败；含FR15–19、原生Chat宿主、组件隔离、共享保存、报告、资源与权限作用域 |
| API阶段Skill | 4文件32测试通过；1.3包 build/--check、metadata、shipped version及fixture lint均通过；旧包字节保留 |
| 类型 | `pnpm --filter web typecheck` 与API typecheck退出0 |
| 设计 | `bash apps/web/scripts/lint-design.sh`退出0，包含features；真实Tailwind编译回归通过 |
| 真实本地构建 | 234.970秒退出0；数据库摘要未改变；受控cache-only清理前后构建回执均可用 |
| 原生端到端 | 1例完整流程通过、两次start/stop及新登录逐阶段精确回读，110.062秒，无skip/unexpected/flaky |
| 来源/分支 | S1猜测与理由，S3暂无，S4多标签独立于选择，S5编辑撤确认，S6旧问题固定、未改变/不足/未决定、回1或2无需新版、报告真实保存 |
| 样式 | 桌面标题20px/clip:auto/高28；AI面板absolute且宽448；375px下fixed且高812，位于视口 |
| 清理 | 13端口实际Node独占bind均可用、无LISTEN、无native/output owner及advisory租约；PG保留 |

Web冻结测试的实际选择方式（从仓库根目录，Node22/pnpm9.15）：

```sh
python3 - <<'PY'
from pathlib import Path
import subprocess
files = sorted(str(p).removeprefix('apps/web/') for p in Path('apps/web/tests').rglob('*test.*') if 'aidt' in p.name.lower())
raise SystemExit(subprocess.run(['pnpm', 'exec', 'vitest', 'run', *files], cwd='apps/web').returncode)
PY
pnpm --filter web typecheck
bash apps/web/scripts/lint-design.sh
pnpm --filter web exec vitest run tests/tailwind-features.test.ts tests/lint-design-gate.test.ts
```

实际原生验收使用标准 `with-test-isolation` 获取13租约，`playwright.aidt-local.config.ts`、`AIDT_LOCAL_WEB_MODE=start`，首次明确新build，随后仅在真实构建回执、相同API和源码指纹均通过时复用。专用持久测试目录与真实日常数据分离；重复使用同一测试目录证明停止/重启不删数据。原始命令/结果保留在native目录。本地试用应按 `START-HERE.md`，无需运行该验收。

## 失败也保留

attempt1是共享Next/React依赖包缺文件而失败；按锁定版本官方tarball完整性恢复，无源码或版本变更。attempt2构建成功、浏览器走到第5步，但测试精确label定位有值textarea失败，人工中断，不能计通过。真实Chromium最小DOM反证后，仅改测试为textbox/combobox角色定位并设置30秒动作超时；attempt3重新执行全部断言和双cycle通过，不跳过失败步骤、不篡改回执。

## 未计为完成

本流程没有执行模型生成请求、没有采集真实研究材料，没有生成实际Design原型；原型引用为明确标记的自动化学生纸面示例，用于验证字段、快照和历史。真实Agent执行、生成质量、访谈同意/录音/ASR、30人课堂与macOS/Windows实机仍需验证。共享版本不是原型版本；学生确认不是全组投票、教学完成或证据真实性核验。
