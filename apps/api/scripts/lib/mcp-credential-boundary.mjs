import ts from 'typescript';
export const MCP_CREDENTIAL_BOUNDARIES=new Set(['src/infrastructure/mcp/mcp-credential-execution-broker.ts','src/infrastructure/mcp/http-mcp-execution-core.ts']);
export function checkMcpCredentialBoundary(path,source){
 if(path.endsWith('http-mcp-execution-core.ts'))return checkMcpWorkerCredentialBoundary(source);
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true),nodes=[],errors=[];const walk=n=>{nodes.push(n);ts.forEachChild(n,walk);};walk(ast);
 const text=n=>n?.getText(ast).replace(/\s+/g,'');
 const queries=nodes.filter(n=>ts.isCallExpression(n)&&text(n.expression)?.endsWith('.query'));
 if(queries.length!==1)errors.push('exact single credential claim');
 const q=queries[0];
 if(!q||text(q.expression)!=='this.#pool.query'||!ts.isStringLiteralLike(q.arguments[0])||q.arguments[0].text!=='SELECT ciphertext,algorithm,key_id,revision,endpoint FROM public.kernel_claim_mcp_credential($1,$2,$3,$4,$5,$6,$7,$8)'||text(q.arguments[1])!=='[identity.orgId,identity.runId,identity.toolCallId,identity.attemptId,identity.leaseEpoch,frozen.credentialRevision,frozen.runtime.name,mcpExecutionDigest(args)]')errors.push('receipt-bound secret read');
 if(!source.includes("config.user!=='mcp_executor'"))errors.push('separate role');
 if(!source.includes('readonly #pool:Pool;readonly #key:Buffer;'))errors.push('private handles');
 if(!source.includes('sealed.key_id!==this.#keyId||sealed.revision!==frozen.credentialRevision||sealed.endpoint!==frozen.endpoint||control.signal.aborted'))errors.push('generation and endpoint binding');
 const methods=nodes.filter(ts.isMethodDeclaration).map(n=>text(n.name)).sort();
 if(JSON.stringify(methods)!==JSON.stringify(['close','onModuleDestroy']))errors.push('no additional credential surface');
 const returns=nodes.filter(ts.isReturnStatement);
 for(const n of returns){if(text(n.expression)?.startsWith('sealed')||text(n.expression)?.startsWith('this.#'))errors.push('secret output');}
 if(!source.includes("catch{throw new Error('mcp_execution_unconfirmed');}"))errors.push('error redaction');
 if(!source.includes('await executeSealedMcp(frozen,args,')||!source.includes('this.options,control)'))errors.push('bounded transport');
 return errors;
}
export function checkMcpWorkerCredentialBoundary(source){
 const ast=ts.createSourceFile('worker.ts',source,ts.ScriptTarget.Latest,true),nodes=[],errors=[];const walk=n=>{nodes.push(n);ts.forEachChild(n,walk);};walk(ast);
 const inverse=nodes.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='decryptForTransport');
 if(!inverse||inverse.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword))errors.push('inverse must stay private');
 const calls=nodes.filter(n=>ts.isCallExpression(n)&&n.expression.getText(ast)==='decryptForTransport');
 if(calls.length!==1)errors.push('single transport consumer');
 if(!source.includes('reflectsMcpCredential(result,credential)')||!source.includes('reflectsMcpCredential(listed,credential)'))errors.push('direct reflection denial');
 if(!source.includes('requestInit:credential?{headers:{authorization:`Bearer ${credential}`}}:undefined'))errors.push('auth transport only');
 if(!source.includes('key.fill(0);value?.fill(0);'))errors.push('buffer clearing');
 return errors;
}
