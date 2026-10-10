"""Executable Next config and packaging contract checks; no build/readiness claim."""
import json,os,subprocess,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class WebStandalonePackaging(unittest.TestCase):
    def config(self,release):
        env=os.environ.copy()
        for key in list(env):
            if key.startswith(('WORKSPACEX_','FULLSTACK_E2E_','CHAT_READ_E2E_','NEXT_DIST_DIR')):env.pop(key)
        if release:env['WORKSPACEX_RELEASE_BUILD']='1'
        env['FULLSTACK_E2E_API_ORIGIN']='http://127.0.0.1:3200';env['NEXT_PUBLIC_API_URL']='/api'
        script="const {default:c}=await import('./apps/web/next.config.mjs');console.log(JSON.stringify({output:c.output??null,root:c.experimental.outputFileTracingRoot??null,timeout:c.experimental.proxyTimeout,dist:c.distDir,rewrites:await c.rewrites()}))"
        r=subprocess.run(['node','--input-type=module','-e',script],cwd=ROOT,env=env,check=True,capture_output=True,text=True)
        return json.loads(r.stdout)
    def test_release_traces_monorepo_root(self):
        c=self.config(True);self.assertEqual(c['output'],'standalone');self.assertEqual(Path(c['root']).resolve(),ROOT)
    def test_dev_output_and_rewrites_preserved(self):
        dev=self.config(False);release=self.config(True)
        self.assertIsNone(dev['output']);self.assertIsNone(dev['root']);self.assertEqual(dev['rewrites'],release['rewrites']);self.assertEqual(release['timeout'],300000)
    def test_runtime_copies_traced_output_public_static_only(self):
        s=(ROOT/'deploy/aliyun/images/web.Dockerfile').read_text();runtime=s.split('FROM ${NODE_IMAGE} AS runtime\n')[1]
        copies=[line for line in runtime.splitlines() if line.startswith('COPY ')]
        self.assertEqual(len(copies),3)
        for name in ['/.next/standalone ./','/public ./apps/web/public','/.next/static ./apps/web/.next/static']:
            self.assertTrue(any(name in line for line in copies))
        self.assertNotIn('pnpm install',runtime);self.assertNotIn('COPY packages',runtime);self.assertNotIn('COPY apps/web',runtime)
        self.assertIn('USER node',runtime);self.assertIn('CMD ["node", "server.js"]',runtime);self.assertIn('HOSTNAME=0.0.0.0 PORT=3000',runtime)
    def test_sharp_is_explicit_and_locked_for_standalone_image_optimization(self):
        package=json.loads((ROOT/'apps/web/package.json').read_text());self.assertEqual(package['dependencies']['sharp'],'0.34.5')
        lock=(ROOT/'pnpm-lock.yaml').read_text();web=lock.split('  apps/web:\n')[1].split('\n  packages/')[0]
        self.assertIn('      sharp:\n        specifier: 0.34.5\n        version: 0.34.5\n',web)
        self.assertIn('  sharp@0.34.5:',lock)
    def test_builder_requires_actual_standalone_entry(self):
        text=(ROOT/'deploy/aliyun/images/web.Dockerfile').read_text()
        self.assertIn('test -f apps/web/.next/standalone/apps/web/server.js',text)
        self.assertIn('RUN --network=none pnpm --filter @repo/contracts typecheck',text)
if __name__=='__main__':unittest.main()
