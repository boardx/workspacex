import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
/** Disposable schema in the isolated fixture cluster; no cloud adapter. */
export async function triggerRoundtrip(client:{query(sql:string,args?:unknown[]):Promise<{rows:any[]}>},fixedQuery:string){
 const schema='cn_trigger_roundtrip_fixture';let owned=false;
 const create=async()=>{
  await client.query('CREATE SCHEMA cn_trigger_roundtrip_fixture');owned=true;
  await client.query('CREATE TABLE cn_trigger_roundtrip_fixture.parent(n integer PRIMARY KEY)');
  await client.query('CREATE TABLE cn_trigger_roundtrip_fixture.child(x integer,y integer,CONSTRAINT fk_x FOREIGN KEY(x) REFERENCES cn_trigger_roundtrip_fixture.parent(n),CONSTRAINT fk_y FOREIGN KEY(y) REFERENCES cn_trigger_roundtrip_fixture.parent(n))');
  await client.query("CREATE FUNCTION cn_trigger_roundtrip_fixture.fn() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END;'");
  await client.query("CREATE TRIGGER \"RI_ConstraintTrigger_a_123\" BEFORE INSERT ON cn_trigger_roundtrip_fixture.child FOR EACH ROW EXECUTE FUNCTION cn_trigger_roundtrip_fixture.fn('RI_ConstraintTrigger_a_123')");
 };
 const collect=async()=>{
  const rows=(await client.query(fixedQuery)).rows.filter(row=>row.schema===schema);
  return rows.map(row=>JSON.stringify(row)).sort();
 };
 const raw=async()=>(await client.query('SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND t.tgisinternal ORDER BY t.tgname',[schema])).rows;
 try{
  await client.query("SET search_path='pg_catalog'");await create();
  const original=await collect(),originalRaw=await raw();assert.equal(original.length,9);
  const internal=original.map(row=>JSON.parse(row)).filter(row=>row.internal===true);
  assert.equal(internal.length,8);assert.equal(new Set(internal.map(row=>row.name)).size,8,'MULTI_FK_EVENT_IDENTITY_COLLISION');
  const user=original.map(row=>JSON.parse(row)).find(row=>row.internal===false);
  assert.equal(user.name,'RI_ConstraintTrigger_a_123');assert(user.definition.includes("'RI_ConstraintTrigger_a_123'"));assert.equal(user.constraint_binding,null);
  await client.query('DROP SCHEMA cn_trigger_roundtrip_fixture CASCADE');owned=false;await create();
  assert(!isDeepStrictEqual(await raw(),originalRaw),'GENERATED_OID_NAMES_NOT_CHANGED');
  assert.deepEqual(await collect(),original,'CANONICAL_TRIGGER_ROUNDTRIP_CHANGED');
  await client.query('ALTER TABLE cn_trigger_roundtrip_fixture.child DISABLE TRIGGER ALL');
  assert(!isDeepStrictEqual(await collect(),original),'DISABLED_TRIGGER_NOT_REJECTED');
  await client.query('ALTER TABLE cn_trigger_roundtrip_fixture.child ENABLE TRIGGER ALL');assert.deepEqual(await collect(),original);
  await client.query('ALTER TABLE cn_trigger_roundtrip_fixture.child ALTER CONSTRAINT fk_x DEFERRABLE INITIALLY DEFERRED');
  assert(!isDeepStrictEqual(await collect(),original),'DEFERRED_TRIGGER_NOT_REJECTED');
  await client.query('ALTER TABLE cn_trigger_roundtrip_fixture.child ALTER CONSTRAINT fk_x NOT DEFERRABLE');assert.deepEqual(await collect(),original);
  await client.query('ALTER TABLE cn_trigger_roundtrip_fixture.child RENAME CONSTRAINT fk_x TO fk_changed');
  assert(!isDeepStrictEqual(await collect(),original),'FK_BINDING_NOT_REJECTED');
  await client.query('ALTER TABLE cn_trigger_roundtrip_fixture.child RENAME CONSTRAINT fk_changed TO fk_x');assert.deepEqual(await collect(),original);
  await client.query("CREATE FUNCTION cn_trigger_roundtrip_fixture.fn_changed() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END;'");
  await client.query('DROP TRIGGER "RI_ConstraintTrigger_a_123" ON cn_trigger_roundtrip_fixture.child');
  await client.query("CREATE TRIGGER \"RI_ConstraintTrigger_a_123\" BEFORE INSERT ON cn_trigger_roundtrip_fixture.child FOR EACH ROW EXECUTE FUNCTION cn_trigger_roundtrip_fixture.fn_changed('RI_ConstraintTrigger_a_123')");
  assert(!isDeepStrictEqual(await collect(),original),'FUNCTION_IDENTITY_NOT_REJECTED');
  await client.query('DROP TRIGGER "RI_ConstraintTrigger_a_123" ON cn_trigger_roundtrip_fixture.child');
  await client.query("CREATE TRIGGER \"RI_ConstraintTrigger_a_123\" BEFORE UPDATE ON cn_trigger_roundtrip_fixture.child FOR EACH ROW EXECUTE FUNCTION cn_trigger_roundtrip_fixture.fn('RI_ConstraintTrigger_a_123')");
  assert(!isDeepStrictEqual(await collect(),original),'TRIGGER_EVENT_NOT_REJECTED');
  return {actualPostgres:true,privateSchemaOnly:true,generatedOidNamesChanged:true,canonicalRoundtripEqual:true,multiForeignKeyEventsDistinct:true,userNamesAndLiteralPreserved:true,disabledRejected:true,deferralRejected:true,foreignKeyBindingRejected:true,functionIdentityRejected:true,eventRejected:true};
 }finally{if(owned)await client.query('DROP SCHEMA cn_trigger_roundtrip_fixture CASCADE');}
}
