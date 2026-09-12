import { z } from "zod";
import { ossInventorySchema, verifyOssInventory } from "./initial-production-sync";

const identifier = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_$]*$/);
const tableRow = z.object({ schema: identifier, table: identifier, primaryKey: z.array(identifier) }).strict();
const foreignKeyRow = z.object({ schema: identifier, table: identifier, name: identifier, validated: z.boolean(),
  columns: z.array(identifier).min(1), referencedSchema: identifier, referencedTable: identifier,
  referencedColumns: z.array(identifier).min(1) }).strict().refine(value => value.columns.length === value.referencedColumns.length);
const summaryRow = z.object({ count: z.number().int().nonnegative(), primaryKeyMd5: z.string().regex(/^[a-f0-9]{32}$/).nullable() }).strict();

export const initialSyncEvidenceInputSchema = z.object({
  sourceSnapshot: z.string().min(1).max(512),
  sourceOssInventory: ossInventorySchema,
  targetOssInventory: ossInventorySchema,
  secretCiphertextsDetected: z.boolean(),
  keyDecision: z.enum(["same-key-confirmed", "rotated"]),
}).strict();

export type EvidenceQuery = (side: "source" | "target", sql: string) => Promise<string>;
export type DatabaseTableEvidence = { schema: string; table: string; count: number; primaryKeyMd5: string | null };
export type DatabaseEvidence = { tables: DatabaseTableEvidence[]; foreignKeysChecked: number; invalidForeignKeys: string[]; orphanedForeignKeys: string[]; criticalReferenceFailures: string[] };

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const jsonLines = <T>(raw: string, schema: z.ZodType<T>): T[] => raw.split("\n").filter(Boolean).map(line => schema.parse(JSON.parse(line)));

const TABLES_SQL = `SELECT json_build_object('schema',n.nspname,'table',c.relname,'primaryKey',coalesce((
 SELECT json_agg(a.attname ORDER BY k.ordinality) FROM pg_index i
 JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) ON true
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum WHERE i.indrelid=c.oid AND i.indisprimary
),'[]'::json)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind IN ('r','p') AND n.nspname='public' ORDER BY n.nspname,c.relname;`;
const FOREIGN_KEYS_SQL = `SELECT json_build_object('schema',ns.nspname,'table',cl.relname,'name',co.conname,'validated',co.convalidated,
'columns',json_agg(a.attname ORDER BY k.ordinality),'referencedSchema',rns.nspname,'referencedTable',rcl.relname,
'referencedColumns',json_agg(ra.attname ORDER BY k.ordinality)) FROM pg_constraint co
JOIN pg_class cl ON cl.oid=co.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace
JOIN pg_class rcl ON rcl.oid=co.confrelid JOIN pg_namespace rns ON rns.oid=rcl.relnamespace
JOIN LATERAL unnest(co.conkey,co.confkey) WITH ORDINALITY k(attnum,refattnum,ordinality) ON true
JOIN pg_attribute a ON a.attrelid=cl.oid AND a.attnum=k.attnum JOIN pg_attribute ra ON ra.attrelid=rcl.oid AND ra.attnum=k.refattnum
WHERE co.contype='f' AND ns.nspname='public' GROUP BY ns.nspname,cl.relname,co.conname,co.convalidated,rns.nspname,rcl.relname ORDER BY ns.nspname,cl.relname,co.conname;`;

async function inspectDatabase(side: "source" | "target", query: EvidenceQuery): Promise<DatabaseEvidence> {
  const tables = jsonLines(await query(side, TABLES_SQL), tableRow);
  if (!tables.length) throw new Error(`INITIAL_SYNC_${side.toUpperCase()}_DATABASE_EMPTY`);
  const summaries: DatabaseTableEvidence[] = [];
  for (const table of tables) {
    if (!table.primaryKey.length) {
      const [summary] = jsonLines(await query(side, `SELECT json_build_object('count',count(*)::int,'primaryKeyMd5',NULL) FROM ${quote(table.schema)}.${quote(table.table)};`), summaryRow);
      if (!summary) throw new Error("INITIAL_SYNC_TABLE_SUMMARY_MISSING");
      summaries.push({ schema: table.schema, table: table.table, ...summary });
      continue;
    }
    const pk = `jsonb_build_array(${table.primaryKey.map(column => `to_jsonb(t)->${literal(column)}`).join(",")})::text`;
    const sql = `SELECT json_build_object('count',count(*)::int,'primaryKeyMd5',md5(coalesce(string_agg(md5(${pk}),'' ORDER BY ${table.primaryKey.map(column => `t.${quote(column)}`).join(",")}),''))) FROM ${quote(table.schema)}.${quote(table.table)} t;`;
    const [summary] = jsonLines(await query(side, sql), summaryRow);
    if (!summary) throw new Error("INITIAL_SYNC_TABLE_SUMMARY_MISSING");
    summaries.push({ schema: table.schema, table: table.table, ...summary });
  }
  const foreignKeys = jsonLines(await query(side, FOREIGN_KEYS_SQL), foreignKeyRow);
  const invalidForeignKeys = foreignKeys.filter(key => !key.validated).map(key => `${key.schema}.${key.table}.${key.name}`);
  const orphanedForeignKeys: string[] = [];
  for (const key of foreignKeys) {
    const join = key.columns.map((column, index) => `child.${quote(column)}=parent.${quote(key.referencedColumns[index]!)}`).join(" AND ");
    const present = key.columns.map(column => `child.${quote(column)} IS NOT NULL`).join(" AND ");
    const sql = `SELECT count(*) FROM ${quote(key.schema)}.${quote(key.table)} child LEFT JOIN ${quote(key.referencedSchema)}.${quote(key.referencedTable)} parent ON ${join} WHERE ${present} AND parent.${quote(key.referencedColumns[0]!)} IS NULL;`;
    if ((await query(side, sql)).trim() !== "0") orphanedForeignKeys.push(`${key.schema}.${key.table}.${key.name}`);
  }
  const criticalReferenceFailures: string[] = [];
  const skillCurrentVersionOrphans = await query(side, `SELECT count(*) FROM public.skill_contracts skill LEFT JOIN public.skill_contract_versions version
ON version.id=skill.current_version_id AND version.org_id=skill.org_id AND version.skill_id=skill.id
WHERE skill.current_version_id IS NOT NULL AND version.id IS NULL;`);
  if (skillCurrentVersionOrphans.trim() !== "0") criticalReferenceFailures.push("skill_contracts.current_version_id");
  return { tables: summaries, foreignKeysChecked: foreignKeys.length, invalidForeignKeys, orphanedForeignKeys, criticalReferenceFailures };
}

export async function generateInitialSyncEvidence(input: unknown, query: EvidenceQuery) {
  const value = initialSyncEvidenceInputSchema.parse(input);
  const [source, target] = await Promise.all([inspectDatabase("source", query), inspectDatabase("target", query)]);
  const tableKey = (table: DatabaseTableEvidence) => `${table.schema}.${table.table}`;
  const normalized = (database: DatabaseEvidence) => Object.fromEntries(database.tables.map(table => [tableKey(table), { count: table.count, primaryKeyMd5: table.primaryKeyMd5 }]));
  const sourceTables = normalized(source), targetTables = normalized(target);
  const databaseMatches = JSON.stringify(sourceTables) === JSON.stringify(targetTables);
  const foreignKeysValid = target.invalidForeignKeys.length === 0 && target.orphanedForeignKeys.length === 0;
  const criticalReferencesValid = foreignKeysValid && target.criticalReferenceFailures.length === 0;
  const oss = verifyOssInventory(value.sourceOssInventory, value.targetOssInventory);
  return {
    sourceSnapshot: value.sourceSnapshot,
    databaseRestored: databaseMatches,
    foreignKeysValid,
    criticalReferencesValid,
    ossInventoryVerified: oss.verified,
    secretCiphertextsDetected: value.secretCiphertextsDetected,
    keyDecision: value.keyDecision,
    evidence: { source, target, databaseMatches, oss },
  };
}
