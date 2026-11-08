import {expect,it} from 'vitest';
import {skillPickerDisplay} from '@/lib/skill-picker-display';
it('uses authored names and published task descriptions without changing identity',()=>{
 const row={skillId:'skill-id',name:'S190',duty:'以文件形式管理',taskDescription:'将已解决的问题整理为知识库文章。',currentVersionId:'v1'};
 const display=skillPickerDisplay(row);
 expect(display.name).toBe('知识库文章');expect(display.duty).toBe(row.taskDescription);
 expect(display.skillId).toBe(row.skillId);expect(display.currentVersionId).toBe('v1');expect(row.name).toBe('S190');
});
it('keeps custom names and genuine descriptions',()=>{expect(skillPickerDisplay({name:'自定义技能',duty:'处理客户反馈'})).toEqual({name:'自定义技能',duty:'处理客户反馈'});});
