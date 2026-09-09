import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { executeScript } from "../src/execute-script.js";
import { parseInputFiles } from "../src/input-files.js";

describe("immutable source files", () => {
  it("rejects traversal, duplicate names and malformed base64 before execution", () => {
    for (const name of ["../source.pdf","/tmp/source.pdf","a/../b.pdf","a//b.pdf","a/./b.pdf","a/b/",".","..","a\\b"]) {
      expect(() => parseInputFiles([{ name,contentBase64: "YQ==" }])).toThrow();
    }
    expect(() => parseInputFiles([{ name: "source.pdf",contentBase64: "!" }])).toThrow();
    expect(() => parseInputFiles([{ name: "source.pdf",contentBase64: "YQ==" },{ name: "source.pdf",contentBase64: "YQ==" }])).toThrow();
  });
  it("makes selected source readable, denies overwrite, and returns only new output", async () => {
    const result = await executeScript({ timeoutMs: 10_000,inputFiles: [{ name: "source.txt",contentBase64: Buffer.from("original-v1").toString("base64") }],
      script: `const fs=require('fs'),path=require('path');
        const source=path.join(process.env.SKILL_SANDBOX_INPUT_DIR,'source.txt');
        let denied=false;try{fs.writeFileSync(source,'overwritten')}catch(e){denied=e.code==='ERR_ACCESS_DENIED'}
        if(!denied)throw new Error('input was writable');
        fs.writeFileSync(path.join(process.env.SKILL_SANDBOX_OUT_DIR,'revised.txt'),fs.readFileSync(source,'utf8')+'-edited');` });
    expect(result.exitCode).toBe(0);
    expect(result.files.map(file => file.name)).toEqual(["revised.txt"]);
    expect(Buffer.from(result.files[0]!.contentBase64,"base64").toString()).toBe("original-v1-edited");
  });
});

it("reads nested package files without flattening names or allowing writes", async () => {
  const result = await executeScript({ timeoutMs: 10000, inputFiles: [
    { name: "references/value.txt", contentBase64: Buffer.from("reference-v2").toString("base64") },
    { name: "assets/value.txt", contentBase64: Buffer.from("asset-v2").toString("base64") },
  ], script: `const fs=require('fs'),p=require('path');const root=process.env.SKILL_SANDBOX_INPUT_DIR;
    const ref=p.join(root,'references/value.txt');let denied=false;
    try{fs.writeFileSync(ref,'bad')}catch(e){denied=e.code==='ERR_ACCESS_DENIED'}
    if(!denied)throw new Error('nested input writable');
    fs.writeFileSync(p.join(process.env.SKILL_SANDBOX_OUT_DIR,'result.txt'),fs.readFileSync(ref,'utf8')+'|'+fs.readFileSync(p.join(root,'assets/value.txt'),'utf8'));` });
  expect(result.exitCode).toBe(0);
  expect(Buffer.from(result.files[0]!.contentBase64,"base64").toString()).toBe("reference-v2|asset-v2");
});
it("rejects file-directory collisions in either order", () => {
  for (const names of [["references", "references/a.txt"], ["references/a.txt", "references"]])
    expect(() => parseInputFiles(names.map(name => ({name,contentBase64:"YQ=="})))).toThrow();
});

it("preserves portable unicode and space-containing nested paths", () => {
  expect(parseInputFiles([{ name: "参考资料/测试 内容.txt", contentBase64: "YQ==" }])[0]?.name).toBe("参考资料/测试 内容.txt");
});

it("accepts a nested 255-byte filename without the obsolete basename-only 180-character limit", () => {
  const name = "references/" + "a".repeat(251) + ".txt";
  expect(parseInputFiles([{name,contentBase64:"YQ=="}])[0]?.name).toBe(name);
});

it("removes its own staging tree if writing an input fails before the script starts", async () => {
  let failure: NodeJS.ErrnoException | undefined;
  try { await executeScript({timeoutMs:1000,script:"throw new Error('must not run')",inputFiles:[{name:"x".repeat(256),contentBase64:"YQ=="}]}); }
  catch(error) { failure=error as NodeJS.ErrnoException; }
  expect(failure?.code).toBe("ENAMETOOLONG");
  expect(failure?.path).toBeTruthy();
  const root=dirname(dirname(dirname(failure!.path!)));
  await expect(stat(root)).rejects.toMatchObject({code:"ENOENT"});
});
