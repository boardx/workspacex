# Report filename and presentation — issue 5827

## Changes and scope

- New jobs freeze a safe canonical report-title filename for both PDF and DOCX. Workspace paths remain stable; the host publication policy binds the real filename. UTF-8 filename* and the client Blob download use the verified file metadata. Paths/control characters/bidi controls and reserved names are sanitized; UTF-8 length is bounded without splitting a character.
- The uploaded report input no longer appends “文件生成披露” or automatic status/hash notices. Canonical report prose, its own evidence limitations/simulation markers and authorized source appendix remain unchanged. Server authorization, immutable version/hash binding, review metadata and content validation remain; metadata is not forged by document prose.
- The render-policy namespace changes the cache signature so old-format files are not reused. A client holding an obsolete successful job drops it only after the server confirms REPORT_CHANGED; transient storage errors retain it.
- The existing immutable pdf-create package now includes scripts/pdf-text-layout.cjs. Its actual embedded-font width measurements wrap Chinese, mixed text and unbroken English, return the next body position and paginate. Skill guidance and the report request require this method, complete titles and page margins; no new exporter or model lane was introduced.

## Verification

- Report/presentation/content unit tests: 51 PASS with the actual sandbox CJK font; ordinary CI explicitly skips that one opt-in font fixture rather than claiming CJK verification without the font.
- Actual CJK, English and mixed-title PDFs created by the exact packaged helper, each rendered with bundled Poppler; all three complete pages inspected. Every measured line is within the 495pt content width on a 595pt page; title characters retained exactly and body moved below the title. Separate oversized-title test exercises pagination. Images title-1/2/3.png accompany this record. Poppler emitted font-type warnings, but the rendered glyphs inspected were legible with no title clipping or overlaps. These are deterministic recipe fixtures, NOT fresh model-generated exports.
- Real PostgreSQL/immutable Skill package tests: 12 PASS, including publication/writeback retaining the title filename, permissions/CAS and conditional fifth PDF resource; DOCX/PPTX/XLSX still each have four resources, while PDF gains its measured-layout helper. Owned isolated stack cleanup completed.
- Browser: 2 PASS, real authenticated report/source/version regression plus controlled completed-job PDF/DOCX responses whose actual downloaded suggested filenames and byte hashes are checked. The latter deliberately isolates the browser delivery logic; it does not prove native model generation.
- UI: 10 PASS, including invalidated render-policy recovery and transient failure behavior.
- API/web typechecks, API lint and source-release package-resource verification passed.

## Boundaries

No additional real model calls, no customer report mutation, no deployment or merge. Font bytes were copied read-only from the existing sandbox image through a never-started temporary container, which was removed; no font installation. Actual recipe PDFs remain under /tmp/wsx-5827-layout, not substituted for user reports. There is no fresh native-model end-to-end acceptance in this iteration. The tests prove the packaged wrapping implementation and data/download contracts; they do not prove every future model script follows the Skill instructions.

Lesson: download filenames belong to the frozen publication contract, not an internal workspace basename; visible export rules must be versioned in the cache signature, and final body validation must distinguish canonical evidence limitations from pipeline-added metadata.

Review follow-up: four metadata-without-heading counterexamples failed before the fix and now pass. Final validation rejects noncanonical known notices, the server report hash, and version/review-status lines even without the disclosure heading, while allowing the same text when it belongs to canonical prose. Existing content fixtures no longer rely on injected notices.
