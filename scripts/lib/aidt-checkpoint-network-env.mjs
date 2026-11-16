// QA launcher environment only. Model/deployment files never provide trusted network settings.
import { modelKeys } from '../real-model-config.mjs';
const baseKeys=['PATH','HOME','USER','LANG','TMPDIR'];
const proxyKeys=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'];
const networkKeys=[...proxyKeys,'NO_PROXY','no_proxy','SSL_CERT_FILE','REQUESTS_CA_BUNDLE','NODE_EXTRA_CA_CERTS'];
const pick=(env,keys)=>Object.fromEntries(keys.filter(key=>env[key]!==undefined).map(key=>[key,env[key]]));
export function trustedNetworkEnvironment(current) {
  const network=pick(current,networkKeys);
  // A supplied lowercase or explicitly empty value must not gain a conflicting uppercase override.
  if(current.NO_PROXY===undefined&&current.no_proxy===undefined)network.NO_PROXY='127.0.0.1,localhost';
  return network;
}
export function restoreOwnerEnvironment(current,modelValues) {
  return {...pick(current,baseKeys),...pick(modelValues,modelKeys),...trustedNetworkEnvironment(current)};
}
