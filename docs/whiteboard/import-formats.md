# Whiteboard import formats and evidence boundary

The importer accepts bounded JSON, text CSV and ZIP packages. It does not decode Miro RTB backups or contact either vendor API. API credentials and remote image URLs are never fetched by this importer.

## Miro REST v2 JSON

Supply a complete `{data:[...]}` response (or assembled `{items:[...],connectors:[...]}` package). A response with a next-page link/cursor is rejected: collect all pages first and remove pagination metadata only after assembling them. Connectors come from their separate source API and must be included to preserve relationships. An items-only response cannot prove a complete board export.

The adapter reads `data.content`/`data.title`/`data.shape`, `geometry`, `position`, `parent`, and connector `startItem`/`endItem` references where supplied. Center-origin positions become canonical top-left geometry. Parent-top-left coordinates are resolved after all source items are read. Missing relative parents, cyclic references, unsupported relative origins and rotated relative containers are rejected rather than guessed.

Rich text is converted to plain text with a downgrade report. Unsupported typography, routing and arrow styles are reported. An image must have a matching local asset path in a ZIP package; API image URLs alone cannot import image bytes. Unsupported objects remain visible in the loss report.

Sources: [REST v1/v2 comparison](https://developers.miro.com/docs/rest-api-comparison-guide), [position and parent coordinate semantics](https://developers.miro.com/reference/create-image-item-using-local-file).

## CSV

CSV with explicit `type`/`kind`/`widgetType` and geometry columns uses the existing normalized adapter. Other CSV is treated as text-only: every nonempty row, including the first row, becomes a text object in a new grid. No vendor header is guessed. Cells are joined with a separator; quoted multiline text is preserved. Every row reports that original geometry, types and relationships are unavailable. Miro's official CSV is a text export, not a full-fidelity board backup: [export documentation](https://help.miro.com/hc/en-us/articles/360017572754-How-to-export-your-board).

## Mural public REST v1

Users with an OAuth token containing `murals:read` can retrieve
`GET https://app.mural.co/api/public/v1/murals/{muralId}/widgets`.
The official paginated response is `{value:[widgets],next?:token}`. Follow `next` with unchanged filters/limit until the field is absent, then concatenate the `value` arrays into one complete `{value:[...]}` JSON file. Do not upload only the final page. A file still containing `next` is rejected. The endpoint explicitly excludes drawings; an API collection therefore cannot reproduce drawings absent from its response.

The adapter reads the actual REST discriminator types: area, arrow, sticky note, shape, text and image; comments, files, icons and other unsupported records receive individual skipped outcomes. `htmlText` takes priority over `text` and is flattened with a loss report. `x/y` are top-left coordinates relative to `parentId`; nested areas are resolved to canonical world coordinates. `stackingOrder` is preserved. Eight-digit RGBA fills retain RGB; nonopaque alpha is reported as a loss. Arrow `startRefId`/`endRefId` become endpoint references and `label.labels[].text` becomes a multiline canonical label; routing and label positioning are reported as normalized. Missing endpoints fail individually. Hidden/invisible widgets and their descendants are skipped rather than exposing restricted content on a visible canonical object.

Image REST responses supply expiring `url` values (possibly null when download is restricted), not embedded bytes. The importer does not fetch these URLs. To import images, obtain authorized original bytes while available and package them in ZIP with explicit per-widget `assetPath`; missing bytes fail that image with ASSET_MISSING. Local image assets pass the existing decoding, path, expansion and digest validation. No arbitrary URL-fetching backend is introduced.

The legacy normalized items/widgets representation remains accepted. Public-schema tests are not captured real-user exports; three actual migration boards and visual acceptance are still pending.

Official sources checked 2026-09-27:
- [Get widgets](https://developers.mural.co/public/reference/getmuralwidgets): its embedded public OpenAPI `document.api.schema` defines `PaginatedList`, `Widget` and the concrete widget schemas.
- [Pagination](https://developers.mural.co/public/docs/pagination).
- [Shape text and parent-relative geometry](https://developers.mural.co/public/reference/updateshapewidget).
- [Arrow references](https://developers.mural.co/public/reference/createarrow).
- [Image fields](https://developers.mural.co/public/reference/createimage); the GET schema additionally defines expiring `url` and cropping `mask`.


## Atomicity and retries

`WHITEBOARD_IMPORT_LIMITS.objects` is the single capacity source. Oversized imports reject the entire batch and report discovered/unsupported counts and an OBJECT_LIMIT issue; no canonical objects or image assets are created. No partial success is represented. Retrying the same file/source in the same open panel reuses upload/preflight/execute IDs and the original expected epoch after network failure. Closing the panel loses this local attempt; cross-session resumability is not implemented.

## Verification boundary

Parser and mapping tests are executable contract examples derived from public documentation, not captured vendor exports. Existing synthetic brainstorm/diagram/workshop fixtures do not prove three real migration boards. Real fullstack migration, image loading, peer refresh and standard-export/reimport equivalence remain acceptance work. The legacy standard JSON export has no media; use the separate portable-bundle API for canonical objects plus images.

## Portable canonical roundtrip

The separate versioned canonical+image package is documented in [portable-bundle.md](portable-bundle.md). It is not a vendor decoder and does not make Miro/Mural conversions lossless. The captured-source inventory, diagnostic fixtures and real-stack acceptance producer are tracked in [vendor-migration-evidence.md](vendor-migration-evidence.md); three real-account source boards remain unverified.
