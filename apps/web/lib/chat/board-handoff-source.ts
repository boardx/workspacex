import { boardTransportTitle } from './board-transport-identity';
import { useMemo } from 'react';
import { getThreadArtifactSource, landAsArtifact } from '@/lib/live-chat';

type SourceInput = {threadId:string;messageId:string;projectId?:string;bearer:string;source:string;title:string};

/** Confirmation-only preparation; retain a successful landing across readback failures. */
export function createBoardHandoffSourcePreparer(input: SourceInput) {
  let artifactId: string | undefined;
  return async () => {
    if (!artifactId) {
      const landed = await landAsArtifact(input.threadId, {
        messageId:input.messageId,mode:'draft',title:boardTransportTitle(input.title),payloadRef:input.source,
      },input.bearer);
      artifactId = landed.artifactId;
    }
    const verified = await getThreadArtifactSource(input.threadId,artifactId,input.projectId??null,input.bearer);
    if (!verified.immutableRevision) throw new Error('BOARD_SOURCE_REVISION_UNAVAILABLE');
    return {artifactId,sourceRevision:verified.immutableRevision};
  };
}

export function useBoardHandoffSource(input: SourceInput | undefined) {
  const {threadId,messageId,projectId,bearer,source,title}=input??{};
  return useMemo(()=>threadId&&messageId&&bearer!==undefined&&source!==undefined&&title!==undefined
    ?createBoardHandoffSourcePreparer({threadId,messageId,projectId,bearer,source,title}):undefined,
  [threadId,messageId,projectId,bearer,source,title]);
}
