/** Responses are bounded before this projection. Escaped JSON must not hide a literal credential. */
export function reflectsMcpCredential(value:unknown,credential:string):boolean{
 return credential.length>0&&JSON.stringify(value).includes(JSON.stringify(credential).slice(1,-1));
}
