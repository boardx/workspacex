import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { CanvasReadOutput, CanvasUpdateOutput, type CanvasReadInput, type CanvasUpdateInput } from '@repo/contracts/standard-canvas-tools';
import type { OrgId } from '../../domain/org-id';
import { getCanvasSource, type GetCanvasSourceDeps } from '../canvas/get-canvas-source';
import { renderCanvas } from '../canvas/render-canvas';
import { updateCanvasSource, authorizeCanvasSourceUpdate } from '../canvas/update-canvas-source';
import { CanvasError } from '../canvas/errors';
export const STANDARD_CANVAS_SERVICE = Symbol('StandardCanvasService');
interface Actor { orgId: OrgId; userId: string; }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Adapter to existing versioned canvas source. No second parser or canvas storage. */
export class StandardCanvasService {
  constructor(private deps: GetCanvasSourceDeps) {}
  async read(actor: Actor, input: z.infer<typeof CanvasReadInput>) {
    const source = await getCanvasSource(this.deps, {...actor, instanceId:input.canvasId});
    const version = await this.deps.instances.findVersion(actor.orgId,input.canvasId,source.versionId);
    if (!version) throw new CanvasError('INSTANCE_NOT_FOUND');
    // Both projections address the same immutable version, even if the head moves.
    const renderSource = await renderCanvas(this.deps,{...actor,instanceId:input.canvasId,versionId:source.versionId});
    return CanvasReadOutput.parse({canvasId:input.canvasId,source:source.markdown,revision:version.version,
      versionId:source.versionId,contentHash:source.contentHash,supportedOperations:['replace-source'],renderSource});
  }
  async update(actor: Actor, input: z.infer<typeof CanvasUpdateInput>) {
    // Read authorization is also required on idempotent replay, so revoked readers learn nothing.
    await getCanvasSource(this.deps,{...actor,instanceId:input.canvasId});
    await authorizeCanvasSourceUpdate({identity:this.deps.auth.repo,instances:this.deps.instances},{...actor,instanceId:input.canvasId});
    const versionId = 'cvtool-'+hash(JSON.stringify([actor.orgId,actor.userId,input.canvasId,input.idempotencyKey]));
    const contentHash=hash(input.changes.markdown);
    const replay = async () => {
      const version=await this.deps.instances.findVersion(actor.orgId,input.canvasId,versionId);
      if (!version) return null;
      if(version.contentHash!==contentHash || version.version!==input.expectedRevision+1) throw new Error('canvas_idempotency_conflict');
      return CanvasUpdateOutput.parse({newRevision:version.version,versionId,contentHash,replayed:true});
    };
    const prior=await replay(); if(prior) return prior;
    try {
      const result=await updateCanvasSource({identity:this.deps.auth.repo,instances:this.deps.instances,newVersionId:()=>versionId},
        {...actor,instanceId:input.canvasId,markdown:input.changes.markdown,expectedHeadVersion:input.expectedRevision});
      return CanvasUpdateOutput.parse({newRevision:input.expectedRevision+1,versionId:result.versionId,contentHash:result.contentHash,replayed:false});
    } catch (error) {
      // A concurrent same-key request or lost write acknowledgement can be resolved from the existing immutable version.
      const completed=await replay(); if(completed) return completed;
      throw error;
    }
  }
}
