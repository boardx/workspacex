import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {parse} from '../vendor/yaml-2.9.0/parser.mjs';
it('regenerates official pinned YAML bundle byte-for-byte with lock/license closure',()=>{const r=spawnSync(process.execPath,['.harness/scripts/vendor-yaml-parser.mjs','--verify'],{encoding:'utf8'});expect(r.status,r.stderr).toBe(0);expect(r.stdout).toContain('OFFLINE_YAML_VENDOR_VERIFIED')});
it('retains upstream YAML anchors, block scalars, quoting and duplicate-key validation',()=>{const v:any=parse('base: &base\n  value: "中文: 1"\ncopy: *base\nscript: |\n  echo one\n  echo two\n');expect(v.copy).toEqual(v.base);expect(v.script).toBe('echo one\necho two\n');expect(()=>parse('key: 1\nkey: 2\n')).toThrow()});
