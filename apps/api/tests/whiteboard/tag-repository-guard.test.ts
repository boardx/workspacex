import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source=readFileSync(new URL('../../src/infrastructure/whiteboard/pg-whiteboard-tag-repository.ts',import.meta.url),'utf8');
function audit(code:string):string[]{
  const file=ts.createSourceFile('tags.ts',code,ts.ScriptTarget.Latest,true),methods=new Map<string,string>(),sql:string[]=[];
  const visit=(node:ts.Node):void=>{if(ts.isMethodDeclaration(node)&&node.name)methods.set(node.name.getText(file),node.getText(file));
    if(ts.isNoSubstitutionTemplateLiteral(node))sql.push(node.text);if(ts.isTemplateExpression(node))sql.push(node.head.text+node.templateSpans.map(span=>span.literal.text).join(' '));ts.forEachChild(node,visit);};
  visit(file);const errors:string[]=[];
  for(const name of ['listTags','createTag','renameTag','deleteTag'])if(!/return (?:await )?this\.db\.withTenant\(p\.orgId,/.test(methods.get(name)??''))errors.push(`${name}: tenant context`);
  if(/withoutTenant\s*\(/.test(code))errors.push('withoutTenant');
  const allowed=new Set(['org_memberships','whiteboard_tags','whiteboard_tag_mutation_receipts','whiteboard_tag_bindings','whiteboards']);
  const tables=new Set(sql.flatMap(query=>[...query.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map(match=>match[1]!)
    .filter(table=>table.toUpperCase()!=='SET'&&!['removed','affected'].includes(table))));
  if([...tables].some(table=>!allowed.has(table))||[...allowed].some(table=>!tables.has(table)))errors.push('table scope');
  for(const name of ['renameTag','deleteTag']){
    const body=methods.get(name)??'';if(!body.includes('lockManageableTag'))errors.push(`${name}: authorization lock`);
  }
  if([...((methods.get('deleteTag')??'').matchAll(/this\.receipt\(/g))].length<3)errors.push('deleteTag: concurrent receipt replay');
  if(!code.includes("om.org_role='admin'")||!code.includes('t.created_by=$2'))errors.push('tag governance');
  if(!code.includes('FOR UPDATE'))errors.push('mutation lock');
  return errors;
}
describe('whiteboard tag repository permission boundary',()=>{
  it('keeps tenant context, bounded tables and creator/admin governance',()=>expect(audit(source)).toEqual([]));
  it('detects removing tag governance',()=>expect(audit(source.replace('t.created_by=$2','false'))).toContain('tag governance'));
  it('detects an unscoped extra table',()=>expect(audit(`${source}\nconst bad=\`SELECT * FROM artifacts\`;`)).toContain('table scope'));
  it('detects removing the post-lock delete replay',()=>expect(audit(source.replace('const concurrent = await this.receipt','const concurrent = await this.noReceipt')))
    .toContain('deleteTag: concurrent receipt replay'));
});
