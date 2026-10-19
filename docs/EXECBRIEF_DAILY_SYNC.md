# ExecBrief / CountryRisks daily synchronization (v2.0.4)

Applies to the October15,2026 edition onward. The October14 published05:00
snapshot and its original history stay intact. ExecBrief keeps its03:15 JST main
start and03:00 information cutoff. CountryRisks checks at03:20, which is an
earliest readiness check, not an assertion that ExecBrief finishes at03:15.

## One downstream owner and actual acceptance gate

The existing `countryrisks-daily` job in the existing shared Windows tick runs
`periodic_adapter.py` → `synced_cycle.py`. Its old05:07 independent execution is
replaced. No scheduler, collector, worker, AI invocation or Codex reservation is
added. The existing six shared jobs and Monday11:00 JST weekly owner keep their
settings. The same nonblocking OS publication lock serializes daily and weekly.
It releases on process exit without requiring a live-owner lock deletion.

The canonical starting receipt is:

`<ExecBrief>/.daily-work/YYYY-MM-DD/publication-receipt.json`

It must be verified with exit0 and point to a SHA-matched, verified deployment
manifest and a passed release-checks receipt. The checks must bind a completed
final editorial acceptance to the same editorial SHA.

The earlier final receipt has
`content_check_complete=true` and `accepted_final_editorial_snapshot.sha256`.
The October15 exact-source receipt instead has
`status=accepted_exact_source_awaiting_root_release_checks`, the accepted
`projection.edition_sha256`/stress SHA, `exact_read_boundary` canonical source
paths and matching SHA, passed content checks, and `summary_review.pending_apply=0`.
Its only remaining item must be the recorded root checks/commit/FTPS/HTTPS stages.
The later SHA-bound successful release-checks receipt and verified publication
close those root stages. The prepublication final receipt is not rewritten or
given fabricated completion flags. Unknown remaining work, pending/missing content
review fields, failed checks, wrong source paths/SHA or an unverified publication
remain blocked. Both formats retain the same date/cutoff/public/private SHA gates.

The producer's current `release_checks.editorial_acceptance` contract binds
`content_check_complete=true`, integer `summary_review.pending_apply=0`, and
`projection.edition_sha256`. The consumer also requires canonical dated source
paths, a bound stress SHA, and successful SHA-bound validate/tests/syntax checks.
The explicit `execbrief-final-incremental-acceptance-v1` contract instead binds
`accepted=true`, zero pending/material findings, `current_files` raw SHA, and
the verified built editorial SHA. Normalized-text hashes are not raw-byte hashes.
These adapters do not edit producer receipts or waive publication/source checks.

Then WCR verifies:

- Public `/data/latest-edition.json` date, edition,03:00 cutoff, deployment SHA,
  and equality with the local latest edition.
- Accepted editorial and stress bytes, their date/manifest SHA and local bytes.
  The existing producer `engine.artifact_access` transports the public pointer
  over HTTPS and protected source JSON over authenticated, certificate-checked
  FTPS. WCR never republishes the private editorial source wholesale.
- The same edition identity again after the read; an in-progress change is waiting.
- The accepted GKG/source selection manifest date/cutoff/dataset SHA, plus the
  previous source selection when available for the first24h of the48h window.
- SecurityWatch's existing producer seal at `sealed/YYYYMMDDT180000Z.json`,
  ending03:00 JST, with its own snapshot ID/SHA and exact24h window.

After producer cleanup, bound artifacts may be read by their original SHA from
its completed-object store or same-day NAS evidence ZIP. This is a read-only
consumer resolution, not a restore over live state or a substitute for verification.
The observed October14 upstream release is `20261013T221503Z-73ae926a`, accepted
editorial SHA `97657a77e4aabd5afcc2ac591d2f6a50163db1b3a8f6e50c835b3a1544ab1706`.
Current readiness was verified against the real producer/remote artifacts.

`waiting_execbrief_daily` retains the prior verified WCR publication. The same
native job retries after900 seconds, up to84 checks and23:55 JST for that edition.
It expires instead of carrying an incomplete old edition into a new date. There
is no polling loop, sleep worker or separate reminder. The worker's existing
run lock/process identity and WCR's shared publication lock prevent duplicates.

## Pinned inputs and stage resume

WCR seals its own read-only input bundle under
`.local/sync03/inputs/<bundle-id>/`. Identity binds date, edition/release ID,
cutoff, publication and acceptance receipts, selected-input SHA, and search seal.
Its stage key additionally binds the classification/calculation code and config
epoch. A same-date old05:00 receipt or different source/release/code cannot reuse
a completed03:00 result.

Source reconstruction, generation, build, publication and NAS handoff have
separate persisted receipts. Successful source/generation stages have payload
SHA/snapshot checks; a failed build or transfer resumes its stage. Publication
is certified only by the actual TLS/remote readback receipt. An incomplete or
failed stage keeps its pinned inputs and does not fabricate completion.

## Original-edition recovery and cold staging

After the current edition completes, the same native invocation may process an
explicit private `.local/history-recovery.json` queue. Recovery uses the existing
publication lock and separate `recovery-requests` receipts; no extra worker is
created. Each date requires its original accepted receipt/checks/publication
manifest, SHA-matched preserved latest pointer and editorial/stress bytes, source
selection, and exact03:00 search seal. The original upstream publication must
have been verified within that edition's day. Later changed public files are
recorded separately; their bytes cannot replace the accepted original SHA.
An unavailable original or seal leaves a gap. Generated history explicitly says
it was reconstructed later and does not claim WCR published on that past date.
Historical generation adds its manifest entry and immutable snapshot while
preserving the current `latest.json`, `status.json`, and NAS daily-latest pointer.
Incomplete history keeps the same native job retryable even when today's release
is already verified. A completed history queue is disabled automatically. Private
`source_timeout_seconds` may allow a bounded slow NAS read (1800–5400 seconds);
this does not start a second reader/worker or modify the shared scheduler.

With private controller `external_storage=true`, daily builds and publication
backups are written under the registered external root's
`world-country-risks/daily/<date>/<stage-key>/` directory. Before source work and
each build/transfer, `storage_placement.py` verifies the configured volume GUID,
label/filesystem/serial, marker, and capacity reserve. F requires50GiB remaining
after the estimated build peak. Bounded active source work stays on C with20GiB
remaining plus8GiB of expected temporary headroom. External unavailability
defers the existing owner; it never silently creates the cold build on C.
Restoration must provide the registered external destination and keep jobs
disabled until paths, credentials, inputs, and ownership have been checked.

## Cutoff migration and evidence scope

The daily numeric window is fixed48h, `[start,end)`, ending18:00 UTC/03:00 JST.
The current English Event raw IDs/SHA must match the frozen upstream selection;
missing selected/normalized files cannot fall back to later live source versions.
NAS original/index/normalized bytes remain read-only, fully SHA-checked.
DATEADDED excludes records at or after the cutoff; SQLDATE, publication,
ingestion, acceptance and generation times remain distinct.

The new history and prior14 calendar-date reconstruction live separately in
`.local/sync03/`. Historical observations are retrospective, same48h/03:00
English Event/classification observations, not claims of past published forecasts
or past editorial acceptance. Paired-offset comparisons reject old05:00 even if
date/offset labels match. Missing stays missing. This cutoff revision is not daily
deterioration or a prediction-accuracy result.

Accepted interpretation/translation can be confirmed after03:00 without becoming
a new post-cutoff fact: WCR reads the sealed accepted artifact and adds no fresh
article/body retrieval. Explicit post-cutoff source timestamps are excluded.
Unbound later-updated native bodies and live review folders are not ingested by
the sync path. Original body verification and supplied R/subcategory/direction
fields are not inferred from a generic desk/topic classification. Missing R
semantics stay unknown; they are context, never Event numerators or baselines.
The accepted source is retained privately, with a bounded article display subset.

The03:00 search seal is preserved/projected with its original largest traffic
bucket definition. The linked external interest page is a separate live view.
Search interest, SNS posts, actual harm and resident/government appraisal remain
different layers. No national function/perception score is introduced.

The existing R-INDEX guarded ratios and concurrent bundles (1Y/2O/3R), original
weekly/FirstLit matrix and first-Yellow practical card are retained. Public data
show date, cutoff series and upstream edition/release; the prior05:00 version is
labelled as such. Immutable old payloads and weekly history are not rewritten.

## Installation and restoration

After isolated tests and real read-only readiness/source probes, atomically
replace only the existing daily job entry in the private native profile and its
WCR controller. Do not kill/restart live workers. The next existing tick reads
the new profile and uses the same job ID. Before October15 it returns
`awaiting_sync_effective_date`; the first scheduled check is October15 03:20 JST.

Sync source, installation diffs, proofs and disabled restoration profiles belong
to the existing CountryRisks NAS packet, with shared ExecBrief/SecurityWatch
supplement pointers. Never restore shared live databases, queues or collector
state. Keep controllers, Windows jobs and old Codex reservations stopped on a
different PC until separately activated. Task-owned test/build/cache copies are
removed after validation; unique inputs, published history and recovery remain.

## First verified synchronized production edition

October15,2026 completed via the existing countryrisks-daily native retry/check19. The accepted/published upstream is `20261014T223037Z-f8e526f4`, editorial SHA `b0d32d02af1d1b0574137b3a7d3422ed373676b49f4cc17de6d2422eba610ea6` and Google03:00 seal `2127df899093abc2898776e0e0b845c040fb5190c2036e8eea19e0ea122eedd9`. The WCR48h window ends `2026-10-14T18:00:00Z`; snapshot `3c55e7efba11526cd5cd00c9cd48ce8b591850bd90e54a9d38c63956acfd3eb7` was TLS/public-SHA verified. The old October14 05:00 snapshot and completed-week index retained their exact SHA. Availability remains `partial`; this is source coverage, not a claim of zero risk or verified national impact. Native profile/jobs were unchanged.
