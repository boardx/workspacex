# Phase 20 Iteration 2 — Journey Acceptance Report
# J0-C Work Skill Catalog (WS01–WS05)

**Date**: 2026-09-28  
**Iteration**: I2 (WS01–WS05, Work Skill catalog baseline)  
**Tester**: e2e-verifier agent  
**Stack**: native no-Docker, /tmp/.../scratchpad/stack  
**Branch**: claude/tender-maxwell-dh21fg-iter2

## Pre-Conditions

- Stack started with `WSX_REPO=/home/user/wt/iter2 WSX_RESET_DB=1 WSX_REBUILD_WEB=1`
- API restarted with `SKILL_STARTER_PACK_ROOT` pointing to a prepared pack directory
- S003 Enterprise Search starter pack imported via `POST /admin/skills/starter-pack-imports`
  - Pack: `work-stack-starter-v1/1.0.0.json` (stableId=S003, domain=Shared, riskClass=low)
  - Import result: 201 Created, status=succeeded
- Dev mode accounts seeded: admin / lead / consultant / compliance

## Test Execution Summary

**Spec**: `iter2-catalog.spec.ts`  
**Result**: 9/9 passed (55.5s total)

| # | Test | Status | Notes |
|---|------|--------|-------|
| 01 | Admin sees S003 in catalog (API + UI) | PASS | S003 row visible, channel badge "候选", readiness badge "未知" |
| 02 | Detail drawer opens with deps/provenance/versions | PASS | All 5 testids present |
| 03 | Filter by domain, search, empty state | PASS (with caveats) | URL params not connected to UI filter |
| 04 | Admin channel change: without gate (rejected), with gate (accepted) | PASS | 409 / 200 as expected |
| 05 | Non-admin cannot change channel (UI + API) | PASS | 0 channel controls visible, 403 on API |
| 06 | Readiness: not_ready when tools not configured | PASS | API returns not_ready, UI shows 未知 |
| 07 | Refresh recovery | PASS | S003 still visible after reload |
| 08 | Error states: bad ID → 404 | PASS | No raw error codes in top-level page content |
| 09 | Invalid pack import → 422 | PASS | WORK_SKILL_MANIFEST_INVALID with field-level issues |

## Detailed Journey Steps

### Step 1: Admin import Work Skill starter pack

**Action**: POST /admin/skills/starter-pack-imports with `work-stack-starter-v1` pack  
**Expected**: 201 Created, S003 written to skill_catalog_entries with channel=candidate  
**Actual**: 201 Created, status=succeeded, skillIds populated  
**Result**: PASS

Attempting import with missing riskClass in `metadata.work` returned:
- Status: 422 Unprocessable
- Code: WORK_SKILL_MANIFEST_INVALID
- Message: "metadata.work is invalid"
- Issues array with fieldPath "metadata.work.riskClass": "Required"
- No stack trace in response body

Screenshot: `evidence/iter2/shots/16-invalid-import.png`

### Step 2: Navigate to /skill?screen=work-catalog

**Action**: Admin logs in, navigates to catalog  
**Expected**: Visible via nav link ("Skill库")  
**Actual**: **Navigation link does not exist.** Nav shows: 对话/项目/Board/研究/访谈/录音/问卷/设计/反馈草稿/大脑/任务. Catalog only reachable via direct URL `/skill?screen=work-catalog`.  
**Result**: PARTIAL (catalog works by URL, but UX gap — no nav entry)

Screenshot: `evidence/iter2/shots/F01-nav.png`, `evidence/iter2/shots/02-catalog-page.png`

### Step 3: S003 row visible with correct badges

**Action**: Open `/skill?screen=work-catalog` as admin  
**Expected**: `work-catalog-row-S003`, `work-catalog-channel-badge`="candidate"/"候选", `work-catalog-readiness-badge`="未知"/"缺N项"  
**Actual**:
- `work-catalog-screen` testid: present ✓
- `work-catalog-row-S003` testid: present ✓
- Channel badge text: "候选" ✓ (Chinese, not raw "candidate")
- Readiness badge text: "未知" ✓ (list view correctly shows unknown, not claiming ready)

Screenshot: `evidence/iter2/shots/03-s003-row.png`

### Step 4: Filter by domain

**Action**: Apply domain filter "Shared" via UI click  
**Expected**: S003 still visible (Shared domain)  
**Actual**: S003 visible when clicking Shared filter ✓

**Action**: Navigate to `?domain=Sales` via URL  
**Expected**: S003 hidden (wrong domain)  
**Actual**: **S003 still visible** — URL param `?domain=Sales` is not reflected in UI filter state. Filter is maintained as UI state only, not URL state.  
**Result**: URL param filtering not working (S003 should be hidden when `domain=Sales`)

Screenshot: `evidence/iter2/shots/07-filter-sales.png`, `evidence/iter2/shots/D02-domain-sales.png`

### Step 5: Search

**Action**: Use search box to type "Enterprise"  
**Expected**: S003 found  
**Actual**: S003 found ✓

**Action**: Search for "xyznotfound999"  
**Expected**: Empty state with `work-catalog-empty` or clear filters button  
**Actual**: `work-catalog-clear-filters` button present ✓, `work-catalog-empty` testid NOT present, no Chinese empty-state text visible  
**Result**: Partial — clear filters present, empty testid missing, no empty-state messaging

Screenshot: `evidence/iter2/shots/09-empty-state.png`, `evidence/iter2/shots/E03-search-empty.png`

### Step 6: Detail drawer

**Action**: Click S003 row to open detail drawer  
**Expected**: Drawer with deps/provenance/versions; readiness unknown shows local indicator; no raw error codes  
**Actual**:
- `work-skill-detail` testid: present ✓
- `work-skill-deps-required` testid: present ✓, shows knowledge.search/knowledge.read/project.read
- `work-skill-deps-optional` testid: present ✓, shows knowledge.graph/mail.search/web.fetch
- `work-skill-provenance` testid: present ✓
- `work-skill-versions` testid: present ✓ (shows "1.0.0（当前）")
- Gate states: G0-G6 shown as "G0 · not_run" (English "not_run" not localized)

**BUG**: `NO_ENABLED_TOOL` raw English error code appears 6 times in the detail drawer, visible to non-admin consultant role:
- "knowledge.searchNO_ENABLED_TOOL缺失"
- "knowledge.readNO_ENABLED_TOOL缺失"  
- "project.readNO_ENABLED_TOOL缺失"
- "knowledge.graphNO_ENABLED_TOOL缺失" (optional)
- "mail.searchNO_ENABLED_TOOL缺失" (optional)
- "web.fetchNO_ENABLED_TOOL缺失" (optional)

This violates the requirement: "禁止出现英文错误码裸露给成员（错误码可放在「详情」折叠里）"

Screenshot: `evidence/iter2/shots/04-detail-drawer.png`, `evidence/iter2/shots/E02-detail-open.png`

### Step 7: Admin changes channel candidate→verified

**Without gate evidence**:
- Request: PATCH /admin/skills/catalog/{skillId} with channel=verified, expectedChannel=candidate
- Result: 409 Conflict, code=WORK_SKILL_CHANNEL_TRANSITION_INVALID, message="candidate -> verified requires gateEvidenceRef"
- `allowedTransitions`: ["verified", "deprecated"] (confirmed candidate→verified/deprecated allowed)
- PASS ✓

**With gate evidence**:
- Request: PATCH with gateEvidenceRef="eval-suite-E003-iter2-acceptance"
- Result: 200 OK, channel=verified
- UI badge updated to "已验证" ✓
- PASS ✓

Screenshot: `evidence/iter2/shots/10-after-channel-change.png`

### Step 8: Non-admin cannot see channel controls

**Consultant role**:
- `work-skill-change-channel` in list: 0 ✓
- `work-skill-change-channel` in drawer: 0 ✓
- API PATCH attempt: 403 Forbidden ✓

Screenshot: `evidence/iter2/shots/12-consultant-detail.png`, `evidence/iter2/shots/13-consultant-no-channel.png`

### Step 9: Readiness shows not_ready (tools not configured)

**API**:
- GET /skills/catalog/{skillId}/readiness returns `overall=not_ready`, `missingRequired=3`
- Items: knowledge.search/knowledge.read/project.read all state=missing, reasonCode=NO_ENABLED_TOOL

**UI**:
- Readiness badge shows "未知" in list view (correct — list endpoint doesn't compute per-org readiness)
- Detail drawer shows capability states but with raw `NO_ENABLED_TOOL` code (see Step 6)

The readiness badge does NOT show "可运行" when tools are not configured ✓

Screenshot: `evidence/iter2/shots/13-readiness.png`

### Step 10: Error state (bad skill ID)

**Action**: GET /skills/catalog/nonexistent-skill-id-000  
**Expected**: 404  
**Actual**: 404 ✓

Page-level content: No raw English error codes in page body (uppercase strings check: 0 matches) ✓

Screenshot: `evidence/iter2/shots/15-error-check.png`

### Step 11: Refresh recovery

**Action**: Load catalog, then F5  
**Expected**: S003 still visible  
**Actual**: S003 visible before=1, after=1 ✓

Screenshot: `evidence/iter2/shots/14-refresh.png`

### Step 12: Loading feedback

**Action**: Navigate directly to catalog, check for loading skeleton  
**Expected**: `work-catalog-state-loading` testid or visible loading indicator  
**Actual**: `work-catalog-state-loading` testid NOT found. Page appears to load synchronously (fast local stack), no loading skeleton captured.

Screenshot: `evidence/iter2/shots/F02-loading.png`

## UX Issues (Ranked)

### BLOCKER

**B1: Raw English error code `NO_ENABLED_TOOL` exposed in detail drawer**  
All 6 capability items in the detail drawer show the raw machine code `NO_ENABLED_TOOL` directly in the visible text, e.g. "knowledge.search**NO_ENABLED_TOOL**缺失". This is visible to consultant and compliance roles, not just admins.  
Requirement violated: "禁止出现英文错误码裸露给成员（错误码可放在「详情」折叠里）"  
Fix: Replace `NO_ENABLED_TOOL` with Chinese text (e.g., "无已启用工具") or collapse the error code into a "详情" expandable section.

### MAJOR

**M1: No navigation link to Skill catalog**  
The `/skill?screen=work-catalog` screen is not accessible from any navigation element. Users must know the direct URL. Nav items present: 对话/项目/Board/研究/访谈/录音/问卷/设计/反馈草稿/大脑/任务. No "Skill库" or "技能市场" entry.  
J0-C requires: "导航「Skill 库与市场」→ /skill?screen=work-catalog"  
Fix: Add "Skill 库" navigation link in the left sidebar pointing to `/skill?screen=work-catalog`.

### MINOR

**N1: URL search params not connected to UI filter state**  
Navigating to `?domain=Sales` does not apply the domain filter in the UI. Similarly, `?q=something` via URL does not populate the search box. Filters are UI-state-only with no URL synchronization. This breaks deep-linking and browser back/forward for filtered views.

**N2: `work-catalog-empty` testid missing**  
When searching with no results, the `work-catalog-empty` testid is absent. The `work-catalog-clear-filters` button is present but no dedicated empty-state container testid. Empty state text/messaging is also not visible in the captured screenshots.

**N3: Gate state labels in English**  
Detail drawer shows "G0 · not_run", "G1 · not_run" etc. The "not_run" part is English. Per the Chinese copy standard, status labels should be Chinese (e.g., "未评测" instead of "not_run"). Acceptable in a technical detail area if inside a collapsible section, but currently displayed inline.

**N4: Loading skeleton testid missing**  
`work-catalog-state-loading` testid not detected on direct navigation. The page may load fast enough on local stack that the skeleton is not visible, but the testid should be present for Playwright automation to verify it. Spec requires: "超过 300 ms 必须先出骨架（work-catalog-state-loading 等）".

## Verdict

**REVISE**

The I2 walkable slice is functionally complete at the API level (WS01-WS04 all pass their verification contracts). The UI renders S003 correctly with proper Chinese badges and the channel management workflow is accurate. However, the following issues prevent ACCEPT:

1. **BLOCKER B1** (`NO_ENABLED_TOOL` exposed to non-admin users) violates the Chinese copy and error code standards, which are a global quality requirement, not an I10 item.

2. **MAJOR M1** (no navigation link) means the catalog is unreachable to real users who don't know the URL. The J0-C journey begins with "导航「Skill 库与市场」→ /skill?screen=work-catalog" — this step cannot be walked.

Fix B1 and M1 to re-submit for acceptance.

## Evidence Files

- `evidence/iter2/e2e-evidence.json` — machine-readable test evidence
- `evidence/iter2/shots/01-nav-check.png` — admin navigation (no Skill catalog link)
- `evidence/iter2/shots/02-catalog-page.png` — catalog page loaded
- `evidence/iter2/shots/03-s003-row.png` — S003 row with channel/readiness badges
- `evidence/iter2/shots/04-detail-drawer.png` — detail drawer (NO_ENABLED_TOOL visible)
- `evidence/iter2/shots/05-detail-admin.png` — admin detail with channel button
- `evidence/iter2/shots/06-filter-shared.png` — Shared domain filter
- `evidence/iter2/shots/07-filter-sales.png` — Sales domain filter (S003 wrongly visible)
- `evidence/iter2/shots/08-search-enterprise.png` — search by name
- `evidence/iter2/shots/09-empty-state.png` — empty state (no testid)
- `evidence/iter2/shots/10-after-channel-change.png` — channel changed to 已验证
- `evidence/iter2/shots/11-consultant-catalog.png` — consultant catalog view
- `evidence/iter2/shots/12-consultant-detail.png` — consultant detail (no channel button)
- `evidence/iter2/shots/13-readiness.png` — readiness badge 未知
- `evidence/iter2/shots/14-refresh.png` — refresh recovery
- `evidence/iter2/shots/15-error-check.png` — page content check
- `evidence/iter2/shots/16-invalid-import.png` — invalid pack import 422
- `evidence/iter2/shots/D01-base.png` — domain filter base
- `evidence/iter2/shots/D02-domain-sales.png` — domain=Sales URL (filter ignored)
- `evidence/iter2/shots/E02-detail-open.png` — detail drawer full text
- `evidence/iter2/shots/F01-nav.png` — navigation full list
- `evidence/iter2/shots/F04-detail.png` — detail with NO_ENABLED_TOOL visible
