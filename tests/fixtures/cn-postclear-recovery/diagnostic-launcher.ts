import {diagnostic} from './diagnostic';
try{await import('./postgres');}catch(error){
 console.error('CN_POSTCLEAR_DIAGNOSTIC '+JSON.stringify(diagnostic(error)));
 process.exitCode=1;
}
