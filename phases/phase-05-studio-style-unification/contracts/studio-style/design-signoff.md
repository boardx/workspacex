---
status: confirmed
covers: [F01]
confirmed_by: "qq13613030605"
confirmed_at: "2026-08-15T08:20:00+08:00"
---

# Studio Style Design Sign-off

## 1. UI

Unify `/research`, `/itv`, and `/rec` list homes and their create name/tag dialogs with the deployed Transcription visual system. Preserve all routes, create behavior, filters, and detail flows.

## 2. Use Cases

Users can open each list home, filter existing content, open its create dialog, enter a name and up to five tags, and either cancel or continue through the existing creation workflow. Loading, empty, error, keyboard-focus, and narrow viewport states remain usable.

## 3. API Contract

No API operations, request fields, response fields, error codes, or persistence rules change. The work consumes existing Research, Interview, and Transcription contracts only.

## Human Confirmation

Change `status` to `confirmed` and fill `confirmed_by` and `confirmed_at` after reviewing all materials in this bundle.
