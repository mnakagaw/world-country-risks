# Late source revisions: prepared continuation transport

The original October19 edition remains snapshot
`bd140b4b7bde63af8f14bd0bd4e3559f04fbcf1d6acf0a27d6dd76307d7a5485`,
partial63/192 with239 Unknown countries. No new source has been accepted by this
transport, no corrected snapshot has been generated/published, and the completed
October16 recovery queue stays disabled.

## Implemented and tested

`source_revision_queue.py` registers immutable, SHA-bound **hints**, not facts or
acceptance. Controls are at most64KiB, pending frontier at most32 items, validity
at most7 days, and execution at most84 attempts with15-minute deferred retries.
Completed/blocked controls leave the pending frontier on new registrations; their
small immutable request/evidence files are preserved. Commands cannot be supplied
by a request. Queue IDs cannot contain paths.

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
and latest/status byte drift prevents completion. The real historical publication
transaction still needs validation when that handler is implemented. A producer
receipt removed by cleanup may resolve by its original SHA from the existing NAS
completed-object store, without restoring or rewriting producer state.

## Deliberately unavailable until the producer contract arrives

The production `consume_revision()` gate currently returns
`producer_source_revision_contract_not_yet_available`. A matching queue hint or
a receipt file with an `accepted` flag cannot start generation. The normal
`freeze_inputs`, R math/config, coverage rules, source selection, generator and
daily/weekly adapters are unchanged by this preparation.

The actual producer receipt schema/path must come from the upstream owner after
real capture. Its acceptance must bind the original19 release/publication/selected
input/seal, exact added source IDs/full raw SHA, normalized index/full SHA, actual
acquisition times, review/check results and publication/retention proof. No private
or public producer receipt is rewritten to synthesize that acceptance.

When that contract arrives, implement and fixture-test its strict consumer gate
and the new-snapshot pipeline before registering a live hint. Retain14/15/16/19v1
payloads and their source receipts. Preserve the original48h DATEADDED cutoff;
post-cutoff acquisition/acceptance remains explicit. If a newer day is already
current, a19 supplement must stay historical and cannot roll latest/status or the
NAS current-day pointer back. Add an explicit revision label and discoverable
original/new snapshot records before actual release. These data-path integrations
are **not claimed implemented or exercised by the transport fixtures**.

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
