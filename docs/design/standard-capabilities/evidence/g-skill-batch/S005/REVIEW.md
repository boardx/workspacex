# S005 first live run: not accepted

The real run hit the existing 25 model-call limit before artifact publication; wrapper exited 1 and cleaned up. No PPTX/preview writeback is claimed. The model read pptx-create but did not read its referenced editing-and-qa guide. The main body still directed output to SKILL_SANDBOX_OUT_DIR, absent in native mode; subsequent steps probed environment/renderer wrappers and attempted unavailable installs. Rather than invoking the packaged renderer for the PPTX, it built a separate PDF with pdf-lib. That is not valid evidence of PPTX rendering, even though the final command produced three PNGs.

No budget is increased and no un-published sandbox output is promoted as delivered. Parent was notified that the Office entrypoint should explicitly route native output to /workspace and require the existing render-office.py and relevant QA reference; a separately redrawn PDF must not substitute for actual Office-file preview. The real trace and model-limit final are retained.

## Final representative acceptance

With the new content-digest package entrypoint, the genuine model used the actual `python3 /skills/pptx-create/scripts/render-office.py /workspace/slides.pptx /workspace/preview` and published the PPTX, its actual PDF and three page PNGs. The canonical wrapper exited 0; existing PG writeback and zero-tool arithmetic negative passed without raising the model budget.

Independent ZIP/XML inspection confirms exactly three slides. All three actual page PNGs were opened at original detail: bilingual headings/text are legible, two passed/one awaiting review is explicit, and budget/date remain TBD. No clipping/overlap was observed. The first draft failure is retained in attempt-1. The synthetic demonstration uses illustrative Experiment 1/2/3 labels and proposed next steps, not real organizational experiment identifiers. This validates the requested three-slide synthetic presentation, not every chart/master/notes/editing feature.
