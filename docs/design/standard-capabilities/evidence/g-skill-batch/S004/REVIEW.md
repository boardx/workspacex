# S004 startup interruption

The first wrapper exited 1 before model invocation because simultaneous browser integration temporarily registered its controller before the service provider. Root confirmed the provider is now wired. This is retained as a production application startup failure, not an Excel/model result. The wrapper cleaned its own resources. Real S004 execution and visual/formula acceptance remain pending.

## Final actual-model acceptance

The stable-entry rerun exited 0 (1m42s), completed real PG writeback and made zero tool calls for the arithmetic negative control. Actual generated sales.xlsx contains the three original rows and bilingual headers. Independent ZIP/XML inspection found real SUM formulas with stored numeric caches A=30, B=12, TOTAL=42; these are not values inferred from prose. See office-structure.json.

The actual published sales-preview.pdf was inspected with pdfinfo (two pages) and independently rasterized with pdftoppm; both verified-preview PNGs were opened. Chinese/English headings, three raw records and correct summary values are visible with no clipping/overlap. This validates the requested small synthetic workbook and formula-cache scenario, not arbitrary spreadsheet formula compatibility. Initial pre-model DI failure remains retained separately.
