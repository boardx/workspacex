# CI repair for f1ecb4734

The remote runtime job failed on forced replay of workbench_interjections (relation already exists): https://github.com/boardx/workspacex/actions/runs/34077616577/job/101606713600 . The control-plane job failed because /agent-artifacts/threads/:threadId had no Next rewrite: https://github.com/boardx/workspacex/actions/runs/34077616583/job/101606713922 .

Six peer-origin migrations now use idempotent DDL for tables, columns, indexes, the attachment foreign key, policies and journal functions/triggers. Existing rows and public contract semantics are preserved. The missing agent-artifacts rewrite now uses the existing API origin and prefix. No UI or peer main-run control was redesigned.

The first local full replay exposed a further duplicate interjection journal function after fixing the earlier table error; original failure retained. The corrected standard isolated migrate:check command passed: 227 migrations from empty, every file force-replayed, identical schema digest, all files recorded. This count describes the working migration set at verification time, including parallel pending additions; current committed-head CI remains authoritative. The owned database stack was removed. Rewrite coverage passed separately.

A direct peer task message was attempted for this concrete interface/migration conflict, but the desktop tool returned Transport closed. Delivery was not confirmed. These changes require peer reconciliation when task messaging is available.
