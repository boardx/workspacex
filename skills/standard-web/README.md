# WX-S002 web-research 完整包

`node --import tsx skills/standard-web/scripts/build.ts` 生成现有starter格式；`node --import tsx skills/standard-web/scripts/verify.ts` 用真实 FileSkillStarterPackSource 核对分发、全文件内容和摘要。部署者需要设置 SKILL_STARTER_PACK_ROOT 指向 skills/starter-packs，经既有受授权导入选择 standard-web / 1.0.0。本分支不代表已部署或全部用户已导入。

基于官方 Deep Agents 固定版本方法适配，含SKILL.md、两份reference及MIT许可证。方法适应当前无工具子代理和真实web工具限制；不新增引擎。用户文件交付只承诺实际回执。

验收边界：工具实际整链另见 W06 证据。此包加载、哈希和反证验证不能当作真实模型 G-SKILL 质量门通过；在专属真实模型lane运行前保持该边界未验收。
