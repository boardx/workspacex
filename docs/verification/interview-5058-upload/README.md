# First research attachment from blank intake (#5058)

Base main:83462a88ef49d0983fc1f0e02a6ee3190d409f18. Before fix UI regression failed (blank editor vs imported text;1 failed/8 passed), same Markdown cannot be blank error as original browser evidence in #5058.

After fix targeted intake/create suite13/13 passed. Real IAB first file upload from empty intake succeeded through real API/storage/PGlite;268 characters saved, version2, refresh retained text. Test interview itv-2dc751ed-5c1d-4acf-8bb6-e7efa75001c5. DB attachments1. Confirm advances to real DashScope analysis without replacing identity. No mock HTTP/model used for browser verification. All data synthetic.

The UI skips saving only blank local text before attachment transaction. Nonempty edits still save before append; standalone create behavior unchanged.
