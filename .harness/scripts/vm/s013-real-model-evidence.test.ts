import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const vm=import.meta.dirname;
const repoRoot=resolve(vm,'../../..');
const probe=join(vm,'browser-mcp-probe.mjs');
const workflow=readFileSync(join(repoRoot,'.github/workflows/s013-real-model-evidence.yml'),'utf8');
const driver=readFileSync(join(vm,'s013-real-model-evidence.sh'),'utf8');
const digestsFile=join(repoRoot,'apps/browser-runtime/image-digests.env');
const digests=readFileSync(digestsFile,'utf8');

/**
 * #2930: the lane's only "browser runtime" check was that
 * WORKSPACEX_BROWSER_MCP_ENDPOINT was a non-empty string — which the workflow's own `env:`
 * block guarantees. Nothing was listening on that endpoint and nothing in the repo started
 * it, so the failure surfaced as an opaque StandardBrowserError inside the model turn.
 * These are the mechanical checks that keep the runtime owned, probed, and released.
 */
describe('S013 controlled browser runtime lifecycle',()=>{
  it('starts the browser runtime before preflight and always releases it',()=>{
    expect(workflow).toContain('s013-real-model-evidence.sh browser-up');
    expect(workflow).toContain('s013-real-model-evidence.sh browser-down');
    expect(workflow.indexOf('browser-up')).toBeLessThan(workflow.indexOf('.sh preflight'));
    const release=workflow.slice(workflow.indexOf('browser-down')-400,workflow.indexOf('browser-down'));
    expect(release).toContain('if: always()');
    expect(driver).toContain('down -v --remove-orphans');
  });

  it('gates preflight on a real MCP handshake, not on the endpoint string being set',()=>{
    expect(driver).toContain('browser_ready');
    expect(driver).toContain('01-browser-mcp.txt');
  });

  it('keeps the reviewed image digests in exactly one place',()=>{
    const hex=[...digests.matchAll(/\b[0-9a-f]{64}\b/g)].map(match=>match[0]);
    expect(hex.length).toBe(2);
    for(const value of hex){
      expect(readFileSync(join(repoRoot,'apps/browser-runtime/README.md'),'utf8')).not.toContain(value);
      expect(readFileSync(join(repoRoot,'apps/browser-runtime/docker-compose.browser.yml'),'utf8')).not.toContain(value);
      expect(workflow).not.toContain(value);
    }
    expect(digests).toContain('BROWSER_RUNTIME_IMAGE_DIGEST=');
    expect(digests).toContain('BROWSER_EGRESS_PROXY_IMAGE_DIGEST=');
  });
});

describe('browser MCP probe',()=>{
  const run=(endpoint:string)=>spawnSync('node',[probe],{encoding:'utf8',env:{...process.env,WORKSPACEX_BROWSER_MCP_ENDPOINT:endpoint}});

  it('fails when nothing is listening on the endpoint',()=>{
    // Port 1 on loopback: reserved, never bound by this project's stacks.
    const result=run('http://127.0.0.1:1/mcp');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('could not reach the endpoint');
  });

  it('refuses an endpoint that is not the loopback ingress',()=>{
    const result=run('http://example.com/mcp');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not a loopback /mcp endpoint');
  });

  it('fails when the endpoint is unset',()=>{
    const result=spawnSync('node',[probe],{encoding:'utf8',env:{...process.env,WORKSPACEX_BROWSER_MCP_ENDPOINT:''}});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not set');
  });
});

describe('S013 evidence readback does not masquerade as a transport failure',()=>{
  it('stops recording transport failures once best-effort readback starts',()=>{
    const test=readFileSync(join(repoRoot,'apps/api/tests/agent-runtime/browser-skill-real-model.live.ts'),'utf8');
    // The finally-block readback probes six workspace paths, four of which are legitimately
    // absent on a failed run. Each ENOENT is a 404 SESSION_FILE_NOT_FOUND, and before this
    // guard the relay overwrote transport-failure.json with it — burying the real failure
    // under a red herring that cost a full diagnosis cycle (#2930).
    expect(test).toContain('recordTransportFailures');
    expect(test).toContain('recordTransportFailures=false');
  });
});
