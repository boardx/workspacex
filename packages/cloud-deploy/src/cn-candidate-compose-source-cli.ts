import { emitCandidateComposeSource } from "./cn-candidate-compose-source.js";

/** stdin-only JSON, no file/environment/module selection or external clients. */
export async function candidateComposeMain(args: readonly string[]) {
  if(args.length!==0)throw new Error("CANDIDATE_COMPOSE_REJECTED");
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of process.stdin){
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    size+=bytes.length;if(size>1024*1024)throw new Error("CANDIDATE_COMPOSE_REJECTED");chunks.push(bytes);
  }
  const result=emitCandidateComposeSource(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  process.stdout.write(JSON.stringify(result)+"\n");
}
// A bundled .cjs entry also works when the trusted host executes /proc/self/fd/N.
if(typeof require!=="undefined" && require.main===module){
  candidateComposeMain(process.argv.slice(2)).catch(()=>{
    process.stderr.write("CANDIDATE_COMPOSE_REJECTED\n");process.exitCode=1;
  });
}
