"""Read-only narrow AST bridge: CI wrapper -> actual six Playwright spawn.
No imports/execution of the inspected Python sources, no application startup.
"""
import ast,json,sys
from pathlib import Path

def verified(root):
 def parse(p):return ast.parse((root/p).read_text())
 def fn(t,n):return next(x for x in t.body if isinstance(x,(ast.FunctionDef,ast.AsyncFunctionDef))and x.name==n)
 def calls(t,name):return [x for x in ast.walk(t)if isinstance(x,ast.Call)and ((isinstance(x.func,ast.Name)and x.func.id==name)or(isinstance(x.func,ast.Attribute)and x.func.attr==name))]
 def strings(t):return {x.value for x in ast.walk(t)if isinstance(x,ast.Constant)and isinstance(x.value,str)}
 ci=parse('scripts/cn-release-simulation-ci.py');sim=parse('scripts/cn-release-simulation.py');wrapper=parse('tests/cn_release_six_business_linux.py');session=parse('scripts/cn-release-six-session.py')
 execute=fn(ci,'execute');defaults=dict(zip([x.arg for x in execute.args.args][-len(execute.args.defaults):],execute.args.defaults))
 assert isinstance(defaults.get('suite'),ast.Constant)and defaults['suite'].value=='all'
 ci_main=fn(ci,'main');assert any(x.args and isinstance(x.args[0],ast.Constant)and x.args[0].value=='--suite'and any(k.arg=='default'and isinstance(k.value,ast.Constant)and k.value.value=='all'for k in x.keywords)for x in calls(ci_main,'add_argument'))
 assert any(len(x.args)==5 and ast.unparse(x.args[3])=='args.suite'for x in calls(ci_main,'execute'))
 invocations=calls(execute,'run_owned_simulation')
 assert any(isinstance(x.args[0],ast.List)and 'scripts/cn-release-simulation.py'in strings(x.args[0])and len(x.args[0].elts)==16 and isinstance(x.args[0].elts[-2],ast.Constant)and x.args[0].elts[-2].value=='--suite'and isinstance(x.args[0].elts[-1],ast.Name)and x.args[0].elts[-1].id=='suite'for x in invocations)
 assert calls(fn(ci,'run_owned_simulation'),'spawn')
 suites=next(ast.literal_eval(x.value)for x in sim.body if isinstance(x,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='SUITES'for t in x.targets))
 assert suites['linux-six-business']==['cn_release_six_business_linux.py']
 main=fn(sim,'main');assert any(x.args and isinstance(x.args[0],ast.Constant)and x.args[0].value=='--suite'and any(k.arg=='default'and isinstance(k.value,ast.Constant)and k.value.value=='all'for k in x.keywords)for x in calls(main,'add_argument'))
 assert any(isinstance(x,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='names'for t in x.targets)and ast.unparse(x.value)=="list(SUITES) if args.suite == 'all' else [args.suite]"for x in ast.walk(main))
 child=fn(sim,'child');assert 'linux-six-business'in strings(child)and calls(child,'exec_module')and calls(child,'main')
 assert any('SUITES[suite][0]'in ast.unparse(x)for x in calls(child,'spec_from_file_location'))
 wrapped=fn(wrapper,'main');assert any('scripts/cn-release-six-session.py'in strings(x)for x in calls(wrapped,'spec_from_file_location'))and calls(wrapped,'exec_module')and calls(wrapped,'run_round')
 cmd=fn(session,'playwright_command');ret=next(x.value for x in cmd.body if isinstance(x,ast.Return));assert isinstance(ret,ast.List)and len(ret.elts)==5
 assert strings(ret)=={'CN_API_STARTUP_NODE','apps/web/node_modules/@playwright/test/cli.js','test','--config','apps/web/playwright.cn-six-business.config.ts'}
 assert any(x.args and isinstance(x.args[0],ast.Call)and isinstance(x.args[0].func,ast.Name)and x.args[0].func.id=='playwright_command'for x in calls(fn(session,'run_round'),'spawn'))
 assert (root/'apps/web/playwright.cn-six-business.config.ts').is_file()
 return True
if __name__=='__main__':
 try:ok=verified(Path(sys.argv[1]))
 except (OSError,ValueError,SyntaxError,AssertionError,StopIteration,KeyError,IndexError,TypeError):ok=False
 print(json.dumps({'verified':ok}))
