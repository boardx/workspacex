import { describe, expect, it } from "vitest";
import { executeScript } from "../src/execute-script.js";
import { parseInputFiles } from "../src/input-files.js";

describe("immutable source files", () => {
  it("rejects traversal, duplicate names and malformed base64 before execution", () => {
    for (const name of ["../source.pdf","/tmp/source.pdf","a/b.pdf",".","..","a\\b"]) {
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
