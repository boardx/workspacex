# 验收口径 · Skill 双模型收敛

规范以 [`contract.md`](./contract.md) 为准。验收口径**取决于人类在 §1 选定的方向**——三个选项的
验收断言不同，以下按选项分列；requirement-author 只把**选中那一节**改写进 `feature_list.json`，
未选中的两节仅留作记录，不生成 F-number。

## 若选 选项 1（B 废弃，搬进 A）

- **V1**：迁移后，`skill_contracts` 存量记录在 `skill_versions`/`skill_version_files` 里有对应行，
  内容可追溯（`prompt_template` → 渲染后的 `SKILL.md` 正文，`input_schema`/`output_schema` 落在
  约定的附加位置）。
- **V2**：迁移后创建的新 skill（无论走哪个入口）运行时（`readPinnedSkills`）都能读到。
- **V3**：`getSkillDetail` 契约签名变更已同步到 `packages/contracts/src/skills.ts` 与所有依赖它的
  前端调用点，无遗留调用旧签名的代码。
- **V4**：D08（`SkillStatus` 五态 vs 四态）已由人类另行裁决并落地，不在本 delta 内自行决定。
- **反证**：任意一条存量 B 记录在迁移后从运行时或详情页"消失"（既不可读也不可查），判失败。

## 若选 选项 2（A 为唯一权威，B 冻结只读）

- **V1**：`POST /skills`（`createSkillDraft`）不再可从前端触发新建——`skill-catalog-live.tsx`
  "完全新建"面板已移除或改为跳转到 A 的编辑器工作流。
- **V2**：契约层 `createSkillDraft` 标记废弃（不是删除——存量调用方/测试仍需知道它存在过），
  `SKILLS_FORBIDDEN_ROUTES` 或等价机制阻止新写入路径悄悄复活。
- **V3**：存量 `skill_contracts`/`skill_contract_versions` 行经 `GET /skills/:skillId` 仍可只读查看
  （不删数据、不 404 化存量）。
- **V4**：`GET /skills` 合并读行为不变（`listAll` 逻辑不用改，A/B 混合列表继续工作）。
- **反证**：冻结后若发现仍有路径能写入 `skill_contracts`（遗漏的 controller/直连 db 脚本），判失败——
  必须是**唯一入口**被摘、不是"前端按钮藏起来但接口还在"。

## 若选 选项 3（保留双模型，补编译桥）

- **V1**：`createSkillDraft` 发布一条新 skill 契约后，同一事务或后续可观测的短窗口内，
  `skill_versions`/`skill_version_files` 出现对应的编译产物（可追溯回同一个 `skill_contracts.id`）。
- **V2**：编译产物运行时可读（`readPinnedSkills` 能找到并正确拼进 system prompt）。
- **V3**：`getSkillDetail` 补齐后，对 B 编译出的 A 行也能返回详情（不再 404 绕行）。
- **V4（同步一致性反证，选这条路径必须有）**：构造 B 侧 `prompt_template` 更新后
  （新版本发布），编译产物同步更新，两侧不漂移；断言若只改一侧、不跑同步，测试判红——
  这条防的正是 AGENTS.md 警告的"同一事实两处、后续悄悄分叉"。
- **反证**：编译桥失败时（比如渲染 `SKILL.md` 出错），`createSkillDraft` 本身应如实报错还是仅记录
  降级，需要在实现前由人类一并确认（本 delta 不预设）。

## 通用（不论选哪个方向都要满足）

- **VG1**：不破坏 F595 已落地的导入/目录/编辑/试跑路径（全部读写模型 A，本 delta 不改这部分）。
- **VG2**：`capability_listings` 目录投影行为不变（后台"Skill 目录"页继续正常工作）。
- **VG3**：现有测试套件（`skill-contract-crud.test.ts`、`skill-review-gate.test.ts`、
  `list-skills-includes-wave2-imports.test.ts` 等）按选中方向更新后全部通过，不允许跳过或删除
  测试来让红变绿。
