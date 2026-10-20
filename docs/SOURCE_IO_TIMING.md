# Source metadata reuse and stage timing, 2026-10-15

Applies at the next normal existing owner run. The verified08:25 October15
publication is unchanged. No measurement-only publication/reconstruction, new
collector, worker, scheduler, API AI or shared worker/profile edit is introduced.

`RunMetadata` belongs to one source subprocess. Each distinct manifest/index is
fully read, SHA256 calculated and JSON parsed on first use. Catalog, selected-raw
binding and fallback share that document within the run, with per-path locks so
parallel lookups do not duplicate the first read. Every expected selected-manifest
SHA is checked on a hit too. Before bootstrap, every used original NAS document
is fully read again, SHA256 checked and compared byte-for-byte with its original
epoch. Missing/changed documents fail the source run; stat/mtime are not proof.
The cache is not persisted across runs. Normalized NAS Parquet and its local
read-copy SHA verification remain in place. The normalized-root resolution is
shared within the catalog instead of repeated for each row; path containment
checks for every normalized file remain.

The index SHA is no longer recalculated for every file row. A changed day also
passes its already verified artifact rows to aggregation, avoiding a second
identical artifact-acquisition pass. Current upstream raw-ID/SHA filtering remains
strict, with no general fallback for unselected originals.03:00/48h, DATEADDED,
R definitions, SQL, R support, missingness/Partial and old histories are unchanged.

The existing daily DTO cache already reused13 historical days in the first
production run; this is not a new optimization. A numerical AST/config/R-support
fingerprint keeps that exact known pre-change aggregation epoch compatible with
existing DTO stamps, independent of transport/timing changes. Only the exact known
fingerprint maps to the legacy epoch; a real calculation/config/support change
gets a different method. Every DTO reuse still requires the current, SHA-verified
source-row epoch to match. Full downstream cycle identity continues to include
the transport, aggregation-fingerprint and calculation code files.

The source rebuild receipt and cycle's `stages.source.performance` contain:

- Actual UTC start/end and monotonic elapsed time, including catalog, each day,
  full metadata end recheck and bootstrap.
- Distinct metadata files, actual reads/SHA calls/JSON parses, bytes, cache hits
  and full end-recheck counts; normalized read-copy entries are separate.
- `baseline_dto_existing_cache` for the old day cache, and
  `prepared_artifacts_for_aggregation` for the newly avoided second acquisition.

`stage_attempts` records actual source/generate/build/publish/handoff execution
start/end/elapsed/status, including failures. Stage timestamps are not replaced
by a reuse event. `reuse_counts` and `reuse_events` separately record validated
stage skips and complete-cycle reuse; validation time is not execution time.
The source's small `source-metrics.json` permits failed attempts to retain their
timing/counters without claiming successful data or overwriting prior success.

Small fixtures verify parallel deduplication plus full recheck, same-size/mtime
drift, expected SHA on cached hits, index changes and unselected raw data,
unchanged48h cutoff/aggregation output,13 pre-existing DTO reuses with15 artifact
passes/two exports, blocked bootstrap on drift, and failure/resume/reuse timing.
These establish correctness and operation counts, not production speedup. No
shortening percentage or next-run success is claimed before its normal receipt.

Restore all native controllers/profiles/jobs stopped and Actions disabled. Preserve
live DB/queues/authentication, verified input bundles and publication history.

October19 transport follow-up: inspect each window directory's timestamp before
probing its manifest filename, including under acquisition labels such as
`historical-year`. Out-of-window years no longer incur a manifest existence probe.
Directory existence/type is established by enumeration and the actual bound
file read, without an extra per-window SMB stat before that full read.
Canonical normalized paths shared by overlapping manifests are resolved once
within this run, with per-path locks. Every row still checks canonical containment;
all metadata/normalized byte and SHA checks remain. Path caching alone certifies
no bytes, is never persisted, and a new source process starts cold. Counters
`path_resolutions` and `path_resolution_hits` distinguish this from DTO reuse.
The normalized byte reader uses unbuffered binary FileIO to avoid a duplicate
SMB EOF read by the buffered layer. It still reads until EOF and preserves both
the full source-byte SHA and the private read-copy SHA checks.
Missing selected-window manifests are reported as missing and never become zeros.
The final full-byte/SHA metadata recheck uses at most four concurrent readers;
every original is still reread. Any changed/missing document blocks bootstrap.
Loaded source subprocesses keep their original code; the next existing owner's
source subprocess loads this change. Scoring, source SHA gates and scheduling
are unchanged. Fixture results are not a measured production speedup.

## Bounded immutable transport, October19 follow-up

`rebuild_baselines.py` first verifies each normalized source by a complete
streaming SHA256 read, with no read-copy write, and calculates the existing DTO
epoch from those verified rows. A matching historical DTO therefore needs no
normalized read object. A cache miss materializes only its required objects,
streaming bounded chunks, checking the source SHA and byte length, and fully
reading the destination SHA back. Overlapping windows still share only this
source subprocess's verified-source map. The final full original manifest/index
recheck remains mandatory before bootstrap. Selected supplemental normalized
versions cannot fall back to a different Parquet version for the same raw ID.

With `external_storage=true`, immutable source objects and completed DTOs use
`F:\Codex-Storage\world-country-risks\immutable\source-objects` and the
series-specific `immutable\source-dtos\<namespace>\baseline-sources` cache.
The registered volume GUID, marker and capacity are checked before admission and
each transport write; no external failure falls back to C. Existing DTO inputs
remain preserved. A matching legacy DTO can be read under its byte cap and
SHA-verified into the F DTO cache during the same normal source stage. No manual
migration or second copier is introduced. Frozen policy may set
`source_io.history_path` and `source_io.report_path` to scoped registered F
paths, and `series_root` may be under that same project root.

The Python transport enforces a256MiB per-source object ceiling,16GiB of new
source-object writes per run,32MiB per DTO/output, and bounded concurrent pending
reservations. Cold DTO and other Python output categories each have a512MiB
write ceiling. Resource excess defers the source stage; it never changes
available sources into missing records or truncates data. DuckDB retains its
512MB memory limit and two threads; its explicit temporary directory stays in
the task-owned C work area with a512MiB spill ceiling. The isolated spill
directory is removed after the connection closes.

The ordinary daily caller keeps its8GiB expected C peak plus20GiB reserve.
`daily_paths(..., c_write_plan=...)` accepts a smaller calculated peak only for
an exact, reviewed writer code chain and a finite enforced per-file inventory.
The versioned plan binds full source hashes,512MiB spill, and every scoped C
promotion/control/log ceiling. Storage code itself counts the complete public
logical hydration size,64KiB per public file, twice every new file ceiling for
pending/replacement,64KiB per planned copy, and256MiB miscellaneous allowance.
Unknown/changed writer code is rejected. A declaration without reviewed complete
writer coverage cannot lower admission. Node bootstrap/history/public writers
must be covered by the caller's F placement and caps before using this path.

Small isolated tests verify hash-only/no-copy behavior, full source/destination
hashes, bounded external placement, resource refusals, reserve preservation,
explicit spill settings/cleanup and the reviewed-plan gate. A2507-byte Parquet
fixture covers duplicate IDs, cutoff boundaries, sports, invalid Tone and three
countries. Its numerical aggregation AST and condition AST match the original;
semantic DTO fields match after accounting only for pre-existing unordered SQL
DISTINCT sets. Moving read objects changes the existing source-manifest hash
because it binds private `read_path`; that transport change is retained. Full
calculation/transport signatures remain truthful. These are correctness and
bounded-write checks, not measured production timing or a publication.

## JSON chunk coalescing after the first real supplement

The first accepted12-source correction completed under source commit87d163b and
the original bounded helper SHAa04fa39d. Its actual source stage took1380.187
seconds, reused12 DTOs and rebuilt3. All2373 source metadata documents passed
the final full-SHA recheck. New JSON writes in that run exposed excessive calls:
passing every small `JSONEncoder.iterencode` fragment to the guarded writer made
the16/18/19 DTO stages take627.544/243.253/248.753 seconds. Keep these timings
with that executed code version; they are not a benchmark for the later fix.

After the publication/NAS transaction naturally released its OS lock, the owner
installed the exact reviewed helper SHA7763c92bfb385a179ace2a008e156fdfd9ccdfd58727453df39f904c7bbb017a.
It coalesces UTF-8 fragments into at most64KiB chunks, splitting large fragments
as needed. Every chunk still checks volume identity, marker, capacity, reservation
and byte limit before writing. No reserve, source/row quality, SQL or R rule changes.

Installed-code isolated checks passed18 cases. A358891-byte fixture produces
exactly the same bytes while reducing84002 encoder fragments to8 actual guard
calls (including admission). Unicode, escaping, oversized fragments, short writes,
overflow/capacity refusal and original-file preservation are covered. These are
fixture counts; a production speedup has not yet been measured. The stable DTO
namespace proposal remains separate and unapplied.

## Bounded daily revision build

The later cumulative36-source native continuation completed with99/192 observed
slots. Its actual source stage took251.939 seconds, with12 DTO reuse/3 rebuild
and2402 successful full metadata end rechecks. This run used the64KiB helper,
but input and cache states differ from the first run; the entire elapsed-time
difference cannot be attributed to batching. RAW and monitoring assess63 countries;
R-INDEX still has239Unknown because the comparison requirements remain unmet.

Late-source revisions now build the client with `--client-only` and Vite's
`copyPublicDir:false`. An inline copier stages only the existing non-weekly
deployment contract: recursive assets, country-interest and data/v2; the six
country-interest root scripts/styles; and the two country overview geo files.
The compiled root index is retained. All old daily date/revision JSON remains
available before the generated-v2 overlay; weekly/history data is not copied.
Conflicting public/compiled assets, escaped/reparse paths, changed source bytes,
more than4096 files, more than1GiB total or64MiB per file defer before publication.
Every copy verifies SHA/readback and registered F identity/capacity. A retry resets
static daily data before reapplying generated outputs. C originals are untouched.

One isolated client build and positive-copy/overlay produced exactly the same
28 paths and SHA values as the verified99-slot publication. Its completed dist
was110183198 bytes, compared with the earlier full-public copy of about1.43GB.
That is a file-copy equivalence check, not a source replay or another publication.
Temporary validation output was removed. The native run lock and publication
lock must both be held when installing this code at a natural owner boundary.
Default C admission8GiB plus20GiB reserve and F reserve50GiB remain unchanged;
the reviewed lower-C-plan allowlist stays empty. Stable DTO namespaces remain
separate and unapplied.

## SHA-bound DTO views and versioned NAS objects (applied October20)

The reviewed generation installed at05:09:22 UTC on October20 keeps all original normalized-source SHA reads,
private-object readbacks, and full original metadata end rechecks. It does not
incrementally sum Event IDs, change SQL/R/classification, or infer data from raw
presence. Source progress has a bounded64KiB optional receipt for artifact SHA
verification, DTO lookup/reuse, exact aggregation, metadata end check and bootstrap.
A locked optional progress file records a diagnostic failure; mandatory input,
storage and final metric guards remain authoritative.

Historical DTOs that already pass the existing row/method epoch gate become
read-only SHA-bound inputs to `bootstrap_baseline.mjs --source-index`. A revision
does not copy all old DTO seeds into its series or rewrite them into another DTO
namespace. A newly computed DTO enters a stable F object cache only after the
original metadata end check. Its epoch key binds all input rows; its contract
also binds the complete writer, calculation/config/R code, producer canonicalizer,
archive identity, cutoff hour and series. Old-writer DTOs are not labelled as
new-writer cache objects. The new and original bootstrap entrances produce the
same history/report bytes for the same fixture. Bootstrap retains its original
calculation, now with a1GiB heap bound,512MiB history ceiling and storage peak guard.

`wcr-daily-handoff-objects-v2` keeps source, snapshot and publication as flat
members. History and upstream controls use SHA256-addressed NAS objects. History
is read as at most64KiB line fragments and emitted as at most4MiB exact-byte
parts, resetting alignment at pretty-JSON top-level date keys. Compact/long-line
history is also lossless and bounded. No whole-history JSON parse or reserialization
is used. A first new-format generation seeds objects; later unchanged parts are
fully SHA-verified and referenced, while changed parts alone are written.

The existing publication lock and one NAS object-store OS lock serialize writes.
Each object retains pending-byte SHA, final readback and immutable-conflict checks.
Before writes NAS reserves20GiB plus the bounded peak; F identity/marker and50GiB,
C20GiB plus the existing8GiB admission, and the empty lower-plan allowlist remain.
Per-file expansion is capped at512MiB, packet expansion at1GiB, parts at4MiB and
8192 references. Unknown kinds, wrong lengths/order/whole SHA, missing/corrupt
objects, escaped/reparse paths and interrupted output are rejected. Original flat
packets and their manifests are never rewritten or retired by this change.

The actual recovery entrance is `python scripts/handoff_objects.py --latest
<NAS>/daily-latest.json` for verification, or `--manifest <packet>/manifest.json
--sha256 <full-manifest-SHA>`. A new latest locator binds its manifest SHA and
schema; an old locator requires an explicit manifest SHA. Add `--output
F:/Codex-Storage/world-country-risks/restores/<new-name>` to materialize every
original member byte into a new, guarded F staging directory. Every recipe is
verified before creation and again while restoring; pending bytes get full local
readback. The destination must not exist, and restored jobs/databases remain
disabled. This does not restore live queues, DBs, profiles or credentials.

Handoff receipts distinguish local input reading, NAS writes, pending/final SHA
reads, reused objects/bytes, per-member time and total elapsed time. Revision
receipts now record handoff separately from generation/build/publication. The
published slot label means verified15-minute inputs used in that aggregate,
separately from raw inventory, normalization and formal acceptance. Unknown reasons
and mode counts retain their original quality gates. Fixture reuse/operation counts
are not a production speedup; only the next existing native receipt measures it.

The installation held both the native run lock and publication lock, after the
94/192-slot continuation reached its verified NAS terminal. No worker was started
or restarted and no completed source epoch was replayed. The10-path reviewed graph
is `a44d121df8d7a3492cfa9477a461e031d97d4e75aafbe958a5ad5199779fc5b3`.
Earlier paragraphs describing stable namespaces as unapplied are historical
checkpoints. Their deployment state is superseded by this installation.

The preceding continuation used the previous implementation: source2205.335s,
bootstrap11.221s, generate10.411s, client10.583s, publication782.966s and about657s
between public verification and the native NAS terminal. These are separate
operational observations, not a before/after speedup comparison. The new source
cache and NAS object reuse still require a genuinely new formal input through the
existing native owner; the first object-format packet will seed the object store.
