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
