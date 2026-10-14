import * as Y from 'yjs';
import { WhiteboardMindmapCommand } from '@repo/contracts/whiteboard-document';
import { BoardCommandPort, type BoardCommandAccepted } from './command-port';
import { readObjects } from './document';

export function mindmapStateVector(doc: Y.Doc): string {
  return Array.from(Y.encodeStateVector(doc), byte => byte.toString(16).padStart(2, '0')).join('');
}
export interface MindmapCommandEnvelope {
  boardId: string;
  clientId: string;
  gestureId: string;
  command: WhiteboardMindmapCommand;
}
/** Layout/planning is pure; this port owns stale-state rejection and one atomic transaction. */
export class MindmapCommandPort {
  private readonly accepted = new Map<string, {payload:string;result:BoardCommandAccepted}>();
  constructor(private readonly doc: Y.Doc, private readonly port = new BoardCommandPort(doc)) {}
  dispatch(input: MindmapCommandEnvelope): BoardCommandAccepted {
    const command = WhiteboardMindmapCommand.parse(input.command);
    const key = JSON.stringify([input.boardId,input.clientId,input.gestureId]);
    const payload = JSON.stringify(command);
    const previous = this.accepted.get(key);
    if (previous) {
      if (previous.payload !== payload) throw new Error('BOARD_COMMAND_INVALID');
      return structuredClone(previous.result);
    }
    if (mindmapStateVector(this.doc) !== command.expectedStateVector) throw new Error('MINDMAP_STALE_REVISION');
    const objects = new Map(readObjects(this.doc).map(object => [object.id, object]));
    for (const primitive of command.commands) {
      const object = primitive.type === 'create' ? primitive.object : objects.get(primitive.id);
      if (!object) throw new Error('OBJECT_NOT_FOUND');
      const metadata = object.extensionData?.mindmap as {treeId?:string} | undefined;
      if (metadata?.treeId !== command.treeId) throw new Error('MINDMAP_CROSS_TREE_COMMAND');
    }
    const result = this.port.dispatch({ boardId: input.boardId, clientId: input.clientId, gestureId: input.gestureId, commands: command.commands });
    this.accepted.set(key,{payload,result:structuredClone(result)});
    return result;
  }
}
