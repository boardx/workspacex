# Retry supplemental query persistence

Actual service retry with strict shared runtime schema reproduces two failures: valid long task/question plus confirmed topic/region creates supplemental query over1000, intermediate write throws ZodError and final write repeats it. This is a reproducible500 path, not proof of the specific screenshot trace.

Derived supplement queries now share the durable attempt schema bound and reserve space across scope/query/suffix; original confirmed task remains unchanged. Short queries unchanged. No persistence validation relaxation.

TDD2failed4passed→30unitPASS (orchestration6/recovery24). APItypecheck0. Logs /private/tmp/research-5209-{red,unit,typecheck}.log. No user session commands or production writes. Issue5209 direct human request prioritized outside readiness.
