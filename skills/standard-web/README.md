# WX-S002 / WX-S013 standard-web 完整包

`node --import tsx skills/standard-web/scripts/build.ts` 生成 `standard-web / 1.1.0` starter；`node --import tsx skills/standard-web/scripts/verify.ts` 用真实 FileSkillStarterPackSource 核对两个 skill 的分发、全文件内容和摘要。部署者需要设置 SKILL_STARTER_PACK_ROOT 指向 skills/starter-packs，经既有受授权导入选择该版本。本分支不修改共享生产 seed 接线，不代表已部署或全部用户已导入。

`web-research` 基于官方 Deep Agents 固定版本；`web-artifact` 基于 Anthropic 固定提交的方法适配。每项含 SKILL.md、两份 reference 及对应许可证；不新增浏览器、部署或产物引擎。用户文件交付只承诺实际回执。

验收边界：工具实际整链另见 W06 证据。此包加载、哈希和反证验证不能当作真实模型 G-SKILL 质量门通过；在专属真实模型lane运行前保持该边界未验收。
