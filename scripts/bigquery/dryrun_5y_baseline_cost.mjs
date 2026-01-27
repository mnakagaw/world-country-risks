import { BigQuery } from '@google-cloud/bigquery';
import 'dotenv/config';

/**
 * scripts/bigquery/dryrun_5y_baseline_cost.mjs
 * 
 * Dry run for estimating the cost of a 5-year baseline for GDELT Events.
 * Standard On-demand rate: $6.25 / TiB processed.
 */

async function main() {
    // 1. Parse Args
    const args = process.argv.slice(2);
    const getArg = (name) => {
        const idx = args.indexOf(`--${name}`);
        return (idx > -1 && args[idx + 1]) ? args[idx + 1] : null;
    };

    const years = parseInt(getArg('years') || '5');
    const tableName = getArg('table') || 'gdelt-bq.gdeltv2.events';
    const usdJpy = parseFloat(getArg('usd_jpy') || '0');

    // 2. Initialize BQ
    const bq = new BigQuery();

    // 3. Prepare Query
    // We use @start_date and @end_date as parameters to ensure DATE types are handled correctly.
    const sql = `
WITH daily AS (
  SELECT
    ActionGeo_CountryCode AS iso2,
    PARSE_DATE('%Y%m%d', CAST(SQLDATE AS STRING)) AS d,
    COUNT(*) AS events_per_day
  FROM \`${tableName}\`
  WHERE PARSE_DATE('%Y%m%d', CAST(SQLDATE AS STRING)) BETWEEN @start_date AND @end_date
    AND ActionGeo_CountryCode IS NOT NULL
    AND LENGTH(ActionGeo_CountryCode) = 2
  GROUP BY iso2, d
)
SELECT
  iso2,
  AVG(events_per_day) AS avg_events_per_day_5y,
  APPROX_QUANTILES(events_per_day, 2)[OFFSET(1)] AS median_events_per_day_5y,
  COUNT(*) AS days_counted
FROM daily
GROUP BY iso2;
    `;

    // 4. Calculate Dates
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - years);

    const options = {
        query: sql,
        params: {
            start_date: startDate.toISOString().split('T')[0],
            end_date: endDate.toISOString().split('T')[0]
        },
        types: {
            start_date: 'DATE',
            end_date: 'DATE'
        },
        dryRun: true,
        useQueryCache: false
    };

    try {
        console.log(`[DRY RUN] Target Table: ${tableName}`);
        console.log(`[DRY RUN] Range: ${years} years (${options.params.start_date} to ${options.params.end_date})\n`);

        const [job] = await bq.createQueryJob(options);

        // Metadata contains statistics after dry run
        const stats = job.metadata.statistics;
        const bytes = parseInt(stats.totalBytesProcessed || stats.query.totalBytesProcessed || '0');
        const tib = bytes / Math.pow(1024, 4);
        const costUsd = tib * 6.25;

        // 5. Output
        console.log(`--- Result ---`);
        console.log(`Estimated scan: ${bytes.toLocaleString()} bytes (${tib.toFixed(4)} TiB)`);
        console.log(`Standard on-demand cost ($6.25/TiB): $${costUsd.toFixed(2)}`);

        if (usdJpy > 0) {
            const costJpy = costUsd * usdJpy;
            console.log(`Estimated cost in JPY (@${usdJpy}): ¥${Math.round(costJpy).toLocaleString()}`);
        }
        console.log(`--------------`);

    } catch (err) {
        console.error(`\n[ERROR] Dry run failed:`, err.message);
        process.exit(1);
    }
}

main();
