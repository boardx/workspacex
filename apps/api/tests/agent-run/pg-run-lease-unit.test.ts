import {beforeEach,describe,expect,it,vi} from "vitest";
import {PgDatabase} from "../../src/infrastructure/db/pg-database";
import {RunLeaseLostError,withRunLease} from "../../src/application/agent-run/run-lease";
import {toOrgId} from "../../src/domain/org-id";
const mock=vi.hoisted(()=>({query:vi.fn(),release:vi.fn(),connect:vi.fn()}));
vi.mock("pg",()=>({default:{Pool:class {connect=mock.connect;end=vi.fn();}}}));
const org=toOrgId("o");
const db=new PgDatabase({host:"",port:0,user:"",password:"",database:""});
beforeEach(()=>{vi.clearAllMocks();mock.connect.mockResolvedValue({query:mock.query,release:mock.release});mock.query.mockResolvedValue({rows:[{id:"r"}]});});
describe("database fencing",()=>{
 it("rejects stale worker writes before invoking the transaction body",async()=>{
  mock.query.mockImplementation(async(sql:string)=>({rows:sql.includes("lease_epoch")?[]:[{id:"r"}]}));
  const mutate=vi.fn();
  await expect(withRunLease({orgId:org,runId:"r",epoch:1,verify:async()=>{}},()=>db.withTenant(org,mutate))).rejects.toBeInstanceOf(RunLeaseLostError);
  expect(mutate).not.toHaveBeenCalled();expect(mock.query).toHaveBeenCalledWith("ROLLBACK");
 });
 it("reuses same-org nested transaction so the run lock cannot self-deadlock",async()=>{
  await withRunLease({orgId:org,runId:"r",epoch:2,verify:async()=>{}},()=>db.withTenant(org,async first=>db.withTenant(org,async second=>{expect(second).toBe(first);await second.query("SELECT 1");})));
  expect(mock.connect).toHaveBeenCalledTimes(1);
  expect(mock.query.mock.calls.filter(call=>String(call[0]).includes("lease_epoch"))).toHaveLength(1);
 });
 it("does not fence unrelated normal requests",async()=>{
  await db.withTenant(org,session=>session.query("SELECT ordinary_request"));
  expect(mock.query.mock.calls.some(call=>String(call[0]).includes("lease_epoch"))).toBe(false);
 });
});
