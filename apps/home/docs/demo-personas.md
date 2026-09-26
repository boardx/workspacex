# Demo personas — who the scripted demo is for

The ten scenarios in `assets/js/demo.js` are written for these readers. Each
persona is drawn from what the large consultancies and researchers report
about AI adoption, and each one owns at least one scenario card.

## About the sources — read this first

This file is **design input, not citation**. The research was gathered in a
cloud session whose network policy blocked mckinsey.com, bcg.com, bain.com,
deloitte.com, pwc.com, kpmg.com, ey.com, accenture.com, gartner.com, hbr.org
and the Chinese research sites. Only microsoft.com opened, and even there the
pages reached the researcher through a summarizing model, so no sentence below
has been read verbatim. **None of these figures may appear on the site** until
someone opens the original page and copies the exact sentence — the site's
whole promise is that every claim is traceable, and it cannot cite what nobody
has read. The numbers inside the demo itself are sample material, labeled as
such on the page.

Leads, with the page each should be verified against:

| # | Lead (unverified) | Where to verify |
|---|---|---|
| L1 | Most organizations use AI; about a third have scaled it; a small share see enterprise-level EBIT impact | McKinsey, *The state of AI* (2025, 2026 editions), mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai |
| L2 | Employees report productivity gains while enterprise EBIT is flat; expected AI headcount reductions mostly did not happen | McKinsey, *The state of AI in 2026: On the road to ROI* |
| L3 | Leaders underestimate how much their employees already use gen AI | McKinsey, *Superagency in the workplace* (Jan 2025) |
| L4 | Most companies struggle to achieve and scale value; strategy and workflow redesign matter far more than tools | BCG press release 24 Oct 2024; BCG *AI at Work* 2025/2026 |
| L5 | Managers fear job loss more than frontline staff; people now spend time directing AI rather than doing the work | BCG *AI at Work* 2025/2026 |
| L6 | Pilots work but do not scale; costs exceed plan; data-security concern rising | Bain, *Executive Survey: AI Moves from Pilots to Production* |
| L7 | Many employees hide AI use, rely on output without checking it, and have made mistakes because of it | KPMG / University of Melbourne, *Trust, attitudes and use of AI* (2025) |
| L8 | Few CEOs see both cost and revenue benefit from AI | PwC, 29th Global CEO Survey (Jan 2026) |
| L9 | Many firms cannot calculate AI ROI | Deloitte China 2026 enterprise AI survey (seen only in Chinese media) |
| L10 | AI-related risk has already cost firms money; governance lags agent adoption | EY Responsible AI Pulse (Oct 2025); Deloitte *State of AI in the Enterprise 2026* |
| L11 | Employees bring their own AI tools, often without admitting it; fear it makes them look replaceable | Microsoft & LinkedIn *Work Trend Index* 2024 |
| L12 | Higher confidence in gen AI goes with less critical thinking; the work shifts to verifying output | Microsoft Research, CHI 2025 (Lee, Sarkar et al.) |
| L13 | Polished AI output that creates rework for the receiver ("workslop") | HBR / BetterUp Labs / Stanford, Sep 2025 |
| L14 | Many gen-AI projects abandoned after proof of concept for data, risk, cost or unclear value | Gartner press releases 2024–2025 |

## The personas

Each: what keeps them up, what they need to see in ninety seconds, what
would make them close the page, and the scenario written for them.

**1. The CEO or owner of a mid-market company** — 老板 (L1, L2, L4, L8)
"We spent the money and I can't show the board what it changed."
Needs: an answer in their own numbers, and one decision handed back to them
rather than buried. Closes the page on: hype, or a sales pitch dressed as a
demo. → *AI-native path*.

**2. The CFO** — 财务总监 (L1, L2, L8, L9)
"Every vendor dashboard says it works. My P&L doesn't."
Needs: vendor metrics separated from business outcomes; what to renew and
what to measure first. Closes on: a number with no source. → *AI return on
investment*.

**3. The COO or transformation lead** — 运营副总 (L4, L6, L14)
"We have dozens of pilots and almost nothing in production."
Needs: why pilots stall (no measure, no process owner), which one to scale.
Closes on: "run more pilots." → *AI transformation strategy*.

**4. The head of people** — 人力负责人 (L2, L5, L11)
"My people ask whether their jobs are safe, and I have no honest answer."
Needs: tasks versus roles, a path to open work, and permission to say what
nobody knows yet. Closes on: a layoff number presented as insight. →
*Workforce & skills*.

**5. The general counsel, CIO or risk lead** — 法务总监 (L3, L7, L10, L11)
"Client data is already in chatbots, and banning them didn't work anywhere."
Needs: a policy people will actually follow, and a record to show a client.
Closes on: "ban it." → *AI governance*.

**6. The function leader under a number** — sales, service, product,
innovation (L1, L4, L6)
"I have one quarter and one bet." Needs: the real cause, not the
recorded one. Closes on: the obvious fix the team was about to ship. →
*Sales win rate*, *Customer operations*, *Design thinking*, *Innovation*.

**7. The expert or frontline worker** — the claims processor, the senior
technician (L5, L7, L11, L12, L13)
"Using AI well might prove I'm replaceable — and checking its work is now my
job." Needs: to be treated as the knowledge, not the cost. Closes on: being
described as a line to cut. → *Frontline expertise*, and the reader over the
shoulder of *Workforce* and *Customer operations*.

## What this changes in the demo

- Every scenario opens on one of these people, by role, with the question
  they would ask at 2 a.m. — the cards at the top of the demo.
- Every withdrawn claim is a move these reports describe as common and
  wrong: cutting heads on a share of hours, banning tools people already use,
  counting vendor activity as value, launching more pilots, buying licenses
  instead of changing work.
- The reviewer is the answer to L7, L12 and L13: output is checked against
  its sources before anyone relies on it, and what fails goes to a person.
