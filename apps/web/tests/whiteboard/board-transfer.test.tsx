import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LiveBoard } from '@/components/whiteboard/live-board';
import * as api from '@/lib/live-whiteboard';

const push=vi.fn();
vi.mock('next/navigation',()=>({useRouter:()=>({push})}));
vi.mock('@/components/session/session-provider',()=>({useOptionalSession:()=>({session:{userId:'owner'}})}));
vi.mock('@/lib/whiteboard-provider',()=>({WhiteboardProvider:class{constructor(_doc:unknown,_id:string,onState:(value:unknown)=>void){onState({phase:'synced',pending:0,role:'owner',archived:false,peers:[],reason:null});}awareness(){}close(){}}}));
vi.mock('@/lib/live-whiteboard',()=>({getBoard:vi.fn(),exportBoardPackage:vi.fn(),previewBoardImport:vi.fn(),importBoardPackage:vi.fn()}));

const board={id:'57d83843-21e2-40ae-8c1c-571d0ad63c80',name:'Source',ownerId:'owner',role:'owner' as const,archived:false,createdAt:'2026-09-24T00:00:00.000Z',updatedAt:'2026-09-24T00:00:00.000Z'};
const bundle={format:'workspacex.board' as const,schemaVersion:1 as const,exportedAt:'2026-09-24T00:00:00.000Z',source:{application:'WorkspaceX' as const,boardId:board.id,name:'Source'},objects:[],provenance:{objectCount:0,contentModel:'whiteboard-object.v1' as const}};
beforeEach(()=>{vi.resetAllMocks();vi.mocked(api.getBoard).mockResolvedValue(board);vi.stubGlobal('crypto',{randomUUID:()=>randomUUID()});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

describe('Board portable transfer UI',()=>{
  it('previews loss and explicitly creates a new board instead of replacing the open board',async()=>{
    vi.mocked(api.previewBoardImport).mockResolvedValue({sourceName:'Source',destinationName:'Source（导入）',objectCount:0,frameCount:0,groupCount:0,connectorCount:0,identitiesRemapped:0,contentLosses:[]});
    vi.mocked(api.importBoardPackage).mockResolvedValue({board:{...board,id:'8f177ac1-a652-4a6d-9078-fe239ad672bd',name:'Source（导入）'},importedObjects:0,remappedObjects:0,replayed:false});
    render(<LiveBoard boardId={board.id}/>);await screen.findByTestId('board-import-file');
    const file={size:100,name:'source.json',text:async()=>JSON.stringify(bundle)} as File;
    fireEvent.change(screen.getByTestId('board-import-file'),{target:{files:[file]}});
    expect(await screen.findByText(/不会替换当前白板/)).toBeTruthy();expect(screen.getByText(/内容损失：无/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('board-import-confirm'));
    await waitFor(()=>expect(api.importBoardPackage).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith('/studio/board/8f177ac1-a652-4a6d-9078-fe239ad672bd');
  });
  it('rejects unknown JSON locally without sending a preview request',async()=>{
    render(<LiveBoard boardId={board.id}/>);await screen.findByTestId('board-import-file');
    fireEvent.change(screen.getByTestId('board-import-file'),{target:{files:[{size:10,text:async()=>'{"schemaVersion":99}'}]}});
    expect((await screen.findByRole('alert')).textContent).toContain('不是受支持');
    expect(api.previewBoardImport).not.toHaveBeenCalled();
  });
});
