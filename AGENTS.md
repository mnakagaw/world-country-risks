# CountryRisks engine v2.0

Read `docs/ENGINE_V2_HANDOFF.md` before changes. This private repository is the
canonical source; the public source mirror excludes all `public/data`, `public/geo`,
`.local`, credentials and raw/private inputs.

Google Trending Now RSS has one producer: SecurityWatch's existing general15
cycle. CountryRisks and ExecBrief consume that selected version; never add another
RSS collector or scheduler. Search geography is not event location and search
traffic never changes a risk color directly.

From October15,2026 the same countryrisks-daily owner checks at03:20 JST,
then uses its existing native pending/retry mechanism every15 minutes until
23:55 JST/max84 checks. Require the verified same-day ExecBrief publication,
final acceptance/source SHA and03:00 JST seal before generation. Use the fixed
48h DATEADDED window ending03:00 JST in a separate sync03 history namespace;
never reuse the old05:00 receipt by date alone. Read docs/EXECBRIEF_DAILY_SYNC.md.
The weekly owner uses the same tick on Monday11:00 JST for the completed UTC ISO
week. Publish its immutable SHA-bound country epoch before replacing its index.
It reads existing NAS normalized English Event artifacts by source/index/SHA;
never start a second GDELT collector or use BigQuery to fill missing slots silently.
Preserve Unknown, Low coverage, Partial, Stale and missing calendar days separately.
Legacy daily and weekly records remain historical, not comparable v2 baselines.
R4 measures CAMEO aid/sanctions/economic-pressure records, not fiscal capacity.

Use bundled Node on this Windows PC; the desktop Node build crashed natively.
Run `npm run test:v2`, Python bridge/adapter checks and a build with that runtime.
Publication requires certificate-verified FTPS and public HTTP SHA256 readback;
immutable payloads precede latest pointers and root HTML. The verified remote root
is `/domains/countryrisks.org/public_html/world` on v2007, not its empty alternate
domain directory. Keep Analytics and historical pages.

Restore NAS controllers/profiles with enabled=false and all jobs stopped. Do not
overwrite live shared databases/queues or stop unrelated workers. Preserve other
tasks' dirty/unpushed work, stage only intended changes and clean task-owned scratch
after verification. Never use host Word COM.

Both WCR repositories have Actions enabled=false. Keep all4 canonical workflows
disabled and Pages in workflow mode; never restore old Actions or branch auto-build.
Read docs/PEOPLE_INTEREST_AND_ACTIONS.md for the125-country daily reader, popup
edition validation and legacy SNS provider retirement.
