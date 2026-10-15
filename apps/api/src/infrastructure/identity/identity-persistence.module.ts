// Shared composition: one DB pool and one set of identity repositories across Kernel and Billing.
import { Module } from "@nestjs/common";
import { DATABASE_PORT, type DatabasePort } from "../../application/ports/database.port";
import { IDENTITY_REPOSITORY } from "../../application/identity/ports";
import { CREDENTIAL_REPOSITORY } from "../../application/auth/ports";
import { PLATFORM_ADMIN_REPOSITORY } from "../../application/system/platform-admin-ports";
import { PgDatabase } from "../db/pg-database";
import { appConfig } from "../db/pg-config";
import { PgIdentityRepository } from "./pg-identity-repository";
import { PgCredentialRepository } from "../auth/pg-credential-repository";
import { PgPlatformAdminRepository } from "../system/pg-platform-admin-repository";
@Module({
  providers:[
    {provide:DATABASE_PORT,useFactory:()=>new PgDatabase(appConfig())},
    {provide:IDENTITY_REPOSITORY,useFactory:(db:DatabasePort)=>new PgIdentityRepository(db),inject:[DATABASE_PORT]},
    {provide:CREDENTIAL_REPOSITORY,useFactory:(db:DatabasePort)=>new PgCredentialRepository(db),inject:[DATABASE_PORT]},
    {provide:PLATFORM_ADMIN_REPOSITORY,useFactory:(db:DatabasePort)=>new PgPlatformAdminRepository(db),inject:[DATABASE_PORT]},
  ],
  exports:[DATABASE_PORT,IDENTITY_REPOSITORY,CREDENTIAL_REPOSITORY,PLATFORM_ADMIN_REPOSITORY],
})
export class IdentityPersistenceModule {}
