export function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve,reject)=>{value.onsuccess=()=>resolve(value.result);value.onerror=()=>reject(value.error);});
}
export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error??new DOMException('IndexedDB transaction aborted','AbortError'));});
}
