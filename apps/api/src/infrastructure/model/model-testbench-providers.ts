import type {Provider} from "@nestjs/common";
import type {DatabasePort} from "../../application/ports/database.port";
import {DATABASE_PORT} from "../../application/ports/database.port";
import {TOKEN_USAGE_METER,type TokenUsageMeterPort} from "../../application/agent-run/ports";
import {PLATFORM_MODEL_TEST_SERVICE} from "../../application/model/platform-model-test-ports";
import {PLATFORM_MODEL_TEST_READ} from "../../application/model/platform-model-test-read-ports";
import {isPlatformOperator} from "../../domain/system/platform-admin";
import {isPlatformSuperuserEmail,platformSuperuserWhitelistFromEnv} from "../../domain/system/platform-superuser";
import {PgIdentityRepository} from "../identity/pg-identity-repository";
import {PgPlatformModelTestRepository} from "./pg-platform-model-test-repository";
import {createPlatformModelTestWiring,type PlatformModelTestWiringConfig} from "./platform-test-wiring";

/** Trusted server composition only; no directory row or API request creates a registration. */
export const PLATFORM_MODEL_TEST_CONFIGURATION=Symbol("PlatformModelTestConfiguration");
const WIRING=Symbol("PlatformModelTestWiring");
export const MODEL_TESTBENCH_PROVIDERS:Provider[]=[
 {provide:PLATFORM_MODEL_TEST_CONFIGURATION,useValue:null},
 {provide:WIRING,useFactory:(db:DatabasePort,usage:TokenUsageMeterPort,configuration:PlatformModelTestWiringConfig|null)=>{
  const repo=new PgPlatformModelTestRepository(db,{identities:scoped=>new PgIdentityRepository(scoped),
   isOperator:(userId,scoped,orgId)=>scoped.withTenant(orgId,async session=>{
    // Global identity tables are read through the already scoped transaction, without
    // selecting passwords, changing tenant context, granting roles or opening a second connection.
    const credential=(await session.query<{email:string}>("SELECT email FROM credentials WHERE user_id=$1",[userId])).rows[0];
    const superuser=isPlatformSuperuserEmail(credential?.email??"",platformSuperuserWhitelistFromEnv(process.env.PLATFORM_SUPERUSER_EMAILS));
    const admin=superuser?false:(await session.query("SELECT 1 FROM platform_admins WHERE user_id=$1",[userId])).rows.length>0;
    return isPlatformOperator(superuser,admin);
   })});
  return createPlatformModelTestWiring(configuration,{db,usage,repo});
 },inject:[DATABASE_PORT,TOKEN_USAGE_METER,PLATFORM_MODEL_TEST_CONFIGURATION]},
 {provide:PLATFORM_MODEL_TEST_SERVICE,useFactory:(wiring:ReturnType<typeof createPlatformModelTestWiring>)=>wiring.service,inject:[WIRING]},
 {provide:PLATFORM_MODEL_TEST_READ,useFactory:(wiring:ReturnType<typeof createPlatformModelTestWiring>)=>wiring.reader,inject:[WIRING]},
];
