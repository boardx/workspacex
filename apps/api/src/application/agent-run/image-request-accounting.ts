import type {ImageContext} from './standard-image-tools';
import type {ReportedUsage} from './ports';
/** Trusted server composition only; never accepted from model tool arguments. */
export interface ImageRequestAccounting {
 start(context:ImageContext,input:{requestId:string;modelId:string;startedAt:string}):Promise<{terminal(input:{endedAt:string;outcome:'succeeded'|'failed';usage:ReportedUsage}):Promise<void>}>;
}
