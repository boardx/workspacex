import {afterEach,describe,expect,it,vi} from 'vitest';
import {installIndexedDbTransactionObserver,requestIndexedDbQuiescentPause} from '../../e2e/support/board-indexeddb-quiescent-pause';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('browser IndexedDB quiescent debugger boundary',()=>{
 it('fails closed when instrumentation or native binding is absent',()=>{
  expect(()=>requestIndexedDbQuiescentPause({key:'missing-observer',binding:'missing-binding'})).toThrow('IDB_QUIESCENCE_UNAVAILABLE');
 });
 it('waits for terminal transaction events and ignores request errors and duplicate terminal events',()=>{
  vi.useFakeTimers();
  class Database {transaction(){const tx=new EventTarget();return tx;}}
  vi.stubGlobal('IDBDatabase',Database);
  const key=`observer-${Date.now()}`,binding=`notify-${Date.now()}`;
  const notify=vi.fn();vi.stubGlobal(binding,notify);
  installIndexedDbTransactionObserver(key);
  const first=new Database().transaction(),second=new Database().transaction();
  requestIndexedDbQuiescentPause({key,binding});
  vi.advanceTimersByTime(1);expect(notify).not.toHaveBeenCalled();
  first.dispatchEvent(new Event('error'));vi.advanceTimersByTime(1);expect(notify).not.toHaveBeenCalled();
  first.dispatchEvent(new Event('complete'));first.dispatchEvent(new Event('abort'));
  vi.advanceTimersByTime(1);expect(notify).not.toHaveBeenCalled();
  second.dispatchEvent(new Event('abort'));vi.advanceTimersByTime(1);
  expect(notify).toHaveBeenCalledTimes(1);expect(notify).toHaveBeenCalledWith(JSON.stringify({type:'storage-quiescent',active:0}));
 });
 it('rejects duplicate installation instead of losing existing active transaction tracking',()=>{
  class Database {transaction(){return new EventTarget();}}vi.stubGlobal('IDBDatabase',Database);
  const key=`duplicate-${Date.now()}`;installIndexedDbTransactionObserver(key);
  expect(()=>installIndexedDbTransactionObserver(key)).toThrow('IDB_QUIESCENCE_ALREADY_INSTALLED');
 });
});
