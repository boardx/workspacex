import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HistoryPanel } from '@/components/whiteboard/history-panel';
import * as api from '@/lib/live-whiteboard';

const push=vi.fn();
vi.mock('next/navigation',()=>({useRouter:()=>({push})}));
vi.mock('@/lib/live-whiteboard',()=>({listBoardCheckpoints:vi.fn(),getBoardHistoryHead:vi.fn(),createBoardCheckpoint:vi.fn(),previewBoardCheckpoint:vi.fn(),compareBoardCheckpoint:vi.fn(),restoreBoardCheckpoint:vi.fn()}));
const digest='a'.repeat(64),boardId='11111111-1111-4111-8111-111111111111',checkpointId='22222222-2222-4222-8222-222222222222';
const checkpoint:api.BoardCheckpoint={id:checkpointId,boardId,epoch:1,seq:3,headDigest:digest,contentDigest:digest,byteLength:100,objectCount:1,blobVersion:1,createdAt:'2026-09-24T00:00:00.000Z',creatorId:'facilitator',label:'会后定稿',reason:'工作坊主持人确认',retentionUntil:'2027-09-24T00:00:00.000Z',retentionState:'active',sourceBoardId:null,sourceCheckpointId:null};
beforeEach(()=>{vi.resetAllMocks();vi.mocked(api.listBoardCheckpoints).mockResolvedValue([checkpoint]);vi.mocked(api.getBoardHistoryHead).mockResolvedValue({epoch:1,seq:3,digest});vi.mocked(api.previewBoardCheckpoint).mockResolvedValue({checkpoint,objects:[]});vi.mocked(api.compareBoardCheckpoint).mockResolvedValue({from:{checkpointId,contentDigest:digest},to:{kind:'current',head:{epoch:1,seq:4,digest}},added:1,modified:2,deleted:3,changes:[]});vi.mocked(api.restoreBoardCheckpoint).mockResolvedValue({restoreId:'33333333-3333-4333-8333-333333333333',sourceBoardId:boardId,sourceCheckpointId:checkpointId,restoredBoardId:'44444444-4444-4444-8444-444444444444',restoredCheckpointId:'55555555-5555-4555-8555-555555555555',actorId:'facilitator',reason:'恢复副本',createdAt:'2026-09-24T00:00:00.000Z',replayed:false});});
afterEach(cleanup);
describe('Board history panel',()=>{
  it('shows audit metadata and object-level comparison without snapshot bytes',async()=>{render(<HistoryPanel boardId={boardId} boardName="Workshop" canEdit onClose={()=>{}}/>);expect(await screen.findByText('会后定稿')).toBeTruthy();expect(screen.getByText(/facilitator/)).toBeTruthy();expect(screen.getByText(/工作坊主持人确认/)).toBeTruthy();fireEvent.click(screen.getByText('与当前比较'));expect(await screen.findByText(/新增 1 · 修改 2 · 删除 3/)).toBeTruthy();expect(api.previewBoardCheckpoint).not.toHaveBeenCalled();});
  it('restores into a new Board and navigates to it',async()=>{render(<HistoryPanel boardId={boardId} boardName="Workshop" canEdit onClose={()=>{}}/>);fireEvent.click(await screen.findByText('创建恢复副本'));await waitFor(()=>expect(api.restoreBoardCheckpoint).toHaveBeenCalledWith(boardId,checkpointId,expect.objectContaining({sourceContentDigest:digest,boardName:'Workshop · 恢复副本'})));expect(push).toHaveBeenCalledWith('/studio/board/44444444-4444-4444-8444-444444444444');});
});
