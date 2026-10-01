/** Retain only allowlisted classifications and counts, never source log lines. */
export function boardSoakDiagnostics(stdout, stderr, status) {
 const text=String(stdout??'')+'\n'+String(stderr??'');
 const phases=[...text.matchAll(/^BOARD_SOAK_PHASE (initial-sync|measurement|recovery|verification)\r?$/gm)].map(match=>match[1]);
 const checkoutTimeouts=(text.match(/timeout exceeded when trying to connect|POOL_CHECKOUT_TIMEOUT/gi)??[]).length;
 const unavailable=(text.match(/DEPENDENCY_UNAVAILABLE/g)??[]).length;
 return {version:1,phase:phases.at(-1)??'startup',phases,exitCode:Number.isInteger(status)&&status>=0&&status<=255?status:1,
  pool:{classification:checkoutTimeouts?'checkout-timeout':unavailable?'dependency-unavailable':'not-observed',checkoutTimeouts,unavailable}};
}
