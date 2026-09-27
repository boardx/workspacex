# Whiteboard import formats and evidence boundary

The importer accepts bounded JSON, text CSV and ZIP packages. It does not decode Miro RTB backups or contact either vendor API. API credentials and remote image URLs are never fetched by this importer.

## Miro REST v2 JSON

Supply a complete `{data:[...]}` response (or assembled `{items:[...],connectors:[...]}` package). A response with a next-page link/cursor is rejected: collect all pages first and remove pagination metadata only after assembling them. Connectors come from their separate source API and must be included to preserve relationships. An items-only response cannot prove a complete board export.

The adapter reads `data.content`/`data.title`/`data.shape`, `geometry`, `position`, `parent`, and connector `startItem`/`endItem` references where supplied. Center-origin positions become canonical top-left geometry. Parent-top-left coordinates are resolved after all source items are read. Missing relative parents, cyclic references, unsupported relative origins and rotated relative containers are rejected rather than guessed.

Rich text is converted to plain text with a downgrade report. Unsupported typography, routing and arrow styles are reported. An image must have a matching local asset path in a ZIP package; API image URLs alone cannot import image bytes. Unsupported objects remain visible in the loss report.

Sources: [REST v1/v2 comparison](https://developers.miro.com/docs/rest-api-comparison-guide), [position and parent coordinate semantics](https://developers.miro.com/reference/create-image-item-using-local-file).

## CSV

CSV with explicit `type`/`kind`/`widgetType` and geometry columns uses the existing normalized adapter. Other CSV is treated as text-only: every nonempty row, including the first row, becomes a text object in a new grid. No vendor header is guessed. Cells are joined with a separator; quoted multiline text is preserved. Every row reports that original geometry, types and relationships are unavailable. Miro's official CSV is a text export, not a full-fidelity board backup: [export documentation](https://help.miro.com/hc/en-us/articles/360017572754-How-to-export-your-board).

## Mural and normalized packages

Mural currently accepts the documented-in-code normalized items/widgets representation (id, type, x/y, width/height, text, parentId, fromId/toId, assetPath). This is not a claim of compatibility with every Mural native export or API revision. Real anonymized vendor board packages are still required for acceptance. ZIP assets must pass existing path, expansion, magic, decoding and digest checks.

## Atomicity and retries

`WHITEBOARD_IMPORT_LIMITS.objects` is the single capacity source. Oversized imports reject the entire batch and report discovered/unsupported counts and an OBJECT_LIMIT issue; no canonical objects or image assets are created. No partial success is represented. Retrying the same file/source in the same open panel reuses upload/preflight/execute IDs and the original expected epoch after network failure. Closing the panel loses this local attempt; cross-session resumability is not implemented.

## Verification boundary

Parser and mapping tests are executable contract examples derived from public documentation, not captured vendor exports. Existing synthetic brainstorm/diagram/workshop fixtures do not prove three real migration boards. Real fullstack migration, image loading, peer refresh and standard-export/reimport equivalence remain acceptance work. Native canonical export is currently not a portable image bundle and is not advertised as lossless reimport.
