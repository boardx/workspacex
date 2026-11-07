"""Offline native protocol tests. No actual systemd or root installation."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

P=Path(__file__).resolve().parents[1]/'scripts/cn-release-migration-owner-native.py'
s=importlib.util.spec_from_file_location('native_owner',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)


class NativeTests(unittest.TestCase):
    def owner(self):
        owner=object.__new__(m.Installed)
        owner.c={'releaseSha256':'a'*64,'originalPlanSha256':'b'*64,'launcherSha256':'c'*64,'unitSha256':'d'*64,'systemctlSha256':m.sha(b'binary')}
        owner.expected=m.dispatch_spec(owner.c)
        owner.fresh=lambda **kw:None
        return owner

    def installation(self):
        release='a'*64
        writer_path='/etc/workspacex-cn/maintenance-host/writer.json'
        entry_path='/etc/workspacex-cn/maintenance-host/entry.json'
        files={m.SELF:b'approved-self',m.LAUNCHER:b'approved-launcher',
               m.TEMPLATE:m.unit_bytes(),m.SYSTEMCTL:b'approved-systemctl',
               writer_path:m.encode({'releaseContinuation':{'scope':'cn-reviewed-additive-migration-v1'}})}
        writer_sha=m.sha(files[writer_path])
        files[entry_path]=m.encode({'productionActionsAuthorized':True,'host':{
            'writerPlanPath':writer_path,'writerPlanSha256':writer_sha}})
        config={'schemaVersion':1,'scope':'cn-reviewed-additive-migration-v1',
                'releaseSha256':release,'originalPlanSha256':writer_sha,
                'entryPlanPath':entry_path,'entryPlanSha256':m.sha(files[entry_path]),
                'launcherSha256':m.sha(files[m.LAUNCHER]),'unitSha256':m.sha(files[m.TEMPLATE]),
                'systemctlSha256':m.sha(files[m.SYSTEMCTL]),'expiresAt':2000}
        config_path='/etc/workspacex-cn/migration-owner/'+release+'.json'
        files[config_path]=m.encode(config)
        files[m.PROFILE]=m.encode({'filesSha256':{m.SOURCE:m.sha(files[m.SELF])},
            'maintenanceMigrationOwner':{'schemaVersion':1,'releaseSha256':release,
                'originalPlanSha256':writer_sha,'configSha256':m.sha(files[config_path])}})
        return release,files

    def test_every_critical_file_drift_after_constructor_prevents_start(self):
        release,initial=self.installation()
        for path in initial:
            with self.subTest(path=path):
                files=dict(initial)
                with patch.object(m.sys,'platform','linux'),patch.object(m.os,'geteuid',return_value=0),patch.object(m.os,'getegid',return_value=0),patch.object(m,'protected',side_effect=lambda path,*_:files[path]),patch.object(m.time,'time',return_value=1000),patch.object(m.subprocess,'run')as run:
                    owner=m.Installed(release)
                    files[path]+=b'changed-after-admission'
                    with self.assertRaises(RuntimeError):owner.command(['start',owner.expected['unit']])
                    run.assert_not_called()

    def test_unchanged_closure_starts_once_but_expiry_never_starts(self):
        release,files=self.installation()
        with patch.object(m.sys,'platform','linux'),patch.object(m.os,'geteuid',return_value=0),patch.object(m.os,'getegid',return_value=0),patch.object(m,'protected',side_effect=lambda path,*_:files[path]),patch.object(m.time,'time',return_value=1000)as clock,patch.object(m.subprocess,'run')as run:
            owner=m.Installed(release)
            owner.command(['start',owner.expected['unit']])
            self.assertEqual(run.call_count,1)
            run.reset_mock();clock.return_value=2000
            with self.assertRaisesRegex(RuntimeError,'OWNER_DEADLINE'):owner.command(['start',owner.expected['unit']])
            run.assert_not_called()

    def test_unit_has_fixed_launcher_loader_and_never_restart(self):
        raw=m.unit_bytes().decode()
        self.assertIn('Restart=no\n',raw)
        self.assertIn('KillMode=control-group\n',raw)
        self.assertEqual(raw.count('ExecStart='),1)
        self.assertIn(m.SELF+' --own %i\n',raw)
        self.assertNotIn('RuntimeMaxSec=',raw)

    def test_dispatch_spec_cannot_choose_command(self):
        value=m.dispatch_spec(self.owner().c)
        self.assertEqual(value['unit'],'workspacex-cn-migration@'+'a'*64+'.service')
        self.assertEqual(value['planSha256'],'b'*64)
        self.assertEqual(set(value),{'schemaVersion','kind','releaseSha256','planSha256','launcherSha256','unitSha256','unit'})

    def test_systemctl_fixed_binary_no_shell_bounded_no_stderr_export(self):
        owner=self.owner()
        with patch.object(m,'protected',return_value=b'binary'),patch.object(m.subprocess,'run')as run:
            owner.command(['show',owner.expected['unit']])
            args,kw=run.call_args
            self.assertEqual(args[0][:3],[m.SYSTEMCTL,'--no-pager','--no-ask-password'])
            self.assertEqual(kw['timeout'],30)
            self.assertEqual(kw['stderr'],subprocess.DEVNULL)
            self.assertNotIn('shell',kw)
            self.assertEqual(set(kw['env']),{'PATH','LANG'})

    def test_binary_drift_rejects_before_command(self):
        owner=self.owner()
        with patch.object(m,'protected',return_value=b'changed'),patch.object(m.subprocess,'run')as run:
            with self.assertRaisesRegex(RuntimeError,'SYSTEMCTL_PIN'):owner.command(['show'])
            run.assert_not_called()

    def test_unit_dropin_or_pending_reload_rejected(self):
        for change in [('DropInPaths','/etc/unreviewed.conf'),('NeedDaemonReload','yes'),('FragmentPath','/etc/foreign.service')]:
            owner=self.owner()
            values={'FragmentPath':m.TEMPLATE,'DropInPaths':'','NeedDaemonReload':'no','MainPID':'0','InvocationID':'','ActiveState':'inactive','SubState':'dead','ControlGroup':''}
            values[change[0]]=change[1]
            owner.command=lambda _:subprocess.CompletedProcess([],0,'\n'.join(k+'='+v for k,v in values.items()).encode())
            with self.assertRaisesRegex(RuntimeError,'CONFIGURATION_DRIFT'):owner.show()

    def test_unknown_owner_never_calls_start_or_terminal(self):
        owner=self.owner();calls=[]
        owner.show=lambda:{'InvocationID':'f'*32,'MainPID':'0'}
        def private(name):
            calls.append(name)
            if name=='claim.json':return m.encode(owner.expected)
            raise FileNotFoundError()
        owner.private=private
        self.assertEqual(owner.observe(),{'state':'unknown','retryAllowed':False})
        self.assertEqual(calls,['claim.json','started.json'])

    def test_duplicate_keys_reject(self):
        with self.assertRaisesRegex(RuntimeError,'DUPLICATE_KEY'):m.parse(b'{"x":1,"x":2}')

    def test_live_entry_rejects_without_linux_root(self):
        with patch.object(m.sys,'platform','darwin'),patch.object(m.subprocess,'run')as run:
            with self.assertRaisesRegex(RuntimeError,'ROOT_LINUX_REQUIRED'):m.main(['--start-once','a'*64])
            run.assert_not_called()


if __name__=='__main__':unittest.main()
