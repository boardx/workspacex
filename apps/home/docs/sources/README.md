# Sources — how a report gets quoted on the site

The demo's scenarios are sample material. A scenario may also show one real
finding — "What the research says" — and that line is held to a stricter rule
than anything else on the page: it must be a sentence found, word for word, in
the report's own file.

## Why this folder exists

The session that built the demo could not open the consultancies' sites (the
environment's network policy blocked mckinsey.com, bcg.com, bain.com,
deloitte.com, pwc.com, kpmg.com, ey.com, accenture.com, gartner.com and
others). What it found through search is in `../demo-personas.md` as
*leads* — none verified, none on the page. This folder is how they become
citations.

## Adding a report (about two minutes each)

1. Download the report yourself, from the firm's own site. Save the PDF (or
   the page, as .html) in `docs/sources/raw/` — that folder is not committed.
2. Find the sentence you want to quote. Copy it exactly as printed.
3. Run:

   ```bash
   pip install pypdf     # once
   python3 scripts/add-source.py docs/sources/raw/<file>.pdf \
     --id mckinsey-state-of-ai-2026 --firm McKinsey \
     --title "The state of AI in 2026: On the road to ROI" \
     --date 2026-08 --url https://www.mckinsey.com/<the page you downloaded from> \
     --quote "<the sentence, exactly>"
   ```

   It finds the sentence in the file and records the page and the file's
   SHA-256 in `index.json`, or prints the closest passage and writes nothing.
4. Put the quote on a scenario in `assets/js/demo.js` (both languages; the
   Chinese one adds `gloss`, the translation):

   ```js
   research: { src: 'mckinsey-state-of-ai-2026', quote: '<same sentence>',
               firm: 'McKinsey', title: '…', date: '2026-08', url: 'https://…', page: 7 },
   ```

   `node scripts/check-citations.mjs` fails if any of it disagrees with the
   register.

If you would rather not do step 3, commit the downloaded files to a branch
(or send them) and name the sentences — the rest is mechanical.

## Registered so far

| Source | Quotes | Scenarios |
|---|---|---|
| Anthropic, *Anthropic Economic Index report: Cadences* (2026-06-26), web page | 3 | Workforce · Frontline expertise · AI-native path |

A web page records no page numbers (`kind: "page"`); a PDF records one per
quote. Every quote carries a note on whom it describes — this one is a survey
of Claude users, skewed toward knowledge workers. Anthropic makes the model
that did the work; whether its research belongs on the page is the owner's
call.

## What to fetch first

The leads in `../demo-personas.md`, in the order they would help most, with
the scenario each would sit beside:

| Priority | Report | Scenario |
|---|---|---|
| 1 | McKinsey, *The state of AI in 2026: On the road to ROI* (PDF) | CEO — AI-native path; CFO — ROI |
| 2 | BCG, *AI at Work* 2026 (and the Oct 2024 press release on scaling value) | Workforce; COO — pilots |
| 3 | KPMG / University of Melbourne, *Trust, attitudes and use of AI* (2025) | General counsel — governance |
| 4 | Bain, *Executive Survey: AI Moves from Pilots to Production* | COO — pilots |
| 5 | PwC, 29th Global CEO Survey (Jan 2026) | CFO — ROI |
| 6 | Microsoft & LinkedIn, *Work Trend Index* 2024 | General counsel — governance; Workforce |
| 7 | McKinsey, *Superagency in the workplace* (Jan 2025) | CEO — AI-native path |
| 8 | Gartner press releases on gen-AI projects abandoned after proof of concept | COO — pilots |
