# Collection schedule real-browser acceptance

Source: `5eff031f44eeee9e9bd6f5e6ba11ed4d49ef4eaa`, web25705/API24705. Synthetic survey101e9a36-3fb3-4e50-baa7-28e5ed56f4bb. Browser actions performed through CUA, not API seeding. All times Asia/Shanghai,2026-10-04.

1. Main814 publication page lacks start field (`../main-missing-start.png`). New source shows start/end; no manual publication-check button.
2. Start03:00/end02:59→“截止时间必须晚于开始时间。” and unpublished settings remain. Native datetime input fill followed ArrowUp/Down to commit trusted change.
3. Start02:41/end02:43→publicationv2,“问卷等待开始”. Public page before02:41 says“问卷尚未开始回收，请在开始时间后再来填写。” and has no form (`pre-start.png`).
4. Owner reload retains both timestamps (`frozen-after-reload.png`). Owner without another reload transitions to“正在回收” (`owner-open-without-reload.png`).
5. Public page reload after02:41 exposes the real single multiline question. Submitted synthetic answer and received success (`submitted.png`). Owner responses reload shows one valid response5e24303e-a5fb-4c4b-9b72-2c327d5161a6,02:41:13,8seconds (`response-persisted.png`). Navigation alone initially displayed stale0; refresh fetched1. No extra UI claim for automatic response refresh.
6. After02:43 public page says“问卷已关闭、已过期或题目已锁定。” without form (`public-expired.png`). Owner without reload updates to“问卷已到截止时间” and preserves1response (`owner-expired-without-reload.png`). Initial wait used a different guessed wording and timed out; fresh actual state established the existing wording, not a product failure.

These observations do not replace upload/prestart server, exact boundary milliseconds or independent republish/history assertions: those are separately covered by48realHTTP/DB and50domain regressions. Global558case inventory is not claimed complete. QR not tested.
