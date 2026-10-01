# HTML 设计工作台接手进展

源 Claude SHA e6c774512d；已并入 origin/main d8698362be。任务 issue #4902。

已修复：导出 iframe 跳转消息桥；局部 CSS 范围及畸形选择器/特殊闭合 style 防护；HTML 改动后的元素焦点失效；元素编辑失败禁止扩大为整页重写；局部编辑提示词移除整页根容器要求；真实 API 项目响应包含 frameLinks；HTML 恢复版本时由 data-goto 重建导航。

验证：契约 77 条、API 应用/生命周期 170 条、前端 297 条通过；三包类型检查与 Web/API 完整 lint 通过；init.sh 标准快速路径通过。浏览器夹具只证明前端操作、安全桥、375px、scope和离线HTML；真实 DashScope + Web + API + PGlite 另有独立证据，生成/局部修改/刷新/撤销/预览/下载跳转/375px，真实链路8项已通过。

没有修改 feature_list status，尚不声称 passing/已合入主线。后续 PR 的检查状态按 classifyChecks 判定。
# 用户追加：Claude Design skill

已核对 Anthropic 官方 frontend-design 与仓库同名 skill。HTML 链路加入 brief.review（受众、主要任务、视觉理由与去套路复核），逐页实际携带；用户明确的视觉方向优先。补充语义控件、键盘焦点、减少动画、真实窄屏重排、核心文字完整显示和数据几何一致性的生成约束。

以另一个真实模型桌面咖啡排班项目走查。首轮网格行零宽、首修文字裁切、低对比度和时间轴业务语义错误均作为失败保留，经真实 UI 整页修订而非手工注入成品；最终结论与浏览器测量见 fullstack-skill/。此处截图走查是交付验收流程，生产运行时没有新增自动截图模型循环。
