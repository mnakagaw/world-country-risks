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
