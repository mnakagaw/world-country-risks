# CountryRisks v2.0: source, release and restoration

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
calendar edition dates supply a same-method48h reference only when their coverage
is complete. At least10 valid days and a stable baseline are required for ratios;
until then R-INDEX is unavailable. RAW is a reporting sensor, not verified state
capacity. R4 retains the existing aid/sanctions/economic-pressure CAMEO population.

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
