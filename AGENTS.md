# CountryRisks engine v2.0

Read `docs/ENGINE_V2_HANDOFF.md` before changes. This private repository is the
canonical source; the public source mirror excludes all `public/data`, `public/geo`,
`.local`, credentials and raw/private inputs.

Google Trending Now RSS has one producer: SecurityWatch's existing general15
cycle. CountryRisks and ExecBrief consume that selected version; never add another
RSS collector or scheduler. Search geography is not event location and search
traffic never changes a risk color directly.

The daily v2 owner is the existing shared Windows Python tick at05:07 JST,
with a fixed05:00 JST cutoff and the preceding48h half-open DATEADDED window.
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
