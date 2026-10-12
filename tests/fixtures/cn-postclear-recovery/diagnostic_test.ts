import assert from 'node:assert/strict';
import test from 'node:test';
import {diagnostic,mark} from './diagnostic';
test('unknown secret error never echoed',()=>{mark('SECRET_STAGE');const x=diagnostic(Object.assign(Error('postgres://user:SECRET@host/private'),{code:'SECRET_CODE',query:'SECRET_QUERY'}));assert.equal(x.stage,'unknown');assert.equal(x.reason,'UNCLASSIFIED');assert(!JSON.stringify(x).includes('SECRET'));});
test('real psql shape preserves only approved SQLSTATE and hash',()=>{mark('create-roles');const x=diagnostic(Object.assign(Error('sensitive command'),{code:1,stderr:'ERROR:  42501: secret text\n'}));assert.equal(x.stage,'create-roles');assert.equal(x.sqlstate,'42501');assert.equal(x.childExit,1);assert(!JSON.stringify(x).includes('secret'));assert.equal(x.stderrSha256.length,64);});
test('cause retains original failure classification under recovery assertion',()=>{const x=diagnostic(Error('RECOVERY_DID_NOT_COMPLETE',{cause:Object.assign(Error('untrusted pg text'),{code:'42703'})}));assert.equal(x.reason,'RECOVERY_DID_NOT_COMPLETE');assert.equal(x.sqlstate,'42703');});
test('fixed driver prefix safe and causes bounded',()=>{const e=Error('ORIGINAL_CATCH_NOT_COMPLETED: secret');(e as any).cause=e;assert.equal(diagnostic(e).reason,'ORIGINAL_CATCH_NOT_COMPLETED');assert(!JSON.stringify(diagnostic(e)).includes('secret'));});
