import { artifactsSteering as AS } from "@repo/contracts";
import { apiRequest, apiUrl, getStoredSessionToken } from "@/lib/api-client";

export type AgentArtifact = AS.ArtifactPublicRecord;
export type AgentArtifactVersion = AgentArtifact["versions"][number];
export async function listAgentArtifacts(threadId: string, projectId?: string | null, sessionToken?: string, signal?: AbortSignal): Promise<AgentArtifact[]> {
  const response = await apiRequest<{ artifacts: unknown[] }>(`/agent-artifacts/threads/${encodeURIComponent(threadId)}`,
    { query: { projectId: projectId ?? undefined },sessionToken,signal });
  return AS.ArtifactPublicRecord.array().parse(response.artifacts);
}
export async function continueAgentArtifact(artifactId: string, basedOnVersion: number, instruction: string, clientRequestId: string, sessionToken?: string) {
  return AS.ContinueArtifactOutput.parse(await apiRequest(`/artifacts/${encodeURIComponent(artifactId)}/continue`,
    { method: "POST",body: { basedOnVersion,instruction,clientRequestId },sessionToken }));
}
export async function fetchArtifactContent(artifactId: string, version: number, sessionToken?: string, signal?: AbortSignal): Promise<Blob> {
  // Build the known authenticated route locally; never send bearer credentials to a
  // server-provided arbitrary URL or expose an object-store key to the browser.
  const token=sessionToken ?? getStoredSessionToken();
  const response=await fetch(apiUrl(`/artifacts/${encodeURIComponent(artifactId)}/versions/${version}/content`),
    { headers: token ? { Authorization: `Bearer ${token}` } : {},credentials: "include",signal });
  if (!response.ok) throw new Error(`无法读取此版本（HTTP ${response.status}）`);
  return response.blob();
}
export function isTextArtifact(name: string): boolean {
  return /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|css|js|ts|py|sql|log)$/i.test(name);
}

export interface DiffLine { readonly kind: "same" | "added" | "removed"; readonly text: string }
/** Bounded line LCS. The UI explicitly reports clipping, never invents binary diffs. */
export function diffArtifactLines(before: string, after: string, limit=600): { lines: DiffLine[]; truncated: boolean } {
  const old=before.split(/\r?\n/), current=after.split(/\r?\n/);
  const truncated=old.length>limit||current.length>limit;
  const a=old.slice(0,limit), b=current.slice(0,limit);
  const table=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--){
    table[i]![j]=a[i]===b[j]?table[i+1]![j+1]!+1:Math.max(table[i+1]![j]!,table[i]![j+1]!);
  }
  const lines:DiffLine[]=[];let i=0,j=0;
  while(i<a.length||j<b.length){
    if(i<a.length&&j<b.length&&a[i]===b[j]){lines.push({kind:"same",text:a[i++]!});j++;}
    else if(i<a.length&&(j===b.length||table[i+1]![j]!>=table[i]![j+1]!))lines.push({kind:"removed",text:a[i++]!});
    else lines.push({kind:"added",text:b[j++]!});
  }
  return {lines,truncated};
}
