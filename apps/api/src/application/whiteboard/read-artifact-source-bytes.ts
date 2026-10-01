import type { ObjectStore } from '../artifact/ports';
import type { BoardArtifactSource } from './operation-ports';
import { computeContentHash, versionContentHash } from '../../domain/artifact/content-hash';
import { requiredFiles, storageKey } from '../../domain/artifact/materialization';

/** Chat versions are materialized multi-file artifacts. Their version digest is NOT
 * the SHA of content.md; verify the same ordered parts as the original writer. */
export async function readArtifactSourceBytes(store: Pick<ObjectStore,'get'>, source: BoardArtifactSource): Promise<Uint8Array> {
  if (!source.chatMaterialization) {
    const bytes=await store.get(source.objectKey);
    if (!bytes || computeContentHash(bytes)!==source.contentHash) throw new Error('ARTIFACT_SOURCE_INTEGRITY');
    return bytes;
  }
  const identity=source.chatMaterialization;
  const plan=requiredFiles('ai-generated');
  const primary=plan[0]!;
  if(source.objectKey!==storageKey({...identity,fileName:primary.name}))throw new Error('ARTIFACT_SOURCE_IDENTITY');
  const parts:Uint8Array[]=[];
  for(const file of plan){
    const bytes=await store.get(storageKey({...identity,fileName:file.name}));
    if(!bytes || !bytes.byteLength)throw new Error('ARTIFACT_SOURCE_INTEGRITY');
    parts.push(bytes);
  }
  if(versionContentHash(parts.map(computeContentHash))!==source.contentHash)throw new Error('ARTIFACT_SOURCE_INTEGRITY');
  return parts[0]!;
}
