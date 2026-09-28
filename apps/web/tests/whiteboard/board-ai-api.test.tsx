import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardAIProposalPanel } from '../../components/whiteboard/board-ai-proposal-panel';
import { BoardPresentationControls } from '../../components/whiteboard/board-presentation-controls';
import { clearBoardUndoReceipt, executeBoardOperation, readBoardUndoReceipt, recordBoardUndoReceipt } from '../../lib/whiteboard-operation-client';

const actor={kind:'ai' as const,actorId:'agent-1',orgId:'org-1',role:'editor' as const,scopes:['board:read' as const,'board:write' as const],delegatedBy:'user-1'};
const boardId='00000000-0000-4000-8000-000000000001',requestId='00000000-0000-4000-8000-000000000002';
const proposal={proposalId:requestId,boardId,createdBy:actor,baseRevision:{epoch:1,seq:2},baseObjectDigests:{n1:`object-v1:${'01'.repeat(32)}`},
  action:{type:'arrange' as const,objectIds:['n1'],layout:'grid' as const,commands:[{type:'geometry' as const,id:'n1',geometry:{x:0,y:0,width:100,height:100,rotation:0}}]},
  provenance:{source:'ai-proposal' as const,model:'gpt',skill:'organize',sourceArtifactId:null,sourceRevision:null,layoutHash:null,inputObjectIds:['n1']},status:'preview' as const,createdAt:'2026-09-26T00:00:00.000Z',expiresAt:'2026-09-26T00:05:00.000Z'};
describe('Board AI/API and room controls',()=>{
  beforeEach(()=>vi.restoreAllMocks());
  it('shows a zero-write proposal with before/after diff, provenance and explicit confirm/cancel',()=>{const confirm=vi.fn(),cancel=vi.fn();render(<BoardAIProposalPanel proposal={proposal} onConfirm={confirm} onCancel={cancel}/>);expect(confirm).not.toHaveBeenCalled();expect(screen.getByTestId('board-ai-before')).toHaveTextContent('1 张便利贴');expect(screen.getByTestId('board-ai-after')).toHaveTextContent('尚未修改白板');expect(screen.getByText('技术详情').closest('details')).not.toHaveAttribute('open');expect(screen.getByText('gpt').closest('details')).not.toHaveAttribute('open');fireEvent.click(screen.getByTestId('board-ai-confirm'));fireEvent.click(screen.getByTestId('board-ai-cancel'));expect(confirm).toHaveBeenCalledOnce();expect(cancel).toHaveBeenCalledOnce();});
  it('switches between presenter, follow and free-browse controls',()=>{const leave=vi.fn();render(<BoardPresentationControls state={{boardId,roomId:'room',revision:2,presenterId:'presenter',viewport:{x:0,y:0,zoom:1},followers:['viewer'],updatedAt:'2026-09-26T00:00:00.000Z'}} actorId="viewer" canPresent={false} onClaim={()=>{}} onRelease={()=>{}} onFollow={()=>{}} onLeave={leave} onHandoff={()=>{}}/>);fireEvent.click(screen.getByText('自由浏览'));expect(leave).toHaveBeenCalledOnce();});
  it('calls the versioned operation route and validates the receipt',async()=>{const receipt={operationId:'00000000-0000-4000-8000-000000000010',requestId,boardId,revision:{epoch:1,seq:3},replayed:false,events:[]};vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify(receipt),{status:200,headers:{'content-type':'application/json'}})));
    expect((await executeBoardOperation({apiVersion:'2026-09-01',requestId,boardId,expectedRevision:{epoch:1,seq:2},actor,commands:proposal.action.commands,provenance:proposal.provenance})).revision.seq).toBe(3);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/v1/whiteboards/${boardId}/operations`),expect.objectContaining({method:'POST',credentials:'include'}));});
  it('restores one minimal server-authorized AI undo target after reload and clears it after success',()=>{const operationId='00000000-0000-4000-8000-000000000010',value={operationId,requestId,boardId,revision:{epoch:1,seq:3},replayed:false,events:[],undoReceipt:{undoId:'00000000-0000-4000-8000-000000000011',operationId,boardId,expectedRevision:{epoch:1,seq:3},commands:[{type:'geometry' as const,id:'n1',geometry:{x:1,y:2,width:100,height:100,rotation:0}}],createdAt:'2026-09-26T00:00:00.000Z'}};
    recordBoardUndoReceipt(proposal,value);recordBoardUndoReceipt(proposal,{...value,replayed:true});
    expect(readBoardUndoReceipt(boardId)).toEqual({boardId,proposalId:proposal.proposalId,operationId,expectedRevision:{epoch:1,seq:3},createdAt:'2026-09-26T00:00:00.000Z'});
    expect(sessionStorage.getItem(`board-undo-receipt:${boardId}`)).not.toContain('commands');
    clearBoardUndoReceipt(boardId,operationId);expect(readBoardUndoReceipt(boardId)).toBeNull();
  });
});
