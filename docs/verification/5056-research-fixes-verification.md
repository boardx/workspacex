# 用户研究验收修复验证

基线 `83462a88ef49d0983fc1f0e02a6ee3190d409f18`，修复 #5057、#5068、#5081；一个汇总 PR，未合并。

- 初始化 `./init.sh`：退出 0（快速基线，未冒充完整全仓验证）。
- 修复前：101/123/200/2000 字创建测试失败；预填 120 字主题派生默认标题测试失败；API 缺少持久章节计数测试失败；真实预览显示旧 1/4 而非最新 3/4。
- 修复后：针对性 web 5 文件 59 条通过（包括乱序 revision/sequence 回退和新报告重置）；研究 API 8 文件 195 条通过；contracts 120 文件 1131 条通过。
- web/API/contracts typecheck 退出 0；web/API lint 退出 0（乱序修复后 web typecheck 与 lint 再次退出 0）。
- web 完整套件限 2 worker：799 文件通过、1 文件失败，6735 条通过、8 条失败、5 条跳过。失败全部位于 `tests/whiteboard/board-content-tools.test.tsx`，涉及跨 realm BufferSource 的 crypto.digest 和后续图片上传断言。固定 SHA main archive 用相同依赖、单 worker 复跑得到相同 8 个失败名字，22 条通过；该领域没有本次代码改动。未修改白板，也未宣称完整套件全绿。
- API 完整默认路径结束：1450 文件中 1432 通过、16 失败、2 跳过；12703 测试通过、49 失败、102 跳过、2 todo。白板 worker 的 ERR_UNKNOWN_FILE_EXTENSION 已在固定 main SHA 归档直接复现；Python 缺少 langmem/pytest，另有迁移锁超时、canvas 三项断言失败。exclusive 1 文件4项通过；固定 main 归档白板 7项失败/0通过复现，canvas 17项通过。canvas、KG conflict-prompt、no-tool-run-writeback 三文件在修复分支单 worker 隔离复跑103项全部通过。完整套件仍未全绿。
- 真实浏览器：163 字需求创建成功，标题 100 字；远程 qwen3.7-plus 将完整需求拆成主题和目标，生成两个章节计划，已开始真实远程检索；后续计数/重试/章节编辑/报告及导出复验进行中。

报告质量与导出分诊：

原验收 #5056 的 9 项检索失败、有限草稿和核心问题覆盖不足是真实提供方/证据结果；章节和引用质量门有可见警告，不移除门控。导出引用剥离由 #4793 (`028da5fa2345bbe9337f3e5d3d73dd3277c179a4`) 明确加入且现有 OOXML/PDF 测试锁定；本轮未找到要求恢复引用的明确新契约。Word 中文字体缺失是配套渲染环境阻塞，不是正文丢失产品缺陷。

真实提供方结果与受控注入测试分列，未测路径不标通过。

独立审核发现迟到进度投影会回退章节计数，已先以两条失败测试复现，再整体拒绝旧 revision 或同请求旧 sequence；提交 `4b78fc9a8` 已获独立 ACCEPT。

真实检索第一次结束：8 项中 2 项成功、6 项失败，保留 4 条真实来源。通过浏览器“继续重试”触发失败任务重试；数据库前后来源 ID 完全一致，两个成功任务均保持 succeeded / attempts=1，失败任务重新执行。

新增 #5081 动态证据：旧章节保存命令实际清空 18 条来源、8 个任务并回到 plan。API 与组件失败测试已复现；专用 save_chapters 命令保留来源/任务，仅失效报告，组件保留章节编辑页。研究前 save 的清空规则保持原有行为，新增问题仍走后续 evidence/quality 管线。真实页面复验正在重新检索，未通过数据库或 API 注入丢失结果。

第二轮独立审核发现 #5081 删除旧章节/新 ID 替换后确认会未经评估删除来源，已 red 复现（2 失败 / 90 通过），修复后 195 条研究测试通过；同一服务测试走 save_chapters→complete，断言经过 source_relevance/evidence/quality。提交 `6cfcea19361983f8e768628ba3300cc0505a2428` 已获独立 ACCEPT。

真实浏览器最终代码复验：原位章节标题/小节保存后 13 条来源、8 项任务逐字段相等；新章节添加、旧章节删除、重排并保存仍在 chapters 页面。确认生成后按当前新 ID 的问题完成真实模型来源重评估（13→10 条相关来源），进入 report/evidence 阶段。真实报告与计数/导出复验仍运行。

标准 pre-push 门禁：20/20 typecheck/lint 任务成功，未跳过 hook，已推送修复分支。

最终浏览器计数：不刷新自动1/2→2/2，数据库与实际progress投影匹配；报告终态两章加综合结论的有限草稿，busy=false、completed=false、report=null。真实导出blocked：Word未取得下载文件；PDF原生打印导致CDP超时且Codex原生app控制被工具禁止。未修改导出策略，未宣称完整验收通过。

收尾 verify:quick 默认并发将本机load推至83，已核对cwd后SIGTERM仅本会话wrapper；退出143，**未通过**。之前限2worker全web及研究定向、契约、类型lint证据仍有效。原main归档失败为固定83462a时点事实，远端后来合入的白板修复不可据此断言当前main仍失败。

证据已整理至 `docs/evidence/research-5056-fixes/acceptance.md`。同一分支由协调者同步main至694d4f6c0；未创建第二worktree。CI待最新head的classifyChecks实际无阻塞/无待跑才可称绿。未合并，#5056保持open。

人类最新调整（主会话2026-10-02）：导出不需要验证，已从本轮完成门禁移除；仍保留未测记录，不写PASS。下一步质量与速度优化分独立issue/PR，不扩大#5087。

8a40e6bf6 CI真实结果：verify-control-plane、verify-full-compile、merge-gate通过；verify-affected 835文件/7001测试通过，仅1个研究旧跳转断言失败（仍要求保存章节后回计划/失效研究）。定向red复现1失败12通过，更新为save_chapters后保留章节、来源、研究路由；全部guided research组件24文件229项通过。fullstack-smoke 101通过1失败1跳过38未运行，唯一失败是whiteboard-live.spec.ts:78等待对象文字；已由公共#5094/PR#5096跟踪，不在研究PR修改白板，等待真实main同步。
