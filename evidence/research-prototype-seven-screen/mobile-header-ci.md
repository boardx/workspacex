# Signed-in mobile header overflow — PR #4469

- Failing remote run: 36324273538, job 108633894488.
- Existing real UI/API/PostgreSQL test failed at `guided-research-runtime.spec.ts:85`, checking document width at 390×844 (both attempts).
- Downloaded failure screenshot shows the profile avatar beyond the right edge: the header brand, return button and authenticated profile shared a non-wrapping flex row.
- Fix: allow header wrapping below the desktop breakpoint; prevent action/avatar compression. Desktop remains a single row. The E2E assertion is unchanged.
- Local TypeScript check, scoped ESLint and six shell/primary-action tests passed.
- IAB anonymous topic preview at 390×844: document scrollWidth = innerWidth = 390. This is not authenticated E2E evidence; the signed-in case still requires the new remote CI run.
- Full web suite was also started; unrelated whiteboard `board-content-tools.test.tsx` failures appeared. No claim of an all-green local suite.
