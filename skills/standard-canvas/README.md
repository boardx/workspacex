# W11 画布方法包

WX-S012 diagram-and-canvas，复用现有版本化画布源码与 Mermaid/Fabric 领域。仅既有画布读取和 replace-source 更新；没有新增绘图引擎、画布创建、浏览器渲染、图片/PDF导出或实时协作能力。

构建 `pnpm exec tsx skills/standard-canvas/scripts/build.ts`；验证 `pnpm exec tsx skills/standard-canvas/scripts/verify.ts`。

分发文件 `skills/starter-packs/standard-canvas/1.0.0.json`，部署须配置 `SKILL_STARTER_PACK_ROOT` 并走既有导入与固定版本装配。真实 starter-source 字节/digest 验证不等于已部署所有用户，也不等于已通过真实模型 G-SKILL 或视觉渲染验收。
