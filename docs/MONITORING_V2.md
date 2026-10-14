# Country monitoring v2.0.1

**Superseded historical contract.** The all-modes color substitution and local
impact country-color promotion below are corrected in [RINDEX_V202.md](RINDEX_V202.md).
Current production preserves separate R-INDEX/RAW/combined news assessments and
does not turn operator scope into national failure. The original public snapshots
and method history remain available.

The main map assesses a qualified observed news sample. Its five levels are red,
orange, yellow, conditional green and Unknown. Comparison availability is a
separate property of each R component. Missing R2/R4 baselines cannot suppress
a supported R1/R3 signal. RAW, R-INDEX and ranking views share the same country
level resolver, counts, list and popup; ranking never creates a warning color.

## Population and reconstruction

- English GDELT Event records, canonical GlobalEventID deduplication and the same
  sports-URL exclusion. DATEADDED governs inclusion; SQLDATE remains the event date.
- Daily window: exact48h ending05:00 JST (20:00 UTC). Previous14 calendar dates
  exclude the current date. Reconstruction is retrospective, not past prediction.
- Manifest acquisition dates can differ from source dates. The read-only catalog
  uses declared windows and14-digit English export IDs, including older3h/24h
  batches. It verifies producer bulk/index epochs and normalized SHA256 bytes.
- Source/index/normalized absence, schema/read/hash failure stay distinct private
  diagnostics. No original archives, live databases, queues or workers are changed.
- October14 input remains120/192 slots,72 genuinely absent originals. All72 are
  already pending in the existing collector. Longest gap150 minutes. No zeros are
  substituted for missing slots and no partial counts are extrapolated to48h.

## Primary assessment and R comparisons

The initial absolute/composition path retains the existing configured count/share
thresholds. Positive detection needs at least50 country records,10 URLs,3 domains,
8 distinct observed hours,24h span, at least50% source slots, no rejected rows,
and no gap or final source age over180 minutes. Small samples use the configured
count floors and a conservative Wilson-shaped composition guard. GDELT records
are clustered; the guard is a heuristic, not a95% confidence guarantee.

Green requires additional coverage:200 records,20 URLs,5 domains,12 observed hours,
valid tone on80% of records and50 records with known actor geography. It means
only **no elevated signal in this qualified observed sample**. It does not establish
national safety, absence of impact, normal state functions or fiscal capacity.

Each daily comparison pairs the current and prior day only at source-time offsets
observed in both. At least96/192 matching slots per pair and10 of the previous14
dates are needed. For each R, the median matched baseline must be at least3.
The ratio is the median of `(matched_current+5)/(matched_prior+5)` over valid pairs,
with inherited1.75/2.75/3.75 thresholds. This is explicitly labelled a matched
observation comparison, not growth of complete48h national incident totals.
Baseline zero/low or insufficient days makes only that comparison unavailable.
An available supported component can upgrade the main assessment independently.
Per-pair audit counts remain private; the public snapshot carries the method,
paired medians, available dates and minimum/maximum matched source slots.

R1/R2/R3/R4 are news-record indicators. R4 denotes aid, sanctions and economic
pressure; it is not measured fiscal capacity. URL/domain counts do not establish
independent incidents or independent evidence origins.

## Verified functional impacts

Consume accepted ExecBrief operator/authority service-disruption facts and retained
native captures. Verify actual source bytes, exact body excerpt, URL, retrieval,
review, cutoff, validity and accepted/source-manifest SHA bindings. Related URLs
from one operator remain one original source. Unreviewed GDELT URLs and Trends
stay discovery. Scope, publication date, review time and recovery statements remain
visible. Publication within3 days plus valid acceptance permits a current scoped
signal; older confirmations stay historical without asserting continuing outage.
October14 imports IDCF and Nissui as historical confirmations and Albert Heijn /
Ahold Delhaize as a valid scoped logistics/online-delivery disruption for NL.

## Completed weeks and ownership

Weekly data uses actual completed UTC ISO7d windows. Reconstruct retained sources,
never multiply daily totals or a48h baseline into7d. Initial count floors and
temporal sample requirements scale for the7d unit; observations themselves do not.
Weekly comparison needs4 of the previous8 weeks with336/672 matching source slots.
The October5–12 week has600/672 slots. Only3 prior matching weeks are retained,
so weekly ratios remain explicitly unavailable while initial monitoring works.
The implementation computes real weekly ratios when enough matching weeks exist.

The existing daily/weekly Windows jobs call reconstruction, accepted-impact binding,
generation, build, TLS/HTTP SHA verification and NAS persistence under one lock.
No new collector, paid BigQuery query, all-article AI pass or schedule is introduced.
Existing ExecBrief/SecurityWatch owners and cutoffs stay intact. Restore all jobs
and private controllers disabled; never restore over a live source DB or queue.
Disposable local parquet copies are removed after each cycle.

## Acceptance

Tests cover all5 levels, observed zero vs missing, sparse components, small samples,
source diversity, gaps/staleness, FIPS merging, canonical names, exact matching
offsets, real7d requirements and native accepted body/cutoff/epoch binding. The
archive fixture tests acquisition/source-date differences, batch windows, missing
slots, changed normalized bytes and mismatched index epochs.

Actual local and public browser checks use an isolated headless Edge profile:
390px mobile and1440px desktop, JA/EN/ES, persisted R-INDEX, all3 modes, every color
filter, map paths, header counts, list and popup on one snapshot. Screenshots are
visually inspected. Immutable old publications and before bytes are retained.
These checks establish implementation consistency, not prediction accuracy.
