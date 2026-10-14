# CountryRisks v2.0.3: concurrent R alerts and evidence boundaries

R1–R4 retain the project intent: reporting proxies for residents' concern about
expected political goods, with possible pressure on trust and legitimacy. CAMEO
records are neither measured resident opinion nor objective state-function scores.
Actual function/harm, reporting salience, and resident/government appraisal are
separate layers. Improving physical statistics do not erase a salience signal.
Negative Tone alone does not establish fear or distrust; ActionGeo is not a reader
location. No new perception/function model or claimed precision gain is deployed.

## Country severity and original design

The country R-INDEX aggregates concurrent, supported R activations in the same
window: one R = Yellow, two = Orange, three or four = Red. A single extreme domain
can have Red domain intensity while the country remains Yellow. The maximum active
ratio remains domain detail/ranking, not the country color. VOL, Tone, search
interest, proposed next-R spillovers and provider impacts cannot add an R.

This reconstructs the project's bundle intent, rather than claiming the previous
published R-INDEX already used it. `scoring.mjs` had 3/2/1 bundles with a Yellow
Tone gate but also incorrectly admitted VOL; the January2026 `generate_daily.js`
R-INDEX and v2.0.1/2 used maximum active ratio. The first valid R in current R-INDEX
is Yellow without a Tone gate, consistent with the early-warning intent and the
old max-based R-INDEX. Legacy bytes/calculations are retained separately.

## Comparison and guards

Configuration retains k=5, median minimum3, domain intensity thresholds
1.75/2.75/3.75, original absolute/share gates, high-volume floor5000 and R1/R3
actor/action alignment guard. Alignment <=0.20 raises the activation threshold to
Orange. Unknown actor geography stays null, not domestic or confirmed external
noise; the conservative Orange threshold for R1/R3 is explicit.

The comparison formula is the median of paired same-offset ratios
`(today+5)/(max(1,baseline)+5)`, using the previous14 calendar edition dates and at
least10 valid pairs with >=96/192 common slots. It is not mathematically identical
to `(today+5)/(past_median+5)`, nor a replay of the old zero-filled5y baseline.
The fixed48h half-open DATEADDED population and missing slots are retained.
The support supplement preserves those counts, windows and pinned archive bytes.

Bundle support requires exclusive R-category records passing the same count/share
gate and distinct canonical article groups. A group cannot alone supply two R
activations. This guards duplicate labels; it does not prove independent incidents
or resident sentiment. Available Rs may alert while others remain unknown. A zero
active maximum is distinct from an unavailable evaluation/null maximum.

## Public modes and weekly use

| Mode | Color basis |
|---|---|
| R-INDEX | Guarded relative activation, concurrent supported R count |
| RAW | Qualified initial absolute/composition R count |
| Combined news | Initial monitoring plus supported relative R comparisons |

Map, counts, list and popup agree within the selected mode. Mode colors may differ.
October14 fixed cutoff `2026-10-13T20:00:00Z`, partial120/192 slots:

| Mode | Red | Orange | Yellow | Green | Unknown |
|---|---:|---:|---:|---:|---:|
| R-INDEX | 0 | 2 | 16 | 99 | 122 |
| RAW | 1 | 27 | 37 | 25 | 149 |
| Combined news | 1 | 27 | 37 | 25 | 149 |

The existing country Expand screen retains its52w/5y Signal/State/Intensity matrix.
Select original legacy or v2 calculation series; no duplicate weekly/timeline
screen was added. The legacy Bundle row projects concurrent R count, while original
max-based levels remain in the source. First Lit is the first observed activation
in the selected method/range, not event onset or forecast success. Unknown weeks
are marked `?`, never off. Indicator-off does not prove physical recovery; temporal
sequence does not prove causal diffusion. Current v2 weekly comparisons remain
Unknown because only three preceding completed weeks exist; four are required.

The row audit preserves all215 original country histories;24 territories had no
original5y file. JP2026-W31 has only R2 on (4.383x), then off in W32: the concurrent
projection is Yellow then Green, despite the original maximum-based Red in W31.
ML2022-W01/W02/W03 shows sustained R4 then R3 then R1, yielding Yellow/Orange/Red.
No adjacent original three-week R4→R1→R3 example was found; that specific order is
a synthetic rule fixture, not a claimed historical case. Duplicate original week
rows are retained rather than silently rewriting history.

First Yellow opens a practical card: current R/evidence/location, checks for the
government response, potential next R (not counted), escalation and recovery checks.
R1→R3 prompts victim protection, help/prevention and factual response transparency;
R4→R2/R1 prompts actual arrears, essential procurement/benefits and affected groups.
Authority, available resources and response effectiveness remain unverified.

## Article and SNS capability contract

ExecBrief canonicalization and accepted original bodies/translations are reused.
The small, body-SHA/policy/metadata-bound annotation cache distinguishes degradation,
improvement, related and unknown claims. Five accepted original articles illustrate
coarse cyber-topic R1 versus service-access R2, channel-specific recovery, and the
absence of public-finance/government-trust evidence in retailer statements. This
is a reviewed subset, not all-GKG classification or a measured precision result.
The cache makes zero new AI calls. Generic ExecBrief desk/topic or incremental_luna
metadata classification is not automatically an R-crisis classification; unseen
reviews remain unassigned/unknown. Body review/canonical IDs and article annotations
never enter CAMEO Event numerators or their historical baselines.

The source ledger identifies actual capabilities. Google Trending Now is selected
shared search interest. Legacy GetDayTrends supplies trend-topic/volume data, not
post text, and is not invoked by v2. A resident SNS post/context corpus is not
connected here. Media/politician/repost/unknown-location content must not be called
resident appraisal; no new acquisition job or paid source was added.

Conceptual references (project R1–R4 are an adaptation, not an official Rotberg
four-part equation): [Rotberg, political goods and legitimacy](https://assets.press.princeton.edu/chapters/s7666.pdf)
and [CIGI, governance outputs and political goods](https://www.cigionline.org/articles/measuring-governance-improve-lives/).

## Verification and restoration

36 core tests, pinned artifact adapter test, actual source-body SHA checks, method
audit and browser acceptance cover the implementation. CSV comparisons isolate
formula/guard/bundle changes and retain old counterfactuals. They establish no
global classification precision, causality or forecasting accuracy. Publication
requires TLS transfer and independent public HTTP SHA readback, immutable payloads
before pointers/HTML. GitHub source and private NAS source/input/receipt deltas
retain earlier published versions. Restore controllers/jobs disabled; never replace
live shared databases, queues or workers. Existing six shared and two WCR jobs
keep their owners; no new schedules, collectors, BigQuery fill or all-GKG AI run.
