"""Release typechecking must cover application roots, not server-only E2E fixtures."""
from pathlib import Path
import json
import subprocess
import unittest
ROOT=Path(__file__).resolve().parents[1]

class WebBuilderImports(unittest.TestCase):
    def test_release_config_retains_application_roots_without_e2e_fixture_imports(self):
        script="""const ts=require('typescript');const p=require('path');
const root=p.resolve('apps/web');const read=ts.readConfigFile(p.join(root,'tsconfig.release.json'),ts.sys.readFile);
if(read.error)throw Error(ts.flattenDiagnosticMessageText(read.error.messageText,' '));
const config=ts.parseJsonConfigFileContent(read.config,ts.sys,root);
if(config.errors.length)throw Error(JSON.stringify(config.errors));
console.log(JSON.stringify({files:config.fileNames.map(f=>p.relative(root,f)),options:config.options}));"""
        result=subprocess.run(['node','-e',script],cwd=ROOT,capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        value=json.loads(result.stdout);files=set(value['files'])
        self.assertIn('app/layout.tsx',files);self.assertIn('middleware.ts',files)
        self.assertTrue(any(f.startswith('components/') for f in files))
        self.assertTrue(any(f.startswith('lib/') for f in files))
        self.assertFalse(any(f.startswith(('e2e/','tests/','scripts/')) for f in files))
        self.assertTrue(value['options']['strict']);self.assertTrue(value['options']['noUncheckedIndexedAccess'])
        config=(ROOT/'apps/web/next.config.mjs').read_text()
        self.assertIn('tsconfigPath: "tsconfig.release.json"',config)
        self.assertIn('process.env.WORKSPACEX_RELEASE_BUILD === "1"',config)
        development=json.loads((ROOT/'apps/web/tsconfig.json').read_text())
        self.assertIn('**/*.ts',development['include'])
