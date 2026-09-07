# JSON artifact delivery delta

WX-T020 now accepts `application/json` only with matching `.json` workspace path/title and strict UTF-8 JSON syntax. The existing run authority, bounded sandbox read, object collection, idempotency receipt and final attachment/artifact-version writeback are unchanged. This supports structured analysis outputs and W15 draft packages as inert downloadable data; it does not execute or publish a Skill.

Verification: `native-output-staging.test.ts` 4/4 plus `native-output-staging-real-db.test.ts` 1/1. The real database test stages text and JSON, reads stored bytes back, repeats staging and final writeback, then verifies exactly two attachments and two versions. Python artifact transport regression passed 5/5 after generating its schema from the shared TypeScript source. Shared raw API output is `json-staging-document-seed.txt` (also contains two separate platform package tests).
