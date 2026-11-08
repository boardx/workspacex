import { safeRelativePath } from '@/lib/safe-relative-path';
import SkillEditor from '@/app/platform-admin/skill/[id]/page';
/** Organization-owned content uses the existing version editor and tenant guards. */
export default function OrganizationSkillEditor({params,searchParams}:{params:{id:string};searchParams:{as?:string;from?:string}}){
 return <SkillEditor params={params} searchParams={{...searchParams,from:safeRelativePath(searchParams.from)??'/org-admin/skill'}}/>;
}
