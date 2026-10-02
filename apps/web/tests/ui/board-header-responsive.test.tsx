import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BoardEditorHeader } from '@/components/whiteboard/board-editor-header';
vi.mock('@/components/whiteboard/board-share-dialog',()=>({BoardShareDialog:()=> <button>分享白板</button>}));
afterEach(()=>vi.unstubAllGlobals());
it('moves presence and presentation into the narrow-desktop menu without duplicating or losing actions',()=>{
 let compact=true;const listeners=new Set<()=>void>(),queries:string[]=[];
 vi.stubGlobal('matchMedia',(query:string)=>{queries.push(query);return {get matches(){return compact;},addEventListener:(_type:string,listener:()=>void)=>listeners.add(listener),removeEventListener:(_type:string,listener:()=>void)=>listeners.delete(listener)};});
 const follow=vi.fn(),present=vi.fn();
 render(<BoardEditorHeader boardId="board" title="很长的团队白板名称" status="已同步" readOnly={false} history={<><button>撤销</button><button>重做</button></>} peers={<button onClick={follow}>跟随 Grace</button>} presentation={<button onClick={present}>开始演示</button>} more={<button>导出</button>} userAvatar={<span role="img" aria-label="Grace 的头像">G</span>}/>);
 const header=screen.getByTestId('board-editor-header');expect(within(header).queryByRole('button',{name:'跟随 Grace'})).toBeNull();
 expect(queries).toContain('(max-width: 1279px)');
 expect(header).toHaveClass('bg-background');expect(header).toHaveStyle({height:'64px'});
 expect(screen.getByAltText('WorkspaceX')).toHaveClass('xl:block');
 expect(within(screen.getByTestId('board-sync-status')).getByText('已同步')).toHaveClass('sr-only');
 expect(screen.getByTestId('board-help-open')).toHaveAccessibleName('白板帮助');
 expect(within(screen.getByTestId('board-user-avatar')).getByRole('img')).toHaveAccessibleName('Grace 的头像');
 fireEvent.click(screen.getByRole('button',{name:'更多白板操作'}));
 fireEvent.click(screen.getByRole('button',{name:'跟随 Grace'}));fireEvent.click(screen.getByRole('button',{name:'开始演示'}));
 expect(follow).toHaveBeenCalledOnce();expect(present).toHaveBeenCalledOnce();
 expect(screen.getAllByRole('button',{name:'跟随 Grace'})).toHaveLength(1);
 act(()=>{compact=false;listeners.forEach(listener=>listener());});
 expect(within(header).getByRole('button',{name:'跟随 Grace'})).toBeVisible();expect(within(header).getByRole('button',{name:'开始演示'})).toBeVisible();
 expect(screen.getAllByRole('button',{name:'跟随 Grace'})).toHaveLength(1);
});

it('explains the disabled title field and provides the return path for renaming',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
 render(<BoardEditorHeader boardId="board" title="白板" status="已同步" readOnly={false} history={null} peers={null} presentation={null} more={null} userAvatar={null} onBack={()=>{}}/>);
 fireEvent.keyDown(screen.getByTestId('board-title-menu'),{key:'ArrowDown'});
 const input=await screen.findByRole('textbox',{name:'白板名称'});
 expect(input).toBeDisabled();expect(input).toHaveAccessibleDescription('请返回白板列表，通过更多操作重命名。');
});

it('uses the header cloud state for pending work and keeps offline recovery actionable',()=>{
 const retry=vi.fn(),props={boardId:'board',title:'白板',status:'2 项修改等待服务器确认',readOnly:false,history:null,peers:null,more:null,onRetrySync:retry};
 const view=render(<BoardEditorHeader {...props} syncPhase="pending" syncDetails="未确认修改会加密保存在此浏览器"/>);
 const sync=screen.getByTestId('board-sync-status');expect(sync).toHaveAttribute('data-sync-phase','pending');
 expect(sync.querySelector('svg')).toHaveClass('lucide-loader-circle','motion-safe:animate-spin');
 expect(within(sync).getByText(props.status)).toHaveClass('sr-only');
 expect(sync).toHaveAccessibleName(props.status);
 expect(sync).toHaveAttribute('title',`${props.status} · 未确认修改会加密保存在此浏览器`);
 expect(sync).toHaveTextContent('加密保存在此浏览器');
 expect(screen.queryByTestId('board-retry-sync')).toBeNull();
 view.rerender(<BoardEditorHeader {...props} syncPhase="connecting" status="正在连接服务器" readOnly/>);
 expect(sync.querySelector('svg')).toHaveClass('lucide-loader-circle','motion-safe:animate-spin');
 expect(within(sync).getByText('正在连接服务器 · 只读')).toHaveClass('sr-only');
 expect(sync).toHaveAccessibleName('正在连接服务器 · 只读');
 view.rerender(<BoardEditorHeader {...props} syncPhase="offline" status="连接中断"/>);
 expect(sync).toHaveAttribute('data-sync-phase','offline');fireEvent.click(screen.getByTestId('board-retry-sync'));expect(retry).toHaveBeenCalledOnce();
 view.rerender(<BoardEditorHeader {...props} syncPhase="synced" status="已同步"/>);
 expect(sync.querySelector('svg')).not.toHaveClass('motion-safe:animate-spin');expect(screen.queryByTestId('board-retry-sync')).toBeNull();
});
