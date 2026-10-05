# Measurement condition scope (#5338)

Fresh main base `ea1576a6aa4bddaa688ef7e3f6c19089e9703439`. Public synthetic report at runtime `85ec2c6e2fbe90bed0167aec236d7e85d7d51b18`, final raw SHA `9de08f57258a2b8915c502a8c3dadbb724d9e2d83ad8f544e0a188ea0b1d0543`, contains “不兼容项在本次检测中若为零，只支持本次检测未发现该冲突，不能推翻一般安装风险。” at line48. Independent review calls this conditional, not an observed zero. Original raw/source/attempts retained on integration evidence commit05c4bb4bc, unchanged.

Added eight meaningful controls: four direct same-count conditions, three unrelated/contrast conditions that cannot waive observations, and a conditional exact source quote that cannot support an actual observed count. Five RED/169 passed on unmodified production base; 174 GREEN with narrow fix. Initial draft RED included an extra control without the executed cue; corrected the control to “本次实际测量” and reran RED against unchanged base. `red.txt` is that corrected RED, not the initial draft.

Only exact count-subject + optional current measurement context + immediate 若/如果/假如 + count relation qualifies. The same observer is used for asserted and source counts, so a hypothetical source value is not evidence for an executed result. No global conditional disclaimer exemption, candidate rewrite, provider retry, API/schema/state/hash/version changes.

This repairs a finite syntax false positive only. Public report semantic FAIL, #5327 remains OPEN, #5339/#5340 separate. Does not approve unsupported defect exclusions/current procurement state/risk downgrade; original private cause UNKNOWN. No additional real model calls or deploy/merge.

Independent review REJECTed initial `9df835ec1`: NFKC converts Chinese semicolon to ASCII, but finite clause splitting omitted ASCII `;`, causing “本次检测不兼容项若为零；本次检测不兼容项为零。” to waive the second actual count. Added Chinese/ASCII semicolon regressions: RED2/174. Include ASCII semicolon in clause boundaries: GREEN176. Conditional scope ends at either form; real second observation remains rejected. Initial GREEN174 is superseded for final head.
