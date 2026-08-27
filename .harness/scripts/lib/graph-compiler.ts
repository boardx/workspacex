import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse } from "yaml";
import type { Feature, FeatureList, Roadmap, RoadmapPhase } from "./types";
import type { GraphEdge, GraphNode, GraphSnapshot, GraphSource } from "./graph-types";
import { createGraphSnapshot, graphEdgeId, sha256 } from "./graph-stable";

function source(path: string, pointer: string): GraphSource {
  return { path: path.split(sep).join("/"), pointer };
}

function component(value: string): string {
  return encodeURIComponent(value.trim());
}

export function projectNodeId(project: string): string {
  return `urn:wsx:harness:project:${component(project)}`;
}

export function phaseNodeId(phaseId: string): string {
  return `urn:wsx:harness:phase:${component(phaseId)}`;
}

export function featureNodeId(phaseId: string, featureId: string): string {
  return `urn:wsx:harness:feature:${component(phaseId)}:${component(featureId)}`;
}

export function verificationNodeId(phaseId: string, featureId: string, command: string): string {
  return `urn:wsx:harness:verification:${component(phaseId)}:${component(featureId)}:${sha256(command).slice(0, 16)}`;
}

function externalReferenceNodeId(phaseId: string, raw: string): string {
  return `urn:wsx:harness:external-reference:${component(phaseId)}:${sha256(raw).slice(0, 16)}`;
}

function addEdge(
  edges: GraphEdge[],
  type: string,
  from: string,
  to: string,
  edgeSource: GraphSource,
  properties: Record<string, unknown> = {}
): void {
  edges.push({
    id: graphEdgeId(type, from, to, properties),
    type,
    from,
    to,
    properties,
    source: edgeSource,
  });
}

function resolveStructuredFeatureDependency(raw: string, currentPhaseId: string): { phaseId: string; featureId: string } | null {
  const local = raw.match(/^(F\d+)$/);
  if (local) return { phaseId: currentPhaseId, featureId: local[1]! };
  const crossPhase = raw.match(/^p?(\d+):(F\d+)(?:\s+.*)?$/);
  if (!crossPhase) return null;
  return {
    phaseId: crossPhase[1]!.padStart(2, "0"),
    featureId: crossPhase[2]!,
  };
}

function compileFeature(
  phase: RoadmapPhase,
  feature: Feature,
  featureIndex: number,
  featurePath: string,
  nodes: GraphNode[],
  edges: GraphEdge[]
): void {
  const featureId = featureNodeId(phase.id, feature.id);
  const featurePointer = `/features/${featureIndex}`;
  nodes.push({
    id: featureId,
    type: "Feature",
    properties: {
      area: feature.area,
      owner: feature.owner,
      priority: feature.priority,
      sprint: feature.sprint,
      status: feature.status,
      title: feature.title,
    },
    source: source(featurePath, featurePointer),
  });
  addEdge(
    edges,
    "contains",
    phaseNodeId(phase.id),
    featureId,
    source(featurePath, featurePointer)
  );

  for (const [depIndex, rawDependency] of (feature.depends_on ?? []).entries()) {
    const dependency = resolveStructuredFeatureDependency(rawDependency, phase.id);
    let targetId: string;
    if (dependency) {
      targetId = featureNodeId(dependency.phaseId, dependency.featureId);
    } else {
      targetId = externalReferenceNodeId(phase.id, rawDependency);
      nodes.push({
        id: targetId,
        type: "ExternalReference",
        properties: { label: rawDependency },
        source: source(featurePath, `${featurePointer}/depends_on/${depIndex}`),
      });
    }
    addEdge(
      edges,
      "depends_on",
      featureId,
      targetId,
      source(featurePath, `${featurePointer}/depends_on/${depIndex}`)
    );
  }

  for (const [verificationIndex, command] of feature.verification.entries()) {
    const verificationId = verificationNodeId(phase.id, feature.id, command);
    nodes.push({
      id: verificationId,
      type: "Verification",
      properties: { command },
      source: source(featurePath, `${featurePointer}/verification/${verificationIndex}`),
    });
    addEdge(
      edges,
      "verified_by",
      featureId,
      verificationId,
      source(featurePath, `${featurePointer}/verification/${verificationIndex}`)
    );
  }
}

export interface RepositoryGraphInput {
  project: string;
  phases: Array<{
    phase: RoadmapPhase;
    featureList?: FeatureList;
    featurePath?: string;
    /** `harness archive-passing` 挪出的已 passing feature（见 archive-passing.ts）。
     *  独立的 featureList/featurePath 对，保证 source 指针指向它们真正所在的文件，
     *  而不是把归档记录的 provenance 假称成 live 文件里的某个下标。 */
    archiveFeatureList?: FeatureList;
    archiveFeaturePath?: string;
  }>;
  roadmapPath?: string;
}

export function compileGraphInput(input: RepositoryGraphInput, sourceRevision: string): GraphSnapshot {
  const roadmapPath = input.roadmapPath ?? ".harness/state/roadmap.yaml";
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const projectId = projectNodeId(input.project);
  nodes.push({
    id: projectId,
    type: "Project",
    properties: { name: input.project },
    source: source(roadmapPath, "/project"),
  });

  for (const [phaseIndex, item] of input.phases.entries()) {
    const phase = item.phase;
    const phaseId = phaseNodeId(phase.id);
    nodes.push({
      id: phaseId,
      type: "Phase",
      properties: {
        goal: phase.goal,
        name: phase.name,
        slug: phase.slug,
        status: phase.status,
      },
      source: source(roadmapPath, `/phases/${phaseIndex}`),
    });
    addEdge(edges, "contains", projectId, phaseId, source(roadmapPath, `/phases/${phaseIndex}`));
    for (const [dependencyIndex, dependencyId] of phase.depends_on.entries()) {
      addEdge(
        edges,
        "depends_on",
        phaseId,
        phaseNodeId(dependencyId),
        source(roadmapPath, `/phases/${phaseIndex}/depends_on/${dependencyIndex}`)
      );
    }
    if (item.featureList && item.featurePath) {
      for (const [featureIndex, feature] of item.featureList.features.entries()) {
        compileFeature(phase, feature, featureIndex, item.featurePath, nodes, edges);
      }
    }
    if (item.archiveFeatureList && item.archiveFeaturePath) {
      for (const [featureIndex, feature] of item.archiveFeatureList.features.entries()) {
        compileFeature(phase, feature, featureIndex, item.archiveFeaturePath, nodes, edges);
      }
    }
  }

  // Natural-language dependency labels may repeat across features. Only those synthesized
  // ExternalReference nodes are coalesced. Authored duplicate Phase/Feature/Verification IDs must
  // remain visible so HGC-IDENTITY can reject them instead of the compiler hiding bad input.
  const externalIds = new Set<string>();
  const uniqueNodes = nodes.filter((node) => {
    if (node.type !== "ExternalReference") return true;
    if (externalIds.has(node.id)) return false;
    externalIds.add(node.id);
    return true;
  });
  return createGraphSnapshot(sourceRevision, uniqueNodes, edges);
}

function findPhaseDirectory(repoRoot: string, phaseId: string): string | null {
  const phasesDir = join(repoRoot, "phases");
  const directory = readdirSync(phasesDir).find((entry) => entry.startsWith(`phase-${phaseId}-`));
  return directory ? join(phasesDir, directory) : null;
}

export function repositoryRevision(repoRoot: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

export function compileRepositoryGraph(repoRoot: string, sourceRevision = repositoryRevision(repoRoot)): GraphSnapshot {
  const roadmapAbsolutePath = join(repoRoot, ".harness", "state", "roadmap.yaml");
  const roadmap = parse(readFileSync(roadmapAbsolutePath, "utf8")) as Roadmap;
  if (!roadmap || !Array.isArray(roadmap.phases)) throw new Error("roadmap.yaml 结构非法");
  const phases: RepositoryGraphInput["phases"] = roadmap.phases.map((phase) => {
    const phaseDirectory = findPhaseDirectory(repoRoot, phase.id);
    if (!phaseDirectory) return { phase };
    const absoluteFeaturePath = join(phaseDirectory, "feature_list.json");
    if (!existsSync(absoluteFeaturePath)) return { phase };
    const featureList = JSON.parse(readFileSync(absoluteFeaturePath, "utf8")) as FeatureList;
    if (!Array.isArray(featureList.features)) {
      throw new Error(`${relative(repoRoot, absoluteFeaturePath)} 结构非法`);
    }
    // 已 passing 的 feature 可能被 `harness archive-passing` 挪进同目录的
    // feature_list.archive.json（只是搬家，不是第二份事实源）——图快照必须把它们也
    // 编译进来，否则归档一次，Feature/Verification 节点就凭空消失一批（HGC 完整性门就是
    // 靠这些节点数兜底的，见 graph-integration.test.ts）。
    const absoluteArchivePath = join(phaseDirectory, "feature_list.archive.json");
    let archiveFeatureList: FeatureList | undefined;
    let archiveFeaturePath: string | undefined;
    if (existsSync(absoluteArchivePath)) {
      archiveFeatureList = JSON.parse(readFileSync(absoluteArchivePath, "utf8")) as FeatureList;
      if (!Array.isArray(archiveFeatureList.features)) {
        throw new Error(`${relative(repoRoot, absoluteArchivePath)} 结构非法`);
      }
      archiveFeaturePath = relative(repoRoot, absoluteArchivePath);
    }
    return {
      phase,
      featureList,
      featurePath: relative(repoRoot, absoluteFeaturePath),
      archiveFeatureList,
      archiveFeaturePath,
    };
  });
  return compileGraphInput(
    {
      project: String(roadmap.project),
      phases,
      roadmapPath: relative(repoRoot, roadmapAbsolutePath),
    },
    sourceRevision
  );
}
