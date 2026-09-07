import { StandardCapabilityDescriptor } from "./standard-capabilities";

/** Verified upstream implementations, not a tool authorization or availability list. */
export const NativeToolIdentities = Object.freeze([
  ["WX-T001", "ls"], ["WX-T002", "read_file"], ["WX-T003", "write_file"],
  ["WX-T004", "edit_file"], ["WX-T005", "glob"], ["WX-T006", "grep"],
  ["WX-T007", "delete"], ["WX-T008", "execute"],
].map(([id, name]) => StandardCapabilityDescriptor.parse({
  id, kind: "tool", canonicalName: name, specVersion: "1.0.0",
  source: { kind: "langchain-native", license: "MIT", revision: "0.7.6",
    locator: `deepagents.middleware.filesystem:FilesystemMiddleware._create_${name}_tool` },
})));

/** Only a verified native invocation may attribute these names to upstream code. */
export function nativeToolProvenance(toolName: string, native: boolean) {
  const capability = native ? NativeToolIdentities.find(item => item.canonicalName === toolName) : undefined;
  return capability ? { capability } : {};
}
