import { describe, expect, it, vi } from "vitest";
import { getArtifact, listArtifactVersions } from "../../src/application/artifacts-steering/read-artifact";
import { resolveVisibility } from "../../src/application/chat/resolve-visibility";
import { guard } from "../../src/application/security/permission-filter";
import { toOrgId } from "../../src/domain/org-id";
import type { ArtifactReadDeps } from "../../src/application/artifacts-steering/read-artifact";
vi.mock("../../src/application/chat/resolve-visibility",()=>({resolveVisibility:vi.fn()}));
const orgId=toOrgId("org-a");
function setup(observer=true){
  const ref={kind:"project" as const,id:"p"};
  vi.mocked(resolveVisibility).mockResolvedValue({kind:"allow",decision:{observerProjection:observer},thread:{visibilityScope:"plenary"},base:{allowed:true,object:ref}} as unknown as Awaited<ReturnType<typeof resolveVisibility>>);
  const versions=[1,2,3].map(version=>({version,storageKey:`secret-${version}`,changeNote:`note-${version}`}));
  const sourceMessageFacts=vi.fn(async(_org:unknown,_id:unknown,version:number)=>[{id:"m",rawTranscript:version===3,visibilityScope:version===1?"private":null}]);
  const artifacts={findLocator:vi.fn().mockResolvedValue({projectId:"p",threadId:"t"}),
    getArtifact:vi.fn().mockResolvedValue(guard(ref,{artifactId:"a",versions})),
    listVersions:vi.fn().mockResolvedValue(guard(ref,{versions,nextCursor:null})),sourceMessageFacts};
  return {deps:{artifacts} as unknown as ArtifactReadDeps,sourceMessageFacts};
}
describe("artifact observer source scope",()=>{
  it("excludes private source notes/bytes and raw transcript versions",async()=>{
    const {deps}=setup();
    const result=await getArtifact(deps,{orgId,userId:"observer",artifactId:"a"});
    expect(result.versions.map(v=>v.version)).toEqual([2]);
    expect(JSON.stringify(result)).not.toContain("secret-1");
    const page=await listArtifactVersions(deps,{orgId,userId:"observer",artifactId:"a",limit:20,cursor:null});
    expect(page.versions.map(v=>v.version)).toEqual([2]);
  });
  it("denies untraceable sources and private pinned ancestors",async()=>{
    const {deps,sourceMessageFacts}=setup();
    sourceMessageFacts.mockResolvedValue([]);
    await expect(getArtifact(deps,{orgId,userId:"observer",artifactId:"a"})).rejects.toThrow();
    sourceMessageFacts.mockResolvedValue([{id:"base",rawTranscript:false,visibilityScope:"private"}]);
    await expect(getArtifact(deps,{orgId,userId:"observer",artifactId:"a"})).rejects.toThrow();
  });
  it("retains the established full projection for authorized non-observers",async()=>{
    const {deps,sourceMessageFacts}=setup(false);
    expect((await getArtifact(deps,{orgId,userId:"member",artifactId:"a"})).versions).toHaveLength(3);
    expect(sourceMessageFacts).not.toHaveBeenCalled();
  });
});
