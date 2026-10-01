import {isAbsolute,relative,sep} from 'node:path';
/** Inputs are realpath-resolved by the CLI: sibling names beginning '..' are still descendants. */
export function archiveRootsOverlap(primary:string,archive:string):boolean {
 const contains=(parent:string,child:string)=>{const path=relative(parent,child);return path===''||(!isAbsolute(path)&&path!=='..'&&!path.startsWith(`..${sep}`));};
 return contains(primary,archive)||contains(archive,primary);
}
