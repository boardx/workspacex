# S003 actual-model acceptance and review correction

The final live wrapper exited 0 (1m32s), published actual report.docx/report.pdf/two page PNGs, completed PG artifact-version writeback and made zero tool calls for the arithmetic negative control. Actual Office XML shows the bilingual brief and milestone tables. Both pages were opened with view_image detail=original: the requested header is visibly present on both, with no observed clipping/overlap.

The first model draft (retained untouched under attempt-1) invented that financial decisions were frozen. The final draft states budget unknown and explicitly avoids adopting unsupported funding/approval/freeze statements; there is no invented budget number or asserted spending prohibition. Its explanation is more verbose than necessary but keeps the missing budget distinction. This passes the representative two-page synthetic document scenario, not all DOCX editing/layout cases.

## Correction of earlier reviewer claim

The earlier claim that page 2 lacked a header was a reviewer error from the default multi-image preview. Viewing both original attempts at original resolution showed the header. A controlled independent sandbox comparison of the actual DOCX and a diagnostic copy with the false evenAndOddHeaders setting removed produced byte-identical page-2 PNGs, also identical to the actual published PNG (SHA256 96b79a79dfd00f9fa6d0edc1e7d70957fb6ab670f81c9581bcbbe7dc10262fd7). No renderer fix was needed or made. The diagnostic copy was not substituted for a model artifact. See header-probe.txt, header-probe/ and tests/skill_batch_docx_header_probe.py. The first attempt's budget concern remains valid independently of this corrected visual claim.
