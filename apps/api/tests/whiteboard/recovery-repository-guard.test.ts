import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const source=readFileSync(new URL('../../src/infrastructure/whiteboard/pg-recovery-metadata.ts',import.meta.url),'utf8');
function sqlTables(code:string){
 const file=ts.createSourceFile('recovery.ts',code,ts.ScriptTarget.Latest,true),tables=new Set<string>();
 const constants=new Map<string,string>();
 for(const statement of file.statements)if(ts.isVariableStatement(statement)&&(statement.declarationList.flags&ts.NodeFlags.Const))for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name)&&declaration.initializer&&ts.isStringLiteralLike(declaration.initializer))constants.set(declaration.name.text,declaration.initializer.text);
 function text(node:ts.Expression):string{
  if(ts.isStringLiteralLike(node))return node.text;
  if(ts.isIdentifier(node)&&constants.has(node.text))return constants.get(node.text)!;
  if(ts.isConditionalExpression(node)&&node.condition.getText(file)==='lock'&&ts.isStringLiteralLike(node.whenTrue)&&ts.isStringLiteralLike(node.whenFalse)&&node.whenTrue.text===' FOR UPDATE'&&node.whenFalse.text===' FOR SHARE')return node.whenTrue.text;
  if(ts.isTemplateExpression(node))return node.head.text+node.templateSpans.map(span=>text(span.expression)+span.literal.text).join('');
  throw new Error('UNREVIEWED_DYNAMIC_SQL');
 }
 function visit(node:ts.Node):void{
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='query'){
   const argument=node.arguments[0];
   if(!argument)throw new Error('UNREVIEWED_DYNAMIC_SQL');
   const sql=text(argument);
   for(const match of sql.matchAll(/\b(?:FROM|JOIN|INTO)\s+([a-z_]+)/gi))tables.add(match[1]!);
   const update=/^\s*UPDATE\s+([a-z_]+)/i.exec(sql);if(update)tables.add(update[1]!);
  }
  ts.forEachChild(node,visit);
 }
 visit(file);return tables;
}
describe('whiteboard recovery permission and metadata boundary',()=>{
  it('uses only reviewed board/recovery metadata tables under tenant transactions',()=>{expect(sqlTables(source)).toEqual(new Set(['whiteboards','whiteboard_members','whiteboard_documents','whiteboard_checkpoints','whiteboard_recovery_events','whiteboard_restore_receipts','whiteboard_updates']));expect(source).toContain('this.db.withTenant(p.orgId');expect(source).not.toContain('withoutTenant');expect(source).not.toMatch(/snapshot\s*:/);});
  it('checks board and project access before manifests and keeps restore owner-only with receipt-first CAS',()=>{expect(source).toContain('await access(session,p,boardId,this.projectAccess)');expect(source).toContain("rights.role!=='owner'||rights.archived");expect(source).toContain('FOR UPDATE');expect(source).toContain("snapshot=NULL");const restore=source.slice(source.indexOf('async commitRestore'));expect(restore.indexOf('SELECT request_hash,new_epoch')).toBeLessThan(restore.indexOf('SELECT epoch,seq::text FROM whiteboard_documents'));});
});

it('SQL inventory ignores prose/row locks but detects added table access and dynamic SQL',()=>{
 expect(sqlTables(`// FOR UPDATE lock comment
s.query('SELECT id FROM whiteboards FOR UPDATE');`)).toEqual(new Set(['whiteboards']));
 expect(sqlTables(`${source}\ns.query('SELECT * FROM artifacts');`)).toContain('artifacts');
 expect(sqlTables(`s.query('UPDATE artifacts SET value=1');`)).toContain('artifacts');
 expect(()=>sqlTables(`s.query(queryFromElsewhere);`)).toThrow('UNREVIEWED_DYNAMIC_SQL');
});
