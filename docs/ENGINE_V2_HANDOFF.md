Current daily synchronization: [ExecBrief03:00 gate and stage resume](EXECBRIEF_DAILY_SYNC.md).

# CountryRisks v2.0.3: source, release and restoration

Current assessment and acceptance contract: [RINDEX_V203.md](RINDEX_V203.md).
The former v2.0.1 contract is retained in MONITORING_V2.md as superseded history.

The v2 engine separates reporting-derived monitoring signals, data availability,
search interest and verified functional impact. It does not turn a method change
into daily deterioration or assert that engineering changes demonstrate prediction
accuracy. Existing dated legacy observations remain available under the old namespace.

`scripts/export_shared_gdelt.py` reads immutable ExecBrief NAS normalized artifacts
using their bulk/index manifests and full SHA256 checks. It opens its own in-memory
DuckDB, never the live shared DB. English Event table records are deduplicated by
GlobalEventID within a fixed DATEADDED interval; sports URLs are excluded. SQLDATE,
GDELT addition, article publication (unknown when unavailable), ingestion and run
time remain separate. Missing files/rows stay missing; no zero or old date substitution.

`generate_v2.mjs` preserves count-weighted Tone totals and known actor-geography
denominators in FIPS-to-ISO merges, plus raw codes and mapping version. Previous14
calendar edition dates are reconstructed from retained same-method48h source
windows. The primary assessment uses guarded absolute/composition monitoring;
qualified matched-source-time R comparisons are separate and need10 valid pairs.
Low or unavailable component baselines do not erase the whole-country assessment.
R4 retains the existing aid/sanctions/economic-pressure CAMEO population.

`generate_weekly_v2.mjs` binds generation, index, country readers and publication
to `data/history/weekly_5y` and the last completed ISO-week window. Its7d totals
are not compared to a48h baseline multiplied by7. Missing/incompatible7d baselines
remain unavailable. Legacy ratios are marked as a different, noncomparable method.

`verified-impact-v2` records use stable Event IDs, original-source identities,
body-review provenance, affected scope, impact and verification time. Reprints
sharing an original-source ID are one independent source. Candidate URLs do not
raise confidence and explanations are bound to the same signal/window hash.
The optional verified-input pathway needs accepted original-document reviews;
unreviewed GDELT and Trends items remain discovery metadata. Corrections should
supersede a stable Event revision while preserving old accepted snapshots.

The one Google producer is SecurityWatch `scripts/country_interest.py`, called
inside the existing general15 owner.35 individually tested feeds retain original
query, provider date, fetch completion, hash/revision, approximate traffic string,
related URLs and missingness. Repeated polls add appearance history, not topic
counts or traffic totals. Daily seals use03:00 JST and exclude observations completed
at or after the boundary. ExecBrief keeps03:15 publication and its original dated
reports. Consumers share snapshot IDs and never return-feed observations.

Readers: `/country-interest/` on all3 sites. The selected-country API is owned by
SecurityWatch; raw XML/SQLite never enter Git or a webroot. Current interest states
expire on missed checks; a historical seal does not change with later observations.
New disaster/security query revisions are private search hints for GKG, local-language
web and official-source review, with no severity/location/score promotion.

The daily local adapter is `scripts/periodic_adapter.py`; its schedule is the existing
shared Windows tick at05:07 JST. The legacy daily/weekly Actions are retired when
the local owner is activated. No account billing settings or purchases are changed.
The weekly adapter uses that same tick on Monday11:00 JST and reads the last
completed UTC ISO week. All country files are SHA-bound to one immutable release
epoch; the index selects it only after every file has been verified. The daily and
weekly adapters share one publication lock. The existing six jobs retain their owners.
The private controller `.local/controller.json` names the existing archive, Node,
ExecBrief source root, credential-file locator and NAS handoff root. Use a validated
bundled Node executable on this Windows machine. Required packages: project npm
dependencies and Python DuckDB. Successful local/public/NAS receipts are distinct
from an Actions CI result.

`deploy_v2.py` uses TLS and hashes, stores before bytes for changed files, publishes
immutable payloads first, then status/latest/manifest/root HTML. The actual v2007
webroot is `/domains/countryrisks.org/public_html/world`, verified against live HTML.
`handoff_v2.py` persists verified daily source DTO/snapshot/history/publication deltas
to NAS after publication and reads every SHA back before moving the latest pointer.
`handoff_weekly.py` saves the completed-week source DTO, bound index and all country
payloads under the same private NAS packet after the weekly release is verified.

Restore from private NAS `Codex/CountryRisks-Handoff/20261014-v2/`: initial source
bundles and private packet, then its immutable daily delta chain. Shared SecurityWatch
and ExecBrief supplement pointers identify the same packet. Restore all controllers,
Windows jobs and old Codex schedules disabled/PAUSED; update private path locators
and authentication without displaying secrets, check source/manifests and public
readbacks, and enable only one PC after the former owner is stopped. Do not roll
back live GDELT databases, original archives, queues or current worker state.

Acceptance covers calendar islands/current-day exclusion, real zero vs missing,
partial/low coverage, null baselines, weighted geography/Tone, RSS revisions and
non-additive buckets, exact cutoff, failed/stale/truncated feeds, immutable seals,
shared producer/consumer identity and full publication hashes. Additional verified
events, lead time, false hints and reviewer time require a longitudinal live audit;
they are not established by these implementation tests.

## Earlier display-only correction, 2026-10-14 (superseded acceptance)

The v2 briefing accepts multilingual strings as well as the legacy arrays/strings.
It is labelled monitoring data rather than AI-generated analysis. The map and header
share one display-state resolver: absent data, insufficient baselines and zero-score
ranking placeholders remain Unknown. Gray Unknown and green no-elevated-signal have
different colors and localized legend labels. Empty R-INDEX lists explain baseline
requirements and offer a user-controlled RAW switch instead of showing only Top0.
Missing scores are labelled unavailable, never rendered as undefined.

Acceptance uses the actual fixed publication in a separate headless Edge profile:
390px mobile, all240 R-INDEX countries unknown, distinct legend colors, no horizontal
overflow, readable briefing, RAW selection and country popup, EN/JA/ES and desktop.
The ordinary in-app browser bridge was unavailable; no user browser profile was used.
These are display checks and do not establish prediction accuracy or fill data gaps.
