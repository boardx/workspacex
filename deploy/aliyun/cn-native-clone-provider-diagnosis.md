# Native clone provider diagnosis — draft, not sent

Recipient proposed: Alibaba Cloud RDS technical support through the official Alibaba Cloud app > My > Service Center > Ticket Service > Submit Ticket, product category RDS. Official entry instructions: https://help.aliyun.com/en/document_detail/2840873.html . The web console https://workorder.console.aliyun.com/ was not readable through this tool; no ticket was opened. Sending requires separate user permission.

## Exact proposed non-secret content

Shanghai PostgreSQL16 Serverless source pgm-uf6rg214cp381l49, category serverless_standard, class pg.n2.serverless.2c, HA, general_essd100GB, Running. Full-instance available snapshot3184466733. CloneDBInstance request used PayType Serverless, same100GB, MinCapacity0.5/MaxCapacity4, zones cn-shanghai-e/cn-shanghai-g, existing VPC vpc-uf6e7vt902oid0p1mwd6q and switches vsw-uf6rqwne9b3cp48diptx1,vsw-uf6epcojpvdltooni86u8. Category omitted to inherit source; AutoPause/SwitchForce omitted. IO acceleration0, BurstingEnabledfalse, deletion protectiontrue. ClientToken wsx-native-9b25-s3184466733-first, unchanged on the sole bounded retry.

Both responses HTTP500 InternalError, no DBInstanceId:
- 2026-10-03T21:35:04Z RequestID01A103B1-2AF6-5F3C-BF84-FEF26A9F35D1.
- 2026-10-03T21:39:49Z RequestID01A103B5-846A-5B1F-A014-8A5D897B20F8.

ActionTrail confirms both error events. At2026-10-03T21:47:47.983501Z QueryOrders(all products) succeeded, total0; Shanghai DescribeDBInstances has only existing source, Running. OrdersRequestID01A103BC-D02E-59F4-84F0-A551449AF5C3; instancesRequestID01A103BC-CF9A-5F05-8A63-D073672D9443. No further create, token/parameter/snapshot/mode change, or production mutation will be attempted during diagnosis.

Please identify the backend cause from these RequestIDs, confirm PG16 Serverless HA full-snapshot CloneDBInstance support for this source and parameter combination, clarify inherited serverless_standard applicability for PostgreSQL (API Category table labels it MySQL), clarify BurstingEnabled applicability versus current CLI deprecated metadata, and confirm whether any delayed order/resource was accepted. Please provide the smallest supported correction or service recovery recommendation; do not create/change resources on our behalf.

No password, private key, AccessKey/caller identity, credential, database row or business export is included. Resource and network identifiers are proposed disclosure to the provider that operates them, not sent yet.

## Read-only diagnosis and next action

Official API supports PostgreSQL and PayTypeServerless, MinCapacity0.5/MaxCapacity4 and general_essd; source category inheritance is documented. PostgreSQL restore documentation requires a Serverless source to restore to another Serverless instance. Current documents do not establish that this exact failure is an IAM error or unsupported PG16. Category labeling and BurstingEnabled metadata are documentation ambiguities, not proven causes. Generic InternalError solution alone cannot distinguish backend outage from a parameter-combination defect.

References:
- https://help.aliyun.com/zh/rds/developer-reference/api-rds-2014-08-15-clonedbinstance
- https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/restore-data-of-an-apsaradb-rds-for-postgresql-instance
- https://help.aliyun.com/zh/rds/apsaradb-rds-for-postgresql/serverless-apsaradb-rds-for-postgresql-instances
- https://status.aliyun.com/ (no readable incident data returned; no health claim).

The next smallest decision is permission to send precisely this draft to the above RDS support channel. No additional spending or production activation is requested. Original T0 remains21:35:03Z, 3hcheck00:35:03Z/4hdeadline01:35:03Z Oct4 (Shanghai05:35/08:35/09:35); no extension. At the last observation no target/order existed. Native recovery proof, migration decision, exact9b25 production deployment and health/login/core-flow acceptance remain unfinished. Source evidence is not release success.
