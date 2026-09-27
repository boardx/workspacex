import { describe, expect, it } from 'vitest';
import type { WhiteboardOperationActor } from '@repo/contracts/whiteboard-operation';
import {
  WhiteboardAIProposalManager, WhiteboardOperationKernel, WhiteboardPresentationSession,
  computeRenderedLayoutHash, createWhiteboardDocument, readObjects, renderedLayoutToCommands,
  stableBoardDigest,
  WhiteboardUndo,
} from '../src';

const boardId = '00000000-0000-4000-8000-000000000001';
const actor: WhiteboardOperationActor = { kind: 'ai', actorId: 'agent-1', orgId: 'org-1', role: 'editor', scopes: ['board:read', 'board:write', 'artifact:read', 'board:present'], delegatedBy: 'user-1' };
const geometry = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
const provenance = { source: 'ai-proposal' as const, model: 'gpt', skill: 'organize', sourceArtifactId: null, sourceRevision: null, layoutHash: null, inputObjectIds: ['n1'] };
function ids() { let event = 2; return () => ({ operationId: '00000000-0000-4000-8000-000000000010', eventId: () => `00000000-0000-4000-8000-${String(event++).padStart(12, '0')}`, occurredAt: () => '2026-09-26T00:00:00.000Z' }); }
function kernel() {
  const doc = createWhiteboardDocument();
  const value = new WhiteboardOperationKernel(doc, { epoch: 1, seq: 0 }, (_actor, id) => id === boardId, ids());
  return { doc, value };
}

describe('shared human/service/AI operation kernel', () => {
  it('uses browser-safe SHA-256 for canonical integrity tokens',()=>expect(stableBoardDigest('layout-v1','abc')).toBe('layout-v1:6cc43f858fbb763301637b5af970e2a46b46f461f27e5a0f41e009c59b827b25'));
  it('applies a batch once, emits an auditable event and rejects stale/changed retries', () => {
    const { doc, value } = kernel();
    const request = { apiVersion: '2026-09-01' as const, requestId: '00000000-0000-4000-8000-000000000011', boardId,
      expectedRevision: { epoch: 1, seq: 0 }, actor, commands: [{ type: 'create' as const, object: { id: 'n1', schemaVersion: 1 as const, kind: 'sticky' as const, geometry, text: 'idea', style: {}, parentId: null, orderKey: '' } }], provenance };
    const receipt = value.dispatch(request), replay = value.dispatch(request);
    expect(receipt.replayed).toBe(false); expect(replay.replayed).toBe(true);
    expect(receipt.events[0]).toMatchObject({ type: 'AIOrganized', objectIds: ['n1'], actor: { kind: 'ai' } });
    expect(readObjects(doc)).toHaveLength(1);
    expect(() => value.dispatch({ ...request, commands: [{ type: 'delete', id: 'n1' }] })).toThrow('BOARD_OPERATION_IDEMPOTENCY_CONFLICT');
    expect(() => value.dispatch({ ...request, requestId: '00000000-0000-4000-8000-000000000012' })).toThrow('BOARD_OPERATION_STALE_REVISION');
    doc.destroy();
  });

  it('keeps preview/cancel at zero writes and confirms one atomic, conflict-checked operation', () => {
    const { doc, value } = kernel();
    value.dispatch({ apiVersion: '2026-09-01', requestId: '00000000-0000-4000-8000-000000000021', boardId, expectedRevision: { epoch: 1, seq: 0 }, actor,
      commands: [{ type: 'create', object: { id: 'n1', schemaVersion: 1, kind: 'sticky', geometry, text: 'raw', style: {}, parentId: null, orderKey: '' } }], provenance });
    const manager = new WhiteboardAIProposalManager(value, () => new Date('2026-09-26T00:00:00.000Z'));
    const p1 = manager.preview({ proposalId: '00000000-0000-4000-8000-000000000022', boardId, actor,
      action: { type: 'label', objectIds: ['n1'], label: 'Theme', commands: [{ type: 'text', id: 'n1', index: 0, deleteCount: 3, insert: 'Theme' }] }, provenance });
    expect(readObjects(doc)[0]?.text).toBe('raw');
    manager.cancel(p1.proposalId, actor.actorId); expect(readObjects(doc)[0]?.text).toBe('raw');
    const p2 = manager.preview({ proposalId: '00000000-0000-4000-8000-000000000023', boardId, actor,
      action: { type: 'label', objectIds: ['n1'], label: 'Theme', commands: [{ type: 'text', id: 'n1', index: 0, deleteCount: 3, insert: 'Theme' }] }, provenance });
    const result = manager.confirm(p2.proposalId, '00000000-0000-4000-8000-000000000024', actor.actorId);
    expect(result.receipt.events).toHaveLength(1); expect(readObjects(doc)[0]?.text).toBe('Theme');
    doc.destroy();
  });

  it('records a confirmed multi-command AI layout as one undo step',()=>{
    const {doc,value}=kernel();value.dispatch({apiVersion:'2026-09-01',requestId:'00000000-0000-4000-8000-000000000041',boardId,expectedRevision:{epoch:1,seq:0},actor,
      commands:[{type:'create',object:{id:'n1',schemaVersion:1,kind:'sticky',geometry,text:'one',style:{},parentId:null,orderKey:'1'}},{type:'create',object:{id:'n2',schemaVersion:1,kind:'sticky',geometry:{...geometry,x:120},text:'two',style:{},parentId:null,orderKey:'2'}}],provenance});
    const undo=new WhiteboardUndo(doc);const manager=new WhiteboardAIProposalManager(value,()=>new Date('2026-09-26T00:00:00.000Z'));
    const proposal=manager.preview({proposalId:'00000000-0000-4000-8000-000000000042',boardId,actor,action:{type:'arrange',objectIds:['n1','n2'],layout:'row',commands:[{type:'geometry',id:'n1',geometry:{...geometry,x:300}},{type:'geometry',id:'n2',geometry:{...geometry,x:524}}]},provenance});
    manager.confirm(proposal.proposalId,'00000000-0000-4000-8000-000000000043',actor.actorId);expect(readObjects(doc).map(object=>object.geometry.x)).toEqual([300,524]);expect(undo.undo()).toBe('undone');expect(readObjects(doc).map(object=>object.geometry.x)).toEqual([0,120]);expect(undo.undo()).toBe('empty');undo.destroy();doc.destroy();
  });

  it('rejects proposal confirmation after a human changes an input object', () => {
    const { doc, value } = kernel();
    value.dispatch({ apiVersion: '2026-09-01', requestId: '00000000-0000-4000-8000-000000000031', boardId, expectedRevision: { epoch: 1, seq: 0 }, actor,
      commands: [{ type: 'create', object: { id: 'n1', schemaVersion: 1, kind: 'sticky', geometry, text: 'raw', style: {}, parentId: null, orderKey: '' } }], provenance });
    const manager = new WhiteboardAIProposalManager(value, () => new Date('2026-09-26T00:00:00.000Z'));
    const proposal = manager.preview({ proposalId: '00000000-0000-4000-8000-000000000032', boardId, actor,
      action: { type: 'arrange', objectIds: ['n1'], layout: 'grid', commands: [{ type: 'geometry', id: 'n1', geometry: { ...geometry, x: 200 } }] }, provenance });
    value.dispatch({ apiVersion: '2026-09-01', requestId: '00000000-0000-4000-8000-000000000033', boardId, expectedRevision: { epoch: 1, seq: 1 }, actor: { ...actor, kind: 'human', actorId: 'user-1', delegatedBy: null },
      commands: [{ type: 'style', id: 'n1', style: { fill: '#ffff00' } }], provenance: { ...provenance, source: 'human' } });
    expect(() => manager.confirm(proposal.proposalId, '00000000-0000-4000-8000-000000000034', actor.actorId)).toThrow('BOARD_AI_PROPOSAL_CONFLICT');
    doc.destroy();
  });
  it('binds proposal idempotency to actor and payload',()=>{const{doc,value}=kernel();const manager=new WhiteboardAIProposalManager(value,()=>new Date('2026-09-26T00:00:00.000Z')),input={proposalId:'00000000-0000-4000-8000-000000000099',boardId,actor,action:{type:'generate' as const,commands:[{type:'create' as const,object:{id:'new',schemaVersion:1 as const,kind:'sticky' as const,geometry,text:'new',style:{},parentId:null,orderKey:''}}]},provenance};expect(manager.preview(input).proposalId).toBe(input.proposalId);expect(manager.preview(input).proposalId).toBe(input.proposalId);expect(()=>manager.preview({...input,actor:{...actor,actorId:'other'}})).toThrow('IDEMPOTENCY_CONFLICT');expect(()=>manager.preview({...input,action:{...input.action,commands:[{type:'create',object:{...input.action.commands[0]!.object,text:'changed'}}]}})).toThrow('IDEMPOTENCY_CONFLICT');doc.destroy();});
});

describe('Chat artifact handoff and meeting-room presentation', () => {
  it.each(['flowchart', 'sequence', 'persona'] as const)('preserves %s click-time identities, geometry and layout hash', diagramKind => {
    const body = { schemaVersion: 1 as const, artifactId: `chat-${diagramKind}`, orgId: 'org-1', sourceRevision: 'r9', diagramKind,
      objects: [
        { sourceId: 'a', kind: 'node' as const, geometry: { x: 10, y: 20, width: 100, height: 50, rotation: 0 }, text: 'A', style: { fill: '#ffffff' } as Record<string, string | number | boolean | null>, fromSourceId: null, toSourceId: null },
        { sourceId: 'b', kind: 'node' as const, geometry: { x: 220, y: 20, width: 100, height: 50, rotation: 0 }, text: 'B', style: {} as Record<string, string | number | boolean | null>, fromSourceId: null, toSourceId: null },
        { sourceId: 'edge-a-b', kind: 'edge' as const, geometry: { x: 110, y: 45, width: 110, height: 1, rotation: 0 }, text: 'uses', style: {} as Record<string, string | number | boolean | null>, fromSourceId: 'a', toSourceId: 'b' },
      ], selectedSourceIds: [] };
    const layout = { ...body, layoutHash: computeRenderedLayoutHash(body) };
    const commands = renderedLayoutToCommands(layout, actor, 'org-1', { x: 5, y: 7 });
    expect(commands.map(command => command.type === 'create' ? command.object.id : '')).toEqual([
      `artifact_chat-${diagramKind}_a`, `artifact_chat-${diagramKind}_b`, `artifact_chat-${diagramKind}_edge-a-b`,
    ]);
    expect(commands[0]).toMatchObject({ object: { geometry: { x: 15, y: 27 }, extensionData: { content: { layoutHash: layout.layoutHash, sourceId: 'a' } } } });
    expect(commands[2]).toMatchObject({ object: { connector: { from: `artifact_chat-${diagramKind}_a`, to: `artifact_chat-${diagramKind}_b` } } });
  });

  it('fails closed on layout tampering, cross-org insertion and normalized identity collisions',()=>{
    const body={schemaVersion:1 as const,artifactId:'chat',orgId:'org-1',sourceRevision:'r1',diagramKind:'fabric' as const,objects:[{sourceId:'a/b',kind:'node' as const,geometry:{x:0,y:0,width:10,height:10,rotation:0},text:'a',style:{},fromSourceId:null,toSourceId:null},{sourceId:'a?b',kind:'node' as const,geometry:{x:20,y:0,width:10,height:10,rotation:0},text:'b',style:{},fromSourceId:null,toSourceId:null}],selectedSourceIds:[]};
    const layout={...body,layoutHash:computeRenderedLayoutHash(body)};expect(()=>renderedLayoutToCommands({...layout,objects:[{...layout.objects[0]!,text:'tampered'},layout.objects[1]!]},actor,'org-1')).toThrow('BOARD_ARTIFACT_LAYOUT_HASH_MISMATCH');expect(()=>renderedLayoutToCommands(layout,actor,'org-2')).toThrow('BOARD_ARTIFACT_FORBIDDEN');expect(()=>renderedLayoutToCommands(layout,actor,'org-1')).toThrow('BOARD_ARTIFACT_ID_COLLISION');
  });

  it('supports presenter claim, viewport follow, leave and handoff with optimistic revisions', () => {
    const session = new WhiteboardPresentationSession({ boardId, roomId: 'room-a', revision: 0, presenterId: null,
      viewport: { x: 0, y: 0, zoom: 1 }, followers: [], updatedAt: '2026-09-26T00:00:00.000Z' }, () => true, () => '2026-09-26T00:00:01.000Z');
    expect(session.dispatch({ type: 'claim-presenter', actorId: actor.actorId, expectedRevision: 0 }, actor).presenterId).toBe(actor.actorId);
    const viewer = { ...actor, kind: 'human' as const, actorId: 'viewer-1', scopes: ['board:read' as const] };
    expect(session.dispatch({ type: 'follow', actorId: viewer.actorId, expectedRevision: 1 }, viewer).followers).toEqual(['viewer-1']);
    expect(session.dispatch({ type: 'viewport', actorId: actor.actorId, viewport: { x: 40, y: 60, zoom: 2 }, expectedRevision: 2 }, actor).viewport.zoom).toBe(2);
    expect(session.dispatch({ type: 'leave-follow', actorId: viewer.actorId, expectedRevision: 3 }, viewer).followers).toEqual([]);
    expect(session.dispatch({ type: 'handoff', actorId: actor.actorId, toActorId: 'room-display', expectedRevision: 4 }, actor).presenterId).toBe('room-display');
    expect(() => session.dispatch({ type: 'viewport', actorId: actor.actorId, viewport: { x: 0, y: 0, zoom: 1 }, expectedRevision: 4 }, actor)).toThrow('BOARD_PRESENTATION_CONFLICT');
  });
});
