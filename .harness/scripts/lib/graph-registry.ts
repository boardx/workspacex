import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type {
  GraphEdgeTypeDefinition,
  GraphNodeTypeDefinition,
  GraphRegistry,
} from "./graph-types";

interface NodeRegistryFile {
  schema_version: number;
  types: GraphNodeTypeDefinition[];
}

interface EdgeRegistryFile {
  schema_version: number;
  types: GraphEdgeTypeDefinition[];
}

function assertUniqueNames(kind: string, names: string[]): void {
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new Error(`${kind} registry 含重复类型: ${[...new Set(duplicates)].join(", ")}`);
  }
}

export function loadGraphRegistry(repoRoot: string): GraphRegistry {
  const registryDir = join(repoRoot, ".harness", "model", "registry");
  const nodeFile = parse(readFileSync(join(registryDir, "node-types.yaml"), "utf8")) as NodeRegistryFile;
  const edgeFile = parse(readFileSync(join(registryDir, "edge-types.yaml"), "utf8")) as EdgeRegistryFile;
  if (nodeFile?.schema_version !== 1 || !Array.isArray(nodeFile.types)) {
    throw new Error("node-types.yaml 结构非法或版本不受支持");
  }
  if (edgeFile?.schema_version !== 1 || !Array.isArray(edgeFile.types)) {
    throw new Error("edge-types.yaml 结构非法或版本不受支持");
  }
  assertUniqueNames("node", nodeFile.types.map((type) => type.name));
  assertUniqueNames("edge", edgeFile.types.map((type) => type.name));
  const nodeTypeNames = new Set(nodeFile.types.map((type) => type.name));
  for (const type of nodeFile.types) {
    if (!type.name) throw new Error("node registry 含空类型名");
  }
  for (const type of edgeFile.types) {
    if (!type.name) throw new Error("edge registry 含空类型名");
    if (!Array.isArray(type.allowed_pairs)) {
      throw new Error(`edge type ${type.name} 缺少 allowed_pairs`);
    }
    for (const pair of type.allowed_pairs) {
      if (!nodeTypeNames.has(pair.from) || !nodeTypeNames.has(pair.to)) {
        throw new Error(`edge type ${type.name} 引用了未注册端点: ${pair.from} -> ${pair.to}`);
      }
    }
  }
  return { nodeTypes: nodeFile.types, edgeTypes: edgeFile.types };
}
