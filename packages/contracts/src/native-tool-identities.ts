import { StandardCapabilityDescriptor } from "./standard-capabilities";

/** Every deepagents workspace tool is a closure built by one factory per name. */
const filesystem = (name: string) => ({ revision: "0.7.6",
  locator: `deepagents.middleware.filesystem:FilesystemMiddleware._create_${name}_tool` });

/** Verified upstream implementations, not a tool authorization or availability list. */
export const NativeToolIdentities = Object.freeze(([
  ["WX-T001", "ls", filesystem("ls")], ["WX-T002", "read_file", filesystem("read_file")],
  ["WX-T003", "write_file", filesystem("write_file")], ["WX-T004", "edit_file", filesystem("edit_file")],
  ["WX-T005", "glob", filesystem("glob")], ["WX-T006", "grep", filesystem("grep")],
  ["WX-T007", "delete", filesystem("delete")], ["WX-T008", "execute", filesystem("execute")],
  // #3014: planning and delegation are upstream too, and neither is shaped like a
  // FilesystemMiddleware factory -- `write_todos` is a pair of module level functions
  // in langchain itself (a different distribution, so a different pinned revision),
  // `task` a closure built by a module level deepagents factory. Leaving them out of
  // this manifest left their catalog clause "never a same-name in-house function"
  // guarding nothing: a same-name replacement passed the verifier unnoticed.
  ["WX-T009", "write_todos", { revision: "1.3.15", locator: "langchain.agents.middleware.todo:_write_todos" }],
  ["WX-T010", "task", { revision: "0.7.6", locator: "deepagents.middleware.subagents:_build_task_tool" }],
] as const).map(([id, name, source]) => StandardCapabilityDescriptor.parse({
  id, kind: "tool", canonicalName: name, specVersion: "1.0.0",
  source: { kind: "langchain-native", license: "MIT", ...source },
})));

/** Only a verified native invocation may attribute these names to upstream code. */
export function nativeToolProvenance(toolName: string, native: boolean) {
  const capability = native ? NativeToolIdentities.find(item => item.canonicalName === toolName) : undefined;
  return capability ? { capability } : {};
}
