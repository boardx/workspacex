import type {z} from 'zod';
import type {StandardSqlSourceCheckInput,StandardSqlSourceCheckOutput} from '@repo/contracts/standard-sql';
export const STANDARD_SQL_SOURCE=Symbol('StandardSqlSource');
export interface StandardSqlSource{
 check(runId:string,input:z.infer<typeof StandardSqlSourceCheckInput>):Promise<z.infer<typeof StandardSqlSourceCheckOutput>>;
}
