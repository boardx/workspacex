# WX-S002 / WX-S013 standard-web 完整包

`node --import tsx skills/standard-web/scripts/build-candidate.ts` 生成候选 `standard-web / 1.1.3` starter；`node --import tsx skills/standard-web/scripts/verify-candidate.ts` 用真实 FileSkillStarterPackSource 核对两个 skill 的分发、全文件内容和摘要。部署者需要设置 SKILL_STARTER_PACK_ROOT 指向独立候选目录 skills/standard-web/candidates/1.1.3/starter-packs，经既有受授权导入选择该版本。本分支不修改共享生产 seed 接线，不代表已部署或全部用户已导入。

`web-research` 基于官方 Deep Agents 固定版本；`web-artifact` 基于 Anthropic 固定提交的方法适配。每项含 SKILL.md、reference 与对应许可证；web-artifact 另带从唯一 frontend-design 来源按字节生成的原文及许可证；不新增浏览器、部署或产物引擎。用户文件交付只承诺实际回执。

验收边界：工具实际整链另见 W06 证据。此包加载、哈希和反证验证不能当作真实模型 G-SKILL 质量门通过；在专属真实模型lane运行前保持该边界未验收。

1.1.2 保留旧 starter 文件不可变，仅提升 web-artifact 1.0.2：明确 HTML 下载 MIME，以及未执行负向探针、未视觉查看、未发布的准确状态。既有 1.1.1 部署不自动漂移；新版本须经原导入治理。

1.1.3 候选将 web-artifact 提升为 1.0.3，补齐构建前设计指引与视觉证据记录，并纠正旧版 upstream 声明。frontend-design 原文在打包时投影，不另存可编辑判据。旧 1.1.2 包不可变。候选包的文件/摘要验证不等于真实模型 G-SKILL；须运行 S013 真实模型 + 实际浏览器/截图验收后才可推广，本改动不改变共享生产 seed 或自动升级已导入版本。

候选源码独立保存在 `candidates/1.1.3/web-artifact/`；标准发货 builder、源码与 seed 保持 1.1.2 同一版本。候选与发货均须逐字节验证，不改变现有发货门禁。
