# W19 标准研究方法包

WX-S010 interview-synthesis、WX-S019 user-research-planning 与 WX-S021 maau-canvas（MAAU 模板）的可导入包源。SKILL.md 与 references 是编辑源；部署manifest由 scripts/build.ts生成。

```sh
node --import tsx skills/standard-methods/scripts/build.ts
node --import tsx skills/standard-methods/scripts/verify.ts
```

复用现有 FileSkillStarterPackSource 和 verifySkillStarterPack，不新增引擎。部署者需将 skills/starter-packs 配置为 SKILL_STARTER_PACK_ROOT 后，走既有受权导入流程选择 standard-methods / 1.3.0。未配置 root 不会自动出现候选包；本提交不表示已部署、已导入或全部终端用户已可用。

工具名称来自标准 catalog；方法明确区分计划中的标准工具和当前可调用列表。无组织资料读取权限/接口时只处理已提供材料；无转录接口时不伪造文本；无生成发布链时只交付对话草稿。maau-canvas 的 A3 信息图依赖沙箱 write_file/execute、隔离预览 browser_navigate/browser_take_screenshot 与 wx_artifact_publish；任一段不可用时按 SKILL.md 的降级逐级交付（HTML → 截图 → 仅文字画布 + mermaid 围栏），不伪造下载链接。④ 的活动图在聊天里由既有 mermaid 渲染出图，在 A3 单文件里是同构的内联 SVG——隔离预览的 CSP 不放行外部脚本、页面上限 2MB，mermaid.min.js（3.5MB）进不去。原始访谈身份关联和人口属性未知时不推断。

来源：复用 WorkspaceX Studio/Research 既有研究/访谈资料流程与 guided research 规划职责；方法文字为本项目编写，无复制外部技能正文。此包验收验证分发与内容完整性，不代表真实模型行为评测通过。
