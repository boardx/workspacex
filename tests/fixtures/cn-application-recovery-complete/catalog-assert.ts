import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {markCatalog} from './diagnostic';
/** Complete comparison; never format the full application catalog on failure. */
export function assertCatalogEqual(actual:Record<string,unknown>,expected:Record<string,unknown>){
 assert(isDeepStrictEqual(Object.keys(actual).sort(),Object.keys(expected).sort()),'RESTORE_CATALOG_SCOPE_MISMATCH');
 for(const category of Object.keys(expected)){
  markCatalog(category);
  assert(isDeepStrictEqual(actual[category],expected[category]),'RESTORE_CATALOG_MISMATCH');
 }
}
