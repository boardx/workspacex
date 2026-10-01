import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LiveBoard } from '@/components/whiteboard/live-board';
import * as api from '@/lib/live-whiteboard';
import { convertExternalBoardSnapshot } from '@repo/whiteboard-core';
import { whiteboardTransfer as T } from '@repo/contracts';

const push=vi.fn();
vi.mock('next/navigation',()=>({useRouter:()=>({push})}));
vi.mock('@/components/session/session-provider',()=>({useOptionalSession:()=>({session:{userId:'owner',currentOrgId:'org-one'}})}));
vi.mock('@/lib/whiteboard-provider',()=>({WhiteboardProvider:class{constructor(_doc:unknown,_id:string,onState:(value:unknown)=>void){onState({phase:'synced',pending:0,role:'owner',archived:false,peers:[],reason:null});}awareness(){}close(){}}}));
vi.mock('@/lib/live-whiteboard',()=>({getBoard:vi.fn(),exportBoardPackage:vi.fn(),previewBoardImport:vi.fn(),importBoardPackage:vi.fn()}));
vi.mock('@repo/whiteboard-core', async importOriginal => ({
  ...(await importOriginal<typeof import('@repo/whiteboard-core')>()),
  convertExternalBoardSnapshot: vi.fn(),
}));

const board={id:'57d83843-21e2-40ae-8c1c-571d0ad63c80',name:'Source',ownerId:'owner',role:'owner' as const,archived:false,createdAt:'2026-09-24T00:00:00.000Z',updatedAt:'2026-09-24T00:00:00.000Z'};
const bundle=T.createPortableBoardPackage({format:'workspacex.board',schemaVersion:1,source:{application:'WorkspaceX',boardId:board.id,name:'Source'},objects:[]});
const emptyQuality=T.completeImportQuality([]);
const serverPreview={sourceName:'Source',destinationName:'Source（导入）',objectCount:0,frameCount:0,groupCount:0,connectorCount:0,identitiesRemapped:0,contentLosses:[],quality:emptyQuality};
beforeEach(()=>{vi.resetAllMocks();vi.mocked(api.getBoard).mockResolvedValue(board);vi.mocked(api.previewBoardImport).mockResolvedValue(serverPreview);vi.stubGlobal('crypto',{randomUUID:()=>randomUUID()});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('Board portable transfer UI',()=>{
  it('opens the file chooser from a visible button and restores focus after an import error',async()=>{
    const inputClick=vi.spyOn(HTMLInputElement.prototype,'click');
    render(<LiveBoard boardId={board.id}/>);
    const trigger=await screen.findByRole('button',{name:'导入副本'});
    expect(trigger).toHaveAttribute('data-testid','board-import-trigger');
    expect(trigger.className).toContain('focus-visible:ring-2');
    trigger.focus();fireEvent.click(trigger);
    expect(inputClick).toHaveBeenCalledTimes(1);
    const input=screen.getByTestId('board-import-file');
    expect(input).toHaveAttribute('tabindex','-1');
    fireEvent.change(input,{target:{files:[{size:10,text:async()=>'{}'}]}});
    expect(await screen.findByRole('alert')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'关闭'}));
    await waitFor(()=>expect(trigger).toHaveFocus());
    expect(input).not.toHaveFocus();
    inputClick.mockRestore();
  });
  it('previews loss and explicitly creates a new board instead of replacing the open board',async()=>{
    vi.mocked(api.importBoardPackage).mockResolvedValue({board:{...board,id:'8f177ac1-a652-4a6d-9078-fe239ad672bd',name:'Source（导入）'},importedObjects:0,remappedObjects:0,replayed:false});
    render(<LiveBoard boardId={board.id}/>);await screen.findByTestId('board-import-file');
    const file={size:100,name:'source.json',text:async()=>JSON.stringify(bundle)} as File;
    fireEvent.change(screen.getByTestId('board-import-file'),{target:{files:[file]}});
    expect(await screen.findByText(/不会替换当前白板/)).toBeTruthy();expect(screen.getByText(/内容损失：无/)).toBeTruthy();
    expect(convertExternalBoardSnapshot).not.toHaveBeenCalled();
    expect(api.previewBoardImport).toHaveBeenCalledWith(expect.objectContaining({package:bundle}));
    fireEvent.click(screen.getByTestId('board-import-confirm'));
    await waitFor(()=>expect(api.importBoardPackage).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith('/studio/board/8f177ac1-a652-4a6d-9078-fe239ad672bd');
  });
  it.each([
    ['Miro','miro' as const,'Miro planning',{format:'miro.rest.board-snapshot'}],
    ['Mural','mural' as const,'Mural workshop',{format:'mural.public-api.mural-snapshot'}],
  ])('previews %s source, editable totals, skipped objects, and loss categories',async(_label,provider,sourceName,snapshot)=>{
    vi.mocked(convertExternalBoardSnapshot).mockReturnValue({ok:true,package:bundle,preview:{
      provider,sourceBoardId:`${provider}-board`,sourceName,importedObjectCount:3,skippedObjectCount:2,
      losses:[
        {code:'UNKNOWN_OBJECT',sourceObjectId:'x1',sourceType:'embed',message:'嵌入内容未导入'},
        {code:'UNKNOWN_OBJECT',sourceObjectId:'x2',sourceType:'embed',message:'嵌入内容未导入'},
        {code:'FORMATTING_REMOVED',sourceObjectId:'x3',message:'部分文字格式已简化'},
      ],
      quality:{complete:{count:0,sampleSourceIds:[]},approximate:{count:1,sampleSourceIds:['x3']},degraded:{count:0,sampleSourceIds:[]},skipped:{count:2,sampleSourceIds:['x1','x2']}},
    }});
    vi.mocked(api.importBoardPackage).mockResolvedValue({board:{...board,id:'8f177ac1-a652-4a6d-9078-fe239ad672bd',name:`${sourceName}（导入）`},importedObjects:3,remappedObjects:3,replayed:false});
    render(<LiveBoard boardId={board.id}/>);await screen.findByTestId('board-import-file');
    fireEvent.change(screen.getByTestId('board-import-file'),{target:{files:[{size:100,text:async()=>JSON.stringify(snapshot)}]}});
    const preview=await screen.findByTestId('vendor-import-preview');
    expect(preview.textContent).toContain(`来自 ${_label} 的“${sourceName}”`);
    expect(preview.textContent).toContain('导入 3 个可编辑对象');
    expect(preview.textContent).toContain('跳过 2 个对象');
    expect(preview.textContent).toContain('始终创建新的 WorkspaceX 白板');
    expect(screen.getByTestId('vendor-import-losses').textContent).toContain('UNKNOWN_OBJECT（2）');
    expect(screen.getByTestId('vendor-import-losses').textContent).toContain('FORMATTING_REMOVED（1）');
    expect(screen.getByTestId('board-import-quality').textContent).toContain('近似 1');
    expect(screen.getByTestId('board-import-quality').textContent).toContain('示例来源：x3');
    expect(screen.getByTestId('board-import-quality').textContent).toContain('跳过 2');
    expect(api.previewBoardImport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('board-import-confirm'));
    await waitFor(()=>expect(api.importBoardPackage).toHaveBeenCalledWith(expect.objectContaining({package:bundle})));
    expect(push).toHaveBeenCalledWith('/studio/board/8f177ac1-a652-4a6d-9078-fe239ad672bd');
  });
  it('rejects an unsupported JSON format locally without sending payload to the API',async()=>{
    render(<LiveBoard boardId={board.id}/>);await screen.findByTestId('board-import-file');
    fireEvent.change(screen.getByTestId('board-import-file'),{target:{files:[{size:10,text:async()=>'{"format":"secret raw payload marker","schemaVersion":99}'}]}});
    const alert=await screen.findByRole('alert');
    expect(alert.textContent).toContain('暂不支持该文件格式');
    expect(alert.textContent).not.toContain('secret raw payload marker');
    expect(convertExternalBoardSnapshot).not.toHaveBeenCalled();
    expect(api.previewBoardImport).not.toHaveBeenCalled();
    expect(api.importBoardPackage).not.toHaveBeenCalled();
  });
  it('keeps converter diagnostics private when a recognized vendor snapshot is invalid',async()=>{
    vi.mocked(convertExternalBoardSnapshot).mockReturnValue({ok:false,code:'INVALID_SNAPSHOT',detail:'private source validation detail'});
    render(<LiveBoard boardId={board.id}/>);await screen.findByTestId('board-import-file');
    fireEvent.change(screen.getByTestId('board-import-file'),{target:{files:[{size:100,text:async()=>'{"format":"miro.rest.board-snapshot"}'}]}});
    const alert=await screen.findByRole('alert');
    expect(alert.textContent).toContain('不是有效的 WorkspaceX、Miro 或 Mural');
    expect(alert.textContent).not.toContain('private source validation detail');
    expect(api.previewBoardImport).not.toHaveBeenCalled();
    expect(api.importBoardPackage).not.toHaveBeenCalled();
  });
  it('rejects an oversized file before reading or converting it',async()=>{
    const text=vi.fn(async()=>'{}');
    render(<LiveBoard boardId={board.id}/>);await screen.findByTestId('board-import-file');
    fireEvent.change(screen.getByTestId('board-import-file'),{target:{files:[{size:16*1024*1024+1,text}]}});
    expect((await screen.findByRole('alert')).textContent).toContain('超过 16 MB');
    expect(text).not.toHaveBeenCalled();
    expect(convertExternalBoardSnapshot).not.toHaveBeenCalled();
    expect(api.previewBoardImport).not.toHaveBeenCalled();
  });
});
