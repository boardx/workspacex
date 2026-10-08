# W19 标准研究方法包

WX-S010 interview-synthesis、WX-S019 user-research-planning、WX-S021 maau-canvas（MAAU 模板）与 WX-S023 design-methods（设计方法卡片库）的可导入包源。SKILL.md 与 references 是编辑源；部署manifest由 scripts/build.ts生成。

```sh
node --import tsx skills/standard-methods/scripts/build.ts
node --import tsx skills/standard-methods/scripts/verify.ts
```

复用现有 FileSkillStarterPackSource 和 verifySkillStarterPack，不新增引擎。部署者需将 skills/starter-packs 配置为 SKILL_STARTER_PACK_ROOT 后，走既有受权导入流程选择 standard-methods / 1.5.3。未配置 root 不会自动出现候选包；本提交不表示已部署、已导入或全部终端用户已可用。

工具名称来自标准 catalog；方法明确区分计划中的标准工具和当前可调用列表。无组织资料读取权限/接口时只处理已提供材料；无转录接口时不伪造文本；无生成发布链时只交付对话草稿。maau-canvas 的 A3 信息图依赖沙箱 write_file/execute、隔离预览 browser_navigate/browser_take_screenshot 与 wx_artifact_publish；任一段不可用时按 SKILL.md 的降级逐级交付（HTML → 截图 → 仅文字画布 + mermaid 围栏），不伪造下载链接。④ 的活动图在聊天里由既有 mermaid 渲染出图，在 A3 单文件里是同构的内联 SVG——隔离预览的 CSP 不放行外部脚本、页面上限 2MB，mermaid.min.js（3.5MB）进不去。原始访谈身份关联和人口属性未知时不推断。design-methods 为本项目自有的组织方式与自写说明（不以任何书籍为底本；商标化框架名改用通用叫法，verify.ts 机械拦截回潮），卡片按 Double Diamond 阶段拆成四份 references，入口只让模型读 method-index.md 与所选编号所在的那一份；verify.ts 断言索引里每个编号恰有一张卡、卡片间引用无悬空编号。references/templates.md 是通用方法的可执行模板：canvas 骨架由 verify.ts 用 `@repo/fabric-markdown/templates` 的真实注册表逐字核对 key、表头字段与分区名，mermaid 骨架用 web 侧 `resolveDiagramType` 核对渲染白名单；有明确权利人的画布模板不在允许名单内。design-methods 1.1.1（issue #4613）：真实模型测试发现有 canvas 模板的 10 个方法（M4-16/M4-21/M5-03/M4-22/M4-24/M2-10/M1-15/M1-17/M7-14/M6-07），其卡片「产出」仍写着「可用 markdown 表格或 mermaid 交付」，模型据此绕过了画布——已把这 10 张卡的「产出」改成直接指向 templates.md 的对应 T 编号，不再留旁路。design-methods 1.1.2（同 issue #4613 复测）：1.1.1 上线后再跑真实模型，模型仍然交付了 mermaid `journey` + 表格而不是 canvas——根因是 SKILL.md「能力检查」段落自己把 journey 列进 mermaid 白名单，这段比卡片更早读到、更笼统，盖过了卡片里的具体指向。1.1.2 在「能力检查」与工作步骤 5 里各加一条禁止性规则：这 10 个方法必须用 canvas，即使白名单里有同名 mermaid 图类型也不能代替。

来源：复用 WorkspaceX Studio/Research 既有研究/访谈资料流程与 guided research 规划职责；方法文字为本项目编写，无复制外部技能正文。此包验收验证分发与内容完整性，不代表真实模型行为评测通过。

interview-synthesis 1.1.0：以已有资料为事实基础，默认交付正式的摘要、主题分析、综合结论和改进建议。用户已认证的信息不再附带待验证、待确认或真实性免责声明；来源账本只用于内部整理，原始回答与审计附录不进入默认报告。standard-methods 1.5.3 打包这一更新，其余三个 skill 保持原版本内容。
