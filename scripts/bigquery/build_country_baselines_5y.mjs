import { BigQuery } from '@google-cloud/bigquery';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { aggregateToIso2 } from '../fips_to_iso2.js';

/**
 * scripts/bigquery/build_country_baselines_5y.mjs
 * 
 * Builds a 5-year baseline for GDELT Events per country.
 * Outputs statistics (avg, median, p90) to public/data/baselines/
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = path.resolve(__dirname, '../../public/data/baselines');

async function main() {
    // 1. Parse Args
    const args = process.argv.slice(2);
    const getArg = (name) => {
        const idx = args.indexOf(`--${name}`);
        return (idx > -1 && args[idx + 1]) ? args[idx + 1] : null;
    };

    const years = parseInt(getArg('years') || '5');
    const tableName = getArg('table') || 'gdelt-bq.gdeltv2.events';
    const maxGb = parseInt(getArg('max_gb') || '50');
    const dryRunOnly = args.includes('--dry-run');

    // 2. Initialize BQ
    const bq = new BigQuery();

    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - years);

    // 3. Prepare Query
    // Using simple BETWEEN on SQLDATE (int) to avoid PARSE_DATE issues if any
    const startDateInt = parseInt(startDate.toISOString().replace(/-/g, '').slice(0, 8));
    const endDateInt = parseInt(endDate.toISOString().replace(/-/g, '').slice(0, 8));

    const sql = `
WITH daily AS (
  SELECT
    ActionGeo_CountryCode AS fips,
    SQLDATE AS d,
    COUNT(*) AS events_per_day
  FROM \`${tableName}\`
  WHERE SQLDATE BETWEEN ${startDateInt} AND ${endDateInt}
    AND ActionGeo_CountryCode IS NOT NULL
    AND ActionGeo_CountryCode != ''
    AND LENGTH(ActionGeo_CountryCode) = 2
  GROUP BY fips, d
)
SELECT
  fips,
  AVG(events_per_day) AS avg_5y,
  APPROX_QUANTILES(events_per_day, 2)[OFFSET(1)] AS median_5y,
  APPROX_QUANTILES(events_per_day, 10)[OFFSET(9)] AS p90_5y,
  COUNT(*) AS days_counted
FROM daily
GROUP BY fips;
    `;

    const options = {
        query: sql,
        useQueryCache: false
    };

    try {
        // A. Dry Run for Cost Estimation
        console.log(`[BASELINES] Table: ${tableName}, Range: ${years}y`);
        const [dryJob] = await bq.createQueryJob({ ...options, dryRun: true });
        const bytes = parseInt(dryJob.metadata.statistics.totalBytesProcessed || '0');
        const gb = bytes / Math.pow(1024, 3);
        const costUsd = (bytes / Math.pow(1024, 4)) * 6.25;

        console.log(`[DRY RUN] Estimated scan: ${gb.toFixed(2)} GB ($${costUsd.toFixed(4)})`);

        if (gb > maxGb) {
            console.warn(`[ABORT] Estimated scan (${gb.toFixed(2)} GB) exceeds --max_gb (${maxGb} GB).`);
            console.warn(`Use --max_gb to increase limit if you are sure.`);
            process.exit(1);
        }

        if (dryRunOnly) {
            console.log("[DRY RUN] Finished. Exiting due to --dry-run.");
            return;
        }

        // B. Actual Execution
        console.log(`[EXECUTE] Running query...`);
        const [rows] = await bq.query(options);
        console.log(`[EXECUTE] Retrieved ${rows.length} countries.`);

        // 4. Transform to Schema
        // First convert FIPS to ISO2
        const fipsData = {};
        for (const row of rows) {
            fipsData[row.fips] = {
                event_count: Math.round(row.avg_5y), // Dummy for aggregateToIso2 interface
                _avg: row.avg_5y,
                _median: row.median_5y,
                _p90: row.p90_5y,
                _days: row.days_counted
            };
        }

        const { data: iso2Baselines, stats } = aggregateToIso2(fipsData);
        console.log(`[BASELINES] Converted FIPS to ISO2. Countries: ${Object.keys(iso2Baselines).length}`);

        const countries = {};
        for (const [iso2, data] of Object.entries(iso2Baselines)) {
            countries[iso2] = {
                name_en: "", // Placeholder
                name_ja: "", // Placeholder
                gdelt: {
                    baseline: {
                        avg_5y: Math.round(data._avg),
                        median_5y: Math.round(data._median),
                        p90_5y: Math.round(data._p90),
                        days_counted: data._days
                    },
                    GDELTweight: Math.round(data._median)
                },
                basics: {
                    population: null,
                    gdp_nominal: null
                }
            };
        }

        const output = {
            meta: {
                version: "v1",
                generated_at: new Date().toISOString(),
                country_count: Object.keys(countries).length,
                window: {
                    years,
                    start_date: startDate.toISOString().split('T')[0],
                    end_date: endDate.toISOString().split('T')[0]
                },
                sources: {
                    gdelt_events: {
                        table: tableName,
                        metric: "events_per_day"
                    }
                },
                cost_estimate: {
                    bytes_processed: bytes,
                    usd: costUsd
                }
            },
            countries
        };

        // 5. Save Files
        await fs.mkdir(BASELINE_DIR, { recursive: true });

        const countFilename = `${rows.length}Countries.json`;
        await fs.writeFile(path.join(BASELINE_DIR, countFilename), JSON.stringify(output, null, 4));
        await fs.writeFile(path.join(BASELINE_DIR, 'gdelt_5y_baselines.json'), JSON.stringify(output, null, 4));

        const meta = {
            latest_file: countFilename,
            generated_at: output.meta.generated_at,
            country_count: output.meta.country_count
        };
        await fs.writeFile(path.join(BASELINE_DIR, 'gdelt_5y_baselines.meta.json'), JSON.stringify(meta, null, 4));

        console.log(`[SUCCESS] Generated:`);
        console.log(` - ${path.join(BASELINE_DIR, countFilename)}`);
        console.log(` - ${path.join(BASELINE_DIR, 'gdelt_5y_baselines.json')}`);

    } catch (err) {
        console.error(`[ERROR] Build failed:`, err.message);
        process.exit(1);
    }
}

main();
