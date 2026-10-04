# Owned runtime restoration

Original PG ec303ed493c5ab58dda61e63487a29f7dd02aa39c6459b051714bc237f33cb64 / projectwsx-12206c10884603680c38 / postgres /20704 used tmpfs /var/lib/postgresql/data, Mounts=[]; globaldaemon recovery left container exited255 and previous namedDB absent. There was no persistent PG volume; prior data could not be claimed preserved merely by start.

Explicit fullDB restore authorization: start only originalPG container, initialize only repository role DO blocks (0001-kernel-roles.sql;20260902012105_error_logs_admin_read_grant.sql;20260909070000_mcp_credential_execution.sql), no application migrations/seeds. First restore stopped on missing app_diag_ro ACL; preserved full-restore-first-missing-role.log. Original fresh partial DB had5w8t and0otherconnections, never accessed by API. Explicitly authorized one drop/recreate of only this namedDB, then fullrestore --exit-on-error exit0; full-restore.log empty (zero errors). No other DB/project/container changes. Original Redis4f05b01be034d2acbe3fe8408ba9adf0c18ec896dd6cef7220b556bcde470818 sameproject/service21704 started under authorization, PONG. Minio remained stopped, not needed for current four UI cases.

Before-full backup08:37:14, file600 SHA8693e9eea3b9eaef703df6b3be194a40004196c899a19a1436ecca03f8c393c8; before-survey backup600 SHAc000305775e079b8e268de5a429fa836ffbbb6d6fd544e8ba5f19b5f85b71f5b. Originals retained, TOC4815entries valid. All5workspace and8librarytemplate JSON documents exactly equal survey backup;0attachments/0uploadsessions counts equal. Metadata details in restored-survey-metadata.json; no claim about writes after backup time.

- a529a7ac-3740-4b4a-b46f-dfd085fbb775:20questions/7sections, firstsection8blocks/total26;1response, answer43233e54-13af-4e6b-8910-59c602eb7e78 exists, collecting.
- 268f5a71-2510-4881-bf27-f8db642add81:20questions/7sections/0responses, collecting, published startsAt2026-10-04T00:35:48.013Z remains.
- 93750492-a585-4c08-9b01-ceb66960c2fd:21questions/0sections/0responses, draft, report binding absent remains.

Prepared API archive exact5eff031f44eeee9e9bd6f5e6ba11ed4d49ef4eaa, internal workspace dependency links frozen. API-only newPID43447:24705 source freeze-api-5eff031f/apps/api, same private configuration/encryption/model/providers; source-root paths adjusted onlyPWD/NODE_PATH/SKILL_STARTER_PACK_ROOT. /healthz200, auth/login200 and authenticated3Survey GETs200. Session/auth response private600, no tokens/headers/credentials in evidence.

New WebPID32437:25709 exactmainf6879a6101190b666ebe31c9d76ea949bbc11a14, unique frozen archive and dist,124pages/Ready175ms, sourcehash3f8734c1e98b2ced5313c38b0a6f87d18a9ae41392d65ce9ca793e84bbec6d89 unchanged after privateauto include removal. Survey backend/contracts bytes match5eff; other modules differ, not wholeapp sameSHA. Same-origin authenticated proxy GETa529200. OldWebPID56810:25708 retained. Fixture frozen-unbind-login-fixture.json600 sameaccount. Parent owns actual browser acceptance; no UI PASS claimed by runtime restore.

ENOSPC first build log retained; authorized only4retiredownedcache subdirectories cleared, artifact/source/DB/currentWeb/othercache unchanged. Current disk restored capacity documented cache-retirement-record.md. ActiveWTbranch/product/unknownmanifests/QA CSVs unchanged by runtime restoration.
