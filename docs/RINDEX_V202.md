# R-INDEX v2.0.2: purpose, preserved guards and changed comparison

R1–R4 retain the project's intended role: reporting proxies for concern about
expected political goods and possible pressure on trust/legitimacy. They are not
direct observations of public opinion or an official Rotberg four-part formula.
Functional conditions are independent corroboration, counterevidence and context;
stable/improving objective statistics do not cancel a reporting-salience signal.

## Separate public modes

| Mode | Country color | Green means |
|---|---|---|
| R-INDEX | Matched baseline comparisons after activation guards | No guard-qualified activation among available components |
| RAW | Initial observed counts/composition | No elevated signal in the qualified observed sample |
| Combined news monitoring | Initial signal plus guarded R comparisons | No elevated qualified news signal |

Map, counts, list and popup agree **within each mode**. Different modes can and
should differ. Operator-scoped service facts remain separate: no automatic
country color from the maximum local severity. National functional/perception
scores are not implemented or calibrated by this correction.

October14 fixed input (unchanged SHA/cutoff/baseline observations):

| Mode | Red | Orange | Yellow | Green | Unknown |
|---|---:|---:|---:|---:|---:|
| R-INDEX | 1 | 2 | 15 | 99 | 122 |
| RAW | 1 | 27 | 20 | 39 | 152 |
| Combined news monitoring | 2 | 27 | 25 | 34 | 151 |

US: R-INDEX Green/active maximum0, observed comparison maximum≈0.992, combined
news Red. JP: R-INDEX Green, observed maximum≈0.944, combined news Orange. NL:
R-INDEX Green, observed maximum≈1.004; the accepted retailer disruption remains
provider/channel scoped, not national functional failure. These are meaningful
method differences, not competing claims of national safety.

## Preserved and restored core

Canonical `config/scoring.json` binds smoothing k=5, baseline median minimum3,
Yellow1.75/Orange2.75/Red3.75, each R absolute/share threshold and high-volume5000.
Activation requires a stable comparison AND `share_hit || (abs_hit && !high_vol)`
AND the applicable ratio threshold. High-volume absolute-only activity is
suppressed. `max_ratio_active` uses active components only:0 means evaluable but
no activation; null means no evaluable country comparison. Individual unavailable
components do not erase a valid remaining component.

R1/R3 use the Orange threshold when known actor/action geographic alignment is
at most0.20. This restores the old external-pressure proxy guard, not verification
of external pressure. The denominator is canonical records with at least one
known actor geography; the numerator has an actor geography matching ActionGeo.
FIPS aliases merge numerators and denominators, not precomputed ratios.

Intentional conservative missing-geography change: fewer than50 known actor
geographies or inconsistent counts produce null classification, not domestic=1
or confirmed external noise. R1/R3 then use an explicitly labelled conservative
Orange threshold. This differs from legacy's missing→1.0 fallback and is not a
threshold relaxation. Country denominator/time/source eligibility is separate.

## Comparison improvement, not mathematical identity

Legacy formula: `(today+k)/(max(1,baseline_median)+k)` using a historical baseline.
v2: median of individual `(matched_today_day+k)/(max(1,matched_prior_day)+k)`
ratios, over at least10 of the previous14 calendar dates, each with96/192 common
source-time offsets in the fixed48h window. Missing slots stay missing. No
extrapolation, synthetic zero window or imported5y/test3d baseline enters this
production comparison. This method is not numerically identical to legacy.

The audit recalculates all239 countries/956 R rows. It separately records v2.0.1
diagnostics, unguarded/guarded matched comparisons, the legacy formula on the
same matched population, and a clearly marked counterfactual using the retained
old5y baseline (2021-01-23–2026-01-23, zero filled, SHA bound). The last is not a
replay or a validated equivalent population. Guard/eligibility differences affect
15 country colors; formula-only differences affect2. Counts were not tuned to
obtain a desired number of red/orange/yellow countries.

Weekly comparisons remain actual7d series with4/8 matching weeks, not48h×7.
Weekly absolute/high-volume thresholds use the declared7d scale. Current W41 has
only3 usable prior weeks, so R-INDEX remains unavailable while combined weekly
news monitoring is separately available. Old epochs remain immutable.

## Theory and evidence design review

[Rotberg, When States Fail, chapter1](https://assets.press.princeton.edu/chapters/s7666.pdf)
discusses effective political goods and, on printed p9, legitimacy, citizens'
trust and the social contract. This supports examining both outcomes and social
response; it does not supply this project's news-count formula.
[Rotberg's five bundles](https://www.cigionline.org/articles/measuring-governance-improve-lives/)
are safety/security, rule of law/transparency, participation/human rights,
economic opportunity and human development. R1–R4 are project-specific views.

The review retains three separate observations: (1) verified events, functional
delivery and harm; (2) domestic media salience/persistence/spread and supplementary
search interest; (3) residents' response, trust, government appraisal and possible
political spillover. ActionGeo is event geography, not reader geography. Negative
Tone is not measured fear/distrust; Trends does not assign sentiment direction.
One incident can generate meaningful sustained reporting: incident identity,
article/republication paths and independent evidence origins must stay separate.

Three accepted ExecBrief operator cases are reviewed from retained native bodies
and accepted manifests: IDCF's495 affected organizations/four cloud zones, Nissui's
receiving/dispatch stoppage and Albert Heijn's mixed recovery across channels.
National affected populations, denominators, substitutes, state responsibility
and residents' trust reactions are unestablished. Component recovery is preserved;
publication age/expiry cannot prove continuity or recovery.

Chile motivates keeping objective conditions and perceptions distinct. The
[official2025 homicide report](https://www.fiscaliadechile.cl/actualidad/noticias/nacionales/informe-nacional-de-victimas-de-homicidios-consumados-2025-muestra)
reports a rate decline6.1→5.4. [INE's ENUSC2024 release](https://www.ine.gob.cl/sala-de-prensa/prensa/general/noticia/2025/07/07/subsecretar%C3%ADa-de-prevenci%C3%B3n-del-delito-e-ine-presentan-los-resultados-de-la-encuesta-nacional-urbana-de-seguridad-ciudadana-%28enusc%29-2024)
reports87.7% perceiving more crime nationally. They are different years, questions
and measures, not a same-date causal test. The asserted single corpse-discovery→
government-collapse causal chain remains unverified. Election turnover, approval
loss, functional failure and state collapse are distinct outcomes.

New national functional or legitimacy colors/coefficients/probabilities require
a reviewed measurement contract and validation against suitable surveys and
case evidence. No new model, collector, worker, schedule or spend is introduced.
