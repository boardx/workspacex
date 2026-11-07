/** Use the CI-installed browser across the suite's deliberately private HOME. */
import {accessSync,constants,statSync} from 'node:fs';
import {isAbsolute} from 'node:path';
export function chromiumLaunch<T extends object>(base:T|undefined, executable:string|undefined){
 if(!executable||!isAbsolute(executable))throw Error('EXPLICIT_INSTALLED_CHROMIUM_REQUIRED');
 try{
  if(!statSync(executable).isFile())throw Error('not-file');
  accessSync(executable,constants.X_OK);
 }catch{throw Error('INSTALLED_CHROMIUM_NOT_EXECUTABLE');}
 return {...base,executablePath:executable};
}
