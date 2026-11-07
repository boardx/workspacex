# #6346 修复交接

html2canvas 无法读取 opaque iframe；独立禁脚本 same-origin 渲染复用 srcdoc，live sandbox 不变。CSP 阻止外部资源，只允许内联样式/data图片字体。

## 独立提交文件

- `apps/web/components/design-loop/prototype-export.tsx`
- `apps/web/lib/prototype-png-export.ts`
- `apps/web/tests/ui/prototype-png-export.test.tsx`
- `docs/evidence/ui-audit-20261107/design-loop/png/`（仅本问题证据）

## 验证

`node docs/evidence/ui-audit-20261107/design-loop/png/browser-check.cjs`

390/1100px Chromium + real html2canvas；像素非空断言及 PNG 留存。单测1 passed。

RED 与 GREEN 日志在本目录。真实审计项目由主会话人工复测；未自行提交/推送/创建PR/合并。
