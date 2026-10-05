import {readFileSync,existsSync,readdirSync} from "node:fs";
import {resolve} from "node:path";
import {it,expect} from "vitest";
import {PLATFORM_ADMIN_ROUTES,PLATFORM_ADMIN_MODULE_ROUTES,PLATFORM_ADMIN_STANDALONE_ROUTES,platformAdminModuleStaticParams} from "../../lib/platform-admin-routes";
const dynamicPage=readFileSync(resolve(process.cwd(),"app/platform-admin/[module]/page.tsx"),"utf8");
it("standalone model tests retain a real page and navigation destination but never become dynamic static params",()=>{
 expect(PLATFORM_ADMIN_ROUTES['model-tests']).toBe('model-tests');expect(PLATFORM_ADMIN_STANDALONE_ROUTES['model-tests']).toBe('model-tests');
 expect(existsSync(resolve(process.cwd(),'app/platform-admin/model-tests/page.tsx'))).toBe(true);
 expect(platformAdminModuleStaticParams()).not.toContainEqual({module:'model-tests'});
 expect(Object.keys(PLATFORM_ADMIN_MODULE_ROUTES).filter(key=>key in PLATFORM_ADMIN_STANDALONE_ROUTES)).toEqual([]);
});
it("all existing dynamic module destinations continue to generate and redirects remain explicit",()=>{
 const expected=['agent','model','mcp','members','organizations','ops-status','telemetry','feedback-drafts','inbox','design-workbench'];
 expect(platformAdminModuleStaticParams().map(p=>p.module).sort()).toEqual([...expected].sort());
 expect(dynamicPage).toContain('...platformAdminModuleStaticParams()');expect(dynamicPage).toContain('...Object.keys(REDIRECTS).map');
 expect(dynamicPage).not.toMatch(/Object\.keys\(PLATFORM_ADMIN_ROUTES\)/);
 expect(dynamicPage).toContain('const key = PLATFORM_ADMIN_MODULE_ROUTES[params.module]');
});
it("negative: the former complete-navigation params algorithm collides with a standalone page",()=>{
 // Independent filesystem oracle: these actual page.tsx files are not owned by [module].
 const standalonePages=readdirSync(resolve(process.cwd(),"app/platform-admin"),{withFileTypes:true}).filter(entry=>entry.isDirectory()&&!entry.name.startsWith("[")&&existsSync(resolve(process.cwd(),"app/platform-admin",entry.name,"page.tsx"))).map(entry=>entry.name);
 const colliding=Object.keys(PLATFORM_ADMIN_ROUTES).filter(key=>standalonePages.includes(key));
 expect(colliding).toEqual(['model-tests']);expect(platformAdminModuleStaticParams().some(p=>colliding.includes(p.module))).toBe(false);
});
