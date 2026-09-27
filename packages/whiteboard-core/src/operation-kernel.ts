import type * as Y from 'yjs';
import {
  WhiteboardOperationRequest,
  WhiteboardOperationReceipt,
  type WhiteboardOperationActor,
  type WhiteboardOperationEvent,
  type WhiteboardOperationReceipt as WhiteboardOperationReceiptValue,
} from '@repo/contracts/whiteboard-operation';
import type { WhiteboardCommand, WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { executeCommands, readObjects } from './document';
import { WhiteboardCommandOrigin } from './command-port';

export type BoardHead = { epoch: number; seq: number };
export type BoardOperationAuthorizer = (actor: WhiteboardOperationActor, boardId: string, commands: readonly WhiteboardCommand[]) => boolean;
export type OperationIds = { operationId: string; eventId: () => string; occurredAt: () => string };
type Accepted = { payload: string; receipt: WhiteboardOperationReceiptValue };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function rotate(value:number,bits:number){return(value>>>bits)|(value<<(32-bits));}
/** Browser-safe SHA-256 so click-time layouts hash identically in browser and API runtimes. */
function sha256(value:string):string{
  const constants=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const source=new TextEncoder().encode(value),bitLength=source.length*8,total=Math.ceil((source.length+9)/64)*64,bytes=new Uint8Array(total);bytes.set(source);bytes[source.length]=0x80;const view=new DataView(bytes.buffer);view.setUint32(total-4,bitLength>>>0);view.setUint32(total-8,Math.floor(bitLength/0x100000000));
  const state=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],words=new Uint32Array(64);
  for(let offset=0;offset<total;offset+=64){for(let i=0;i<16;i++)words[i]=view.getUint32(offset+i*4);for(let i=16;i<64;i++){const a=words[i-15]!,b=words[i-2]!,s0=rotate(a,7)^rotate(a,18)^(a>>>3),s1=rotate(b,17)^rotate(b,19)^(b>>>10);words[i]=(words[i-16]!+s0+words[i-7]!+s1)>>>0;}let[a,b,c,d,e,f,g,h]=state as[number,number,number,number,number,number,number,number];for(let i=0;i<64;i++){const s1=rotate(e,6)^rotate(e,11)^rotate(e,25),choice=(e&f)^(~e&g),t1=(h+s1+choice+constants[i]!+words[i]!)>>>0,s0=rotate(a,2)^rotate(a,13)^rotate(a,22),majority=(a&b)^(a&c)^(b&c),t2=(s0+majority)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}state[0]=(state[0]!+a)>>>0;state[1]=(state[1]!+b)>>>0;state[2]=(state[2]!+c)>>>0;state[3]=(state[3]!+d)>>>0;state[4]=(state[4]!+e)>>>0;state[5]=(state[5]!+f)>>>0;state[6]=(state[6]!+g)>>>0;state[7]=(state[7]!+h)>>>0;}
  return state.map(word=>word.toString(16).padStart(8,'0')).join('');
}
export function stableBoardDigest(prefix: 'object-v1' | 'layout-v1', value: unknown): string { return `${prefix}:${sha256(canonical(value))}`; }
export function digestWhiteboardObject(object: WhiteboardObject): string { return stableBoardDigest('object-v1', object); }

function ids(commands: readonly WhiteboardCommand[]): string[] {
  return [...new Set(commands.map(command => command.type === 'create' ? command.object.id : command.id))];
}
function eventType(commands: readonly WhiteboardCommand[], source: string): WhiteboardOperationEvent['type'] {
  if (source === 'ai-proposal') return 'AIOrganized';
  if (commands.some(command => command.type === 'create' && command.object.kind === 'connector')) return 'ConnectorCreated';
  if (commands.some(command => command.type === 'create' && command.object.kind === 'frame')) return 'PanelCreated';
  if (commands.every(command => command.type === 'create')) return 'ObjectCreated';
  if (commands.every(command => command.type === 'delete')) return 'ObjectDeleted';
  if (commands.some(command => command.type === 'parent')) return 'ObjectsGrouped';
  if (commands.length > 1 && commands.every(command => command.type === 'geometry')) return 'ObjectsArranged';
  if (commands.length === 1 && commands[0]?.type === 'geometry') return 'ObjectMoved';
  return 'ObjectUpdated';
}

/** Pure in-document adapter used by browser, service and agent paths. Durable hosts persist the receipt/events atomically with the update. */
export class WhiteboardOperationKernel {
  private readonly accepted = new Map<string, Accepted>();
  constructor(
    private readonly doc: Y.Doc,
    private head: BoardHead,
    private readonly authorize: BoardOperationAuthorizer,
    private readonly makeIds: () => OperationIds,
  ) {}
  revision(): BoardHead { return { ...this.head }; }
  objects(): WhiteboardObject[] { return readObjects(this.doc); }
  dispatch(untrusted: unknown): WhiteboardOperationReceiptValue {
    const request = WhiteboardOperationRequest.parse(untrusted);
    const payload = canonical(request);
    if (!request.actor.scopes.includes('board:write') || !this.authorize(request.actor, request.boardId, request.commands)) throw new Error('BOARD_OPERATION_FORBIDDEN');
    const previous = this.accepted.get(request.requestId);
    if (previous) {
      if (previous.payload !== payload) throw new Error('BOARD_OPERATION_IDEMPOTENCY_CONFLICT');
      return structuredClone({ ...previous.receipt, replayed: true });
    }
    if (request.expectedRevision.epoch !== this.head.epoch || request.expectedRevision.seq !== this.head.seq) throw new Error('BOARD_OPERATION_STALE_REVISION');
    const id = this.makeIds();
    executeCommands(this.doc, request.commands, new WhiteboardCommandOrigin(request.boardId,request.actor.actorId,request.requestId,id.operationId,id.operationId));
    this.head = { epoch: this.head.epoch, seq: this.head.seq + 1 };
    const event: WhiteboardOperationEvent = {
      eventId: id.eventId(), operationId: id.operationId, requestId: request.requestId,
      boardId: request.boardId, type: eventType(request.commands, request.provenance.source),
      actor: request.actor, objectIds: ids(request.commands), revision: { ...this.head },
      occurredAt: id.occurredAt(), provenance: request.provenance,
    };
    const receipt = WhiteboardOperationReceipt.parse({ operationId: id.operationId, requestId: request.requestId,
      boardId: request.boardId, revision: this.head, replayed: false, events: [event] });
    this.accepted.set(request.requestId, { payload, receipt: structuredClone(receipt) });
    return receipt;
  }
}
