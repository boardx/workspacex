# #5056 可复核的历史证据边界

历史样本：2026-10-02，记录的版本为 6f76967db950f217f6155c62c3c33290ca5eb23c。此记录不验证当前 main/devapp，也不关闭 #5056。

原始浏览器截图、运行时全文和导出文件因隐私筛选未入库；original-manifest.json 中 retained=false 的原件校验和不能证明其内容或操作结果。此前引用这些归档文件的首页、创建、导入、自动保存、刷新、检索操作、报告流式、Word/PDF 导出及性能 PASS/FAIL 结论均不作为本仓库可复核的验收结论。

## 仅由保留文件支持的观察

- 36-final-quality.json：记录的 publicationReadiness.status 为 limited，阻塞项为“核心问题覆盖不足”；这份样本不支持正式报告质量通过。
- 28-lightweight-progress.json：记录 responseBytes=2854 及响应字段清单。这是保留的响应元数据，不证明 UI 操作成功、完整检索结果或当前服务性能。
- 30-saved-count-before-refresh.png：保留单张应用截图。没有对应刷新后截图及完整后端时间序列，不判定刷新恢复或实时计数已通过。
- 11/14/35 的 summary.json 仅保留筛选后的机器状态字段，不能还原未保留的模型正文、来源全文或浏览器交互。
- 38-cleanup.txt 是历史资源清理记录，不证明当前资源状态。

## 尚未可复核

真实模型/搜索调用、所有浏览器操作、导出正文及逐页视觉检查、完整质量/性能验收均需要新的可审阅证据。历史原件清单与本次整理文件的校验分开：original-manifest.json 保留原件身份，curated-manifest.json 校验当前提交的整理内容。未恢复被排除的第三方正文或浏览器标签资料。
