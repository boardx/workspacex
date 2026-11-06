import {expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {BoardEditorHeader} from '@/components/whiteboard/board-editor-header';
const props={boardId:'board',title:'原名称',status:'已连接',readOnly:false,history:null,peers:null,more:null};
function open(){fireEvent.pointerDown(screen.getByTestId('board-title-menu'),{button:0,ctrlKey:false,pointerType:'mouse'});return screen.getByRole('textbox',{name:'白板名称'});}
it('cancels Escape followed by blur without saving',()=>{
 const save=vi.fn();render(<BoardEditorHeader {...props} onTitleChange={save}/>);
 const input=open();fireEvent.change(input,{target:{value:'取消的名称'}});
 fireEvent.keyDown(input,{key:'Escape'});fireEvent.blur(input);
 expect(save).not.toHaveBeenCalled();expect(input).toHaveValue('原名称');
});
it('locks the name field until the rename request finishes and allows retry after failure',async()=>{
 let fail!:(reason:Error)=>void;
 const save=vi.fn(()=>new Promise<void>((_,reject)=>{fail=reject;}));
 render(<BoardEditorHeader {...props} onTitleChange={save}/>);
 const input=open();fireEvent.change(input,{target:{value:'新名称'}});fireEvent.blur(input);
 expect(save).toHaveBeenCalledWith('新名称');expect(input).toBeDisabled();
 await act(async()=>fail(new Error('保存失败')));
 await waitFor(()=>expect(input).toBeEnabled());
 fireEvent.blur(input);expect(save).toHaveBeenCalledTimes(2);
});
