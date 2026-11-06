# #6350 修复交接

可信桥原先只有跳转；为语义资料表提供搜索/select筛选、无匹配状态与本地详情预览。打开显示现有行信息，不会伪造真实文件下载。生成器提示约束语义结构；与导出共用srcdoc。

## 独立提交文件

- `apps/web/lib/html-page-srcdoc.ts`
- `apps/web/lib/prototype-table-interactions.ts`
- `apps/web/tests/ui/prototype-table-interactions.test.tsx`
- `apps/api/src/application/design-workbench/html-page-design.ts`
- `docs/evidence/ui-audit-20261107/design-loop/interaction/`（仅本问题证据）

## 验证

`node docs/evidence/ui-audit-20261107/design-loop/interaction/browser-check.cjs`

390/1100px Chromium 实测无匹配、类型筛选、打开关闭；既有 iframe 来源/跳转回归5 passed。

RED 与 GREEN 日志在本目录。真实审计项目由主会话人工复测；未自行提交/推送/创建PR/合并。

## 主会话 review 后返工（以本节覆盖前述实现）

额外精确提交文件：packages/contracts/src/design-html-page.ts、packages/contracts/tests/design-html-page.test.ts。

可信声明协议：table data-prototype-table=docs；input data-prototype-search=docs；select data-prototype-filter=docs data-prototype-column=type；类型列th/td data-prototype-column=type。sanitizer仅保留字母开头、字母数字下划线短横线的64字符以内标识，不接收选择器/脚本。显式控件仅绑定指定表和字段；旧原型只在下拉选项精确对应语义类型列时兼容，不把排序/负责人变成筛选。类型按单元格精确值匹配，不匹配整行文本。搜索保持本地全文匹配。

弹窗约束Tab焦点，防止外部focus逃逸，Escape关闭并回到打开按钮。保留data-goto优先与原postMessage来源检查。

新增RED：field-red.log（名称PDF/类型Word+排序反例）、contract-red.log（声明绑定被过滤）。GREEN：field-green.log 39/39（含交互3、iframe5、HTML导出20、Markdown11），contract-green.log 20/20，浏览器390/1100px实际搜索/筛选/打开关闭继续绿；lint.log定向eslint退出0。

## batch2 类型门返工

主会话全量typecheck暴露 flatMap 将 column 仅推断为string，legacy分支null引起后续unknown级联。仅为flatMap显式标注结果元素类型 `{ select: HTMLSelectElement; column: string | null; index: number }`，不改变运行时逻辑。

单文件语义类型验证（非全量、未与prepush争用）：`pnpm --filter web exec tsc --noEmit --strict --skipLibCheck --target ES2022 --lib ES2022,DOM --types react lib/prototype-table-interactions.ts`，type-red.log退出1复现三处错误，type-green.log退出0；定向交互+iframe回归type-regression.log 8/8通过。全量类型门由主会话统一执行，尚未宣称通过。
