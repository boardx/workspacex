import {expect,it} from 'vitest';
import {ScopedPgSkillContractRepository} from '../../src/infrastructure/skill/pg-skill-contract-repository';
import {listSkills} from '../../src/application/skill/list-skills';
import type {DatabasePort} from '../../src/application/ports/database.port';
it.each(['将解决方案整理为知识文章',null])('preserves published task description through authorized listing: %s',async description=>{
 const session={query:async(sql:string)=>({rows:sql.includes('FROM skills sk')?[{id:'skill-kb',name:'S190',org_id:'org',stable_name:'S190',current_version_id:'published',task_description:description}]:[]})};
 const db={withTenant:async(_org:unknown,fn:(s:unknown)=>unknown)=>fn(session)} as unknown as DatabasePort;
 const catalog=new ScopedPgSkillContractRepository(db,'org' as never);
 const result=await listSkills({orgId:'org',entry:'chat-mount',requesterTeamId:null,orgRole:'admin'},{catalog,nextDecisionId:()=> 'decision'});
 expect(result.items).toHaveLength(1);expect(result.items[0]?.taskDescription).toBe(description??undefined);
 expect(result.items[0]?.currentVersionId).toBe('published');expect(result.items[0]?.name).toBe('S190');
});
