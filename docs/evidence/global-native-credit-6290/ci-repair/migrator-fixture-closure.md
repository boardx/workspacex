# Linux fixture import closure repair

Business source c7b449a21 adds only the missing helper copy to the two existing Python fixture staging paths. On prior head39fb, simulation remaining failed at migrator-import with ERR_MODULE_NOT_FOUND for native-tariff-force-replay; PostgreSQL had not started. Linux lifecycle diagnostic stderr SHA256: efe4327fd13f6e7405dc6e61c50d55a36fcf87ce5998c9c9a71b174e423ef190.

The bounded script below executes each real staging fragment extracted from its Python AST, then imports the actual migrator using Node/tsx. Deleting the copied helper must make the same import fail with ERR_MODULE_NOT_FOUND. It passed for both fixtures on Darwin; this is module-assembly evidence, not Linux PostgreSQL execution. Each subprocess retains a30s deadline and TemporaryDirectory removes the staged files.

Commands actually executed:

```sh
python3 /tmp/global-native-6298-check-migrator-copy.py
python3 -m unittest discover -s tests -p test_cn_release_postgres_lifecycle_diagnostic.py
```

Import receipts:

```jsonl
{"fixture": "cn_release_postgres_linux.py", "actualStagingImport": true, "missingHelperRejected": true, "platform": "Darwin", "postgresExecuted": false}
{"fixture": "cn_release_postgres_lifecycle_linux.py", "actualStagingImport": true, "missingHelperRejected": true, "platform": "Darwin", "postgresExecuted": false}
```

Existing diagnostic tests:

```text
.....
----------------------------------------------------------------------
Ran 5 tests in 0.003s

OK
```

Script SHA256: `d60e9627fe72ec0545fbe2837ce223f0a7aa175568eb2b1960ecafc9cd649994`. This archived source is an evidence receipt, not an additional repository execution component. The absolute checkout path records the actual environment.

```python
"""Execute only each fixture's actual staging fragment and actual Node import; no PostgreSQL."""
import ast,json,os,pathlib,shutil,subprocess,tempfile
root=pathlib.Path('/Users/shenyangjun/boardx/workspacex-devapp-agent-recovery')
node=shutil.which('node');loader=(root/'node_modules/tsx/dist/loader.mjs').resolve()
for fixture in ('cn_release_postgres_linux.py','cn_release_postgres_lifecycle_linux.py'):
    tree=ast.parse((root/'tests'/fixture).read_text())
    main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
    body=next(n for n in main.body if isinstance(n,ast.Try)).body
    start=next(i for i,n in enumerate(body) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='source' for t in n.targets))
    end=next(i for i in range(start+1,len(body)) if isinstance(body[i],ast.Assign) and any(isinstance(t,ast.Name) and t.id=='fixture' for t in body[i].targets))
    with tempfile.TemporaryDirectory(prefix='global-native-import-') as directory:
        temp=pathlib.Path(directory)
        def put(name,raw):
            target=temp/name;target.write_bytes(raw);target.chmod(0o600);return target
        exec(compile(ast.Module(body=body[start:end],type_ignores=[]),fixture,'exec'),{'ROOT':root,'put':put})
        (temp/'node_modules').symlink_to(root/'apps/api/node_modules',target_is_directory=True)
        command=[node,'--import',str(loader),'--input-type=module','-e',"const m=await import('./migrator.ts');if(typeof m.migrate!=='function')process.exit(3)"]
        good=subprocess.run(command,cwd=temp,capture_output=True,text=True,timeout=30)
        if good.returncode:raise RuntimeError(fixture+':IMPORT_FAILED')
        (temp/'native-tariff-force-replay.ts').unlink()
        bad=subprocess.run(command,cwd=temp,capture_output=True,text=True,timeout=30)
        if bad.returncode==0 or 'ERR_MODULE_NOT_FOUND' not in bad.stderr or 'native-tariff-force-replay' not in bad.stderr:raise RuntimeError(fixture+':MISSING_HELPER_COUNTEREXAMPLE_FAILED')
        print(json.dumps({'fixture':fixture,'actualStagingImport':True,'missingHelperRejected':True,'platform':os.uname().sysname,'postgresExecuted':False}))
```

No PostgreSQL, browser, provider or production operation ran in this verification. The two complete Linux suites remain pending new-head CI; core-loop14 passed on prior39fb, which does not establish this new CI set is green.
