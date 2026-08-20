import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
const s=(k:string)=>k.replace(/([A-Z])/g,"_$1").toUpperCase();
console.log(`export FULLSTACK_E2E_FIXTURE=1`);
for (const [k,v] of Object.entries(FULLSTACK_E2E)) if (typeof v==="string") console.log(`export FULLSTACK_E2E_${s(k)}=${JSON.stringify(v)}`);
