# Late source revisions: strict producer gate and native continuation

The original October19 edition remains snapshot
`bd140b4b7bde63af8f14bd0bd4e3559f04fbcf1d6acf0a27d6dd76307d7a5485`,
partial63/192 with239 Unknown countries. The first accepted late-source revision
was published on October19 at09:02 UTC and closed by the same native owner at
09:05:23 UTC, snapshot
`ba2be9ae094deff9dcbb969a74b3d14d18498ece28ab2705fdf1339a277df1ac`.
It has75/192 partial coverage and still239 Unknown countries in all three modes.
The original snapshot remains selectable; this is not full source recovery or
restored assessment coverage. The completed October16 recovery queue stays disabled.

## Implemented and tested

`source_revision_queue.py` registers immutable, SHA-bound **hints**, not facts or
acceptance. Controls are at most64KiB, pending frontier at most32 items, validity
at most7 days, and execution at most84 attempts with15-minute deferred retries.
Completed/blocked controls leave the pending frontier on new registrations; their
small immutable request/evidence files are preserved. Commands cannot be supplied
by a request. Queue IDs cannot contain paths.

Completion timestamps are captured after the consumer finishes, separately from
the entry/retry clock. The first run's raw queue record incorrectly reused its
entry timestamp; keep that record as forensic evidence and use the existing native
receipt's actual finish09:05:23.843897 UTC for that run. Producer receipts and
published snapshot times are not rewritten to conceal the old lifecycle defect.

`source_revision_adapter.py` is an entry for the installed shared runtime's
`execute_continuation`, using the **same countryrisks-daily job/run.lock** after
its normal daily slot is terminal. It verifies the actual native parent PID and
Windows creation identity, continuation ID/SHA, registered owner paths and native
result location. A per-request OS lock also excludes duplicate invocations.
Normal daily state, argv, retry deadline and the stopped history queue are not
reset. Later dates can transport an older, explicitly late revision request;
that never relabels the source as known at its original03:00 cutoff.

The queue root must be `<WCR>/.daily-work/source-revisions`, because the existing
runtime rejects hooks outside its job cwd's `.daily-work` boundary. This private
directory is ignored by Git and never belongs in the public source mirror.
An absent/empty queue produces no continuation. No watcher, collector, scheduler,
AI invocation or standalone publisher is added.

Parent checks pin the immutable WCR payload/SHA, same date and03:00 series,
original frozen bundle and publication receipt SHA, plus the currently selected
revision for that date. A superseded request cannot overwrite a newer revision.
Completion requires a different immutable snapshot, explicit late-source metadata,
full snapshot SHA, verified publication receipt/HTTP SHA and bound NAS manifest.
Replay verifies those proofs without publishing again. Registration never resets
an existing completed/blocked state.

If a newer day is current, the transport withholds a current-only consumer before
invocation. Only a handler explicitly supporting history-only operation may run,
and latest/status byte drift prevents completion. Isolated staged transaction and
real Node history-only generation fixtures cover this handler; an actual historical
supplement publication has not been exercised yet. A producer
receipt removed by cleanup may resolve by its original SHA from the existing NAS
completed-object store, without restoring or rewriting producer state.

## Formal producer contract and staged consumption

`source_supplement_gate.py` consumes only the producer's immutable
`execbrief-em-source-supplement-acceptance-v1` plus its SHA/byte-bound catalog and
passed checks. The reviewed producer validator is pinned to
`f21011d02064be61410193ef912b329e978220c953bc6811477b9ebd3c7a74b4`.
An unknown validator, accepted flag alone, mutable pointer or raw-only receipt
cannot authorize a source revision. Source registration still makes no acceptance
claim. No producer receipt or original WCR input bundle is rewritten.

The gate matches the original publication/release checks/editorial acceptance,
both selected-input hashes and their original producer seals, plus the unchanged
Google03:00 seal in the original WCR bundle. Every supplemental English export ID
stays inside the original half-open48h window, binds raw SHA, bulk/index SHA,
normalized path/SHA/bytes and row quality, and has a bound acquisition receipt or
an explicit already-in-parent normalization statement. A strict cumulative ID/SHA
union rejects conflicting raw versions or dropping earlier accepted sources.

The producer's English-priority subset manifest has a separate, strict namespace
under `.daily-work/rolling-search/em-english-priority/<dataset>/`. Its original
NAS manifest references and raw-priority receipts are independently checked.
`select_current_candidates` inserts its exact accepted candidate even if the
general NAS catalog has no corresponding quarter. Other normalized versions of
that supplemental ID cannot substitute for it. The source run rehashes actual
normalized bytes and rechecks its bound manifests at the end as before.

`source_revision_cycle.py` runs under the same publication lock and native job.
Large source/history/DTO/audit/generation/build/publication artifacts and subprocess
TEMP/cache/logs use the verified external run directory. Source DuckDB remains
in memory with the existing bounded512MiB C spill. Public input hydration and
per-file C promotion caps remain explicit. The default8GiB additional C peak and
20GiB reserve remain in force; an empty reviewed-plan allowlist cannot lower them.
The existing resource guard is rechecked at each stage and promotion; oversize
outputs defer without truncation or relabeling them as missing observations.

Stages resume by exact bytes and full transport-code identity. A checkpoint after
HTTP publication and NAS verification permits completion after a crash without
republishing. Local public selection is promoted only after those proofs. Older
payloads remain immutable and the daily manifest exposes original/revised records;
the reader labels late availability and allows selecting the original snapshot.
When a newer day is current, historical revisions retain latest/status and the
NAS current-day pointer. The normal daily state/deadline and stopped historical
recovery queue are unchanged. Fixture completion is not evidence that real new
source has arrived or that coverage has recovered.

## Shared-owner configuration proposal

The source owner installed this hook on October19 and verified an empty-queue
native tick. That installation does not enable source acceptance.

## One-shot producer registration

After emitting an immutable **accepted normalized supplement receipt**, the
existing producer capture phase may invoke, with cwd set to this checkout:

```
{python} -X utf8 -B scripts/register_source_revision.py
  --date YYYY-MM-DD
  --expected-parent-publication-sha256 <original upstream publication full SHA>
  --receipt-path <absolute immutable accepted supplement receipt>
  --receipt-sha256 <receipt full SHA>
```

Resolve `.daily-work/source-supplements/latest.json` in the producer to its bound
immutable receipt descriptor first. Do not enqueue that mutable pointer, a raw-only
capture receipt, a guessed path or an unaccepted normalized output. The final
producer schema and consumer gate remain prerequisites for a live invocation.

The registrar derives the date's currently selected WCR snapshot and frozen bundle,
checks the caller's expected upstream publication SHA, checks receipt bytes/SHA and
allowed producer roots, and registers the exact seven-field transport request.
Registration does not accept source facts or publish anything. Its default expiry
is24 hours (maximum7 days). The stable ID includes the full receipt SHA; repeating
it preserves the original request, completion, expiry and retry state.

Only one pending hint per date is registered through this CLI. Further receipts
coalesce while it is pending, without rewriting that hint or the producer's latest
pointer. After completion/closure, the next existing capture phase may register
the producer's then-latest immutable receipt. Missing bytes defer without a hint;
invalid input exits2. Log registration failure without rolling back source capture.
No new watcher, scheduler, collector or cross-job invocation is introduced.

## Shared-owner hook details

Only the shared runtime/profile owner may install the generated proposal's
`continuation` field on the existing `countryrisks-daily` job, under its existing
profile update lock, with byte backups and all other job fields unchanged.
The proposal records runtime/full-profile/job hashes. It does not change the
installed profile or worker. Check that the runtime hash/API and job digest still
match, or re-review a fresh scoped proposal rather than replacing an old profile.

The argv is:

```
{python} -X utf8 -B scripts/source_revision_adapter.py
  --request {request} --request-sha256 {request_sha256} --result {result}
  --native-job-root <installed state_root>/countryrisks-daily
  --native-runtime <installed runtime>/periodic_worker.py
```

`tests/source_revision_test.py` uses only TemporaryDirectory fixtures, fake source
metadata and fake publication/NAS receipts. It imports the installed runtime
read-only and exercises its real continuation entry in an isolated child with the
actual parent PID/creation identity. It verifies terminal normal state remains
byte-identical, no AI, native/per-request locks, empty-queue no-op, bounded controls,
deadline/attempt limits, SHA drift, replay and explicit late-source provenance.
No real collector, FTP transfer, public data change, production queue or installed
profile edit occurs. Fixture completion is not evidence of recovered coverage.

For restoration, keep all jobs/controllers stopped, preserve the single live
owner and never bypass previously rejected cleanup or producer acceptance actions.
