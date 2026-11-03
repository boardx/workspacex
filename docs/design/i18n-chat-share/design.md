# Public chat sharing — #6176

Independent develop dec5223e5; scope owner dialog, anonymous page, role/attachment wrappers and page metadata. Existing I18nProvider and LanguageSwitcher provide locale; no new preference store. Anonymous page gains the same accessible switcher because it has no authenticated shell.

Presentation uses typed chatShare namespace. Owner error state stores stable message keys and translates at render time. Read adapter retains its default Chinese Error.message compatibility while adding a stable missing/unavailable code; anonymous component stores only a known message key and masks malformed/network failures. No locale in request effects or context keys.

Snapshot title, message Markdown, filenames, immutable raster data, thread/share IDs, revision/token and URLs stay exact. Author role labels and surrounding private-attachment text translate. Created-link timestamps use display locale without changing stored timestamps. Server metadata reads the canonical locale cookie and retains noindex/referrer settings.

Validation contract: four provider tests first fail, then pass with existing share lifecycle/security cases and dictionary parity. Real seeded owner publishes, second tab changes locale without publishing or replacing generated input, anonymous contexts retain raw messages, omit credentials, reload English metadata, and real revoke returns404 whose error retranslates. No mock response is counted as persistence proof. CI's existing unconditional chat-public-share.spec registration remains.

Visual QA scope correction: ChatCodeFence is rendered inside the shared snapshot and its controls are product UI, so it is included. A separate canonical codeFence namespace supplies copied/failed/copy, show/hide and pluralized line count. Other consumers keep the default Chinese when no locale provider is installed; English consumers now use the global locale. Copy callbacks/timers/latest-call ownership and manual/streaming disclosure state are unchanged.
