/** Admission for the private observer only; this does not assign resource identity. */
export function boardProviderReceiptBuild(env){
 const opted=env.FULLSTACK_E2E_BOARD_RECEIPTS;
 if(opted===undefined||opted==='0')return undefined;
 const fail=()=>{throw new Error('ISOLATED_RECEIPT_OBSERVER_BUILD_REQUIRED');};
 // Only the absent/default nonrelease value is eligible; unknown flags fail closed.
 const release=env.WORKSPACEX_RELEASE_BUILD;
 if(opted!=='1'||(release!==undefined&&release!=='0'))fail();
 const isolation=env.WORKSPACEX_ISOLATION_ID,marker=env.BOARD_ACCEPTANCE_RUNTIME_MARKER;
 if(typeof isolation!=='string'||!/^[a-z0-9][a-z0-9-]{0,26}-[0-9a-f]{12}$/.test(isolation))fail();
 if(typeof marker!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(marker))fail();
 let origin;try{origin=new URL(env.FULLSTACK_E2E_API_ORIGIN);}catch{fail();}
 if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||!origin.port||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)fail();
 return Object.freeze({marker,binding:'boardProviderReceipt'+marker.replaceAll('-','')});
}
