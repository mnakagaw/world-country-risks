import { BigQuery } from '@google-cloud/bigquery';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

// Import FIPS to ISO2 mapping
import { fipsToIso2 } from '../fips_to_iso2.js';

/**
 * scripts/bigquery/build_r_baselines_test3d.mjs
 * 
 * Builds a 3-day TEST baseline for R1-R4 signals per country.
 * 
 * FIXED: Now correctly aggregates FIPS→ISO2 BEFORE calculating stats.
 * Step 1: BigQuery returns daily rows (fips, date, r1, r2, r3, r4)
 * Step 2: Node converts FIPS→ISO2, aggregates by iso2+date
 * Step 3: Node calculates stats (avg, median, p90) from merged daily values
 * 
 * Usage:
 *   node scripts/bigquery/build_r_baselines_test3d.mjs
 *   node scripts/bigquery/build_r_baselines_test3d.mjs --end-date 2026-01-17
 *   node scripts/bigquery/build_r_baselines_test3d.mjs --dry-run
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = path.resolve(__dirname, '../../public/data/baselines');
const LATEST_V4_PATH = path.resolve(__dirname, '../../public/data/latest_v4.json');

// ============ R DEFINITIONS (External Config) ============
const rDefsPath = path.resolve(__dirname, '../../config/r_definitions.json');
let rDefs;
try {
    rDefs = JSON.parse(fsSync.readFileSync(rDefsPath, 'utf-8'));
    console.log(`[R-DEFS] Loaded ${rDefsPath} (version: ${rDefs.version})`);
} catch (err) {
    throw new Error(`[R-DEFS] FATAL: Could not load ${rDefsPath}: ${err.message}`);
}

/**
 * Generate COUNTIF SQL condition from R definition
 */
function buildRCondition(def) {
    const parts = [];
    if (def.rootCodes && def.rootCodes.length > 0) {
        const quoted = def.rootCodes.map(c => `'${c}'`).join(', ');
        parts.push(`EventRootCode IN (${quoted})`);
    }
    if (def.eventCodes && def.eventCodes.length > 0) {
        const quoted = def.eventCodes.map(c => `'${c}'`).join(', ');
        parts.push(`EventCode IN (${quoted})`);
    }
    // Support for eventCodePrefixes with CAST for type safety
    if (def.eventCodePrefixes && def.eventCodePrefixes.length > 0) {
        const prefixConditions = def.eventCodePrefixes.map(p => `STARTS_WITH(CAST(EventCode AS STRING), '${p}')`);
        parts.push(`(${prefixConditions.join(' OR ')})`);
    }
    return parts.length ? parts.join(' OR ') : 'FALSE';
}

// ============ STATISTICS HELPERS ============
function calcAvg(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function calcMedian(arr) {
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calcP90(arr) {
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * 0.9) - 1;
    return sorted[Math.max(0, idx)];
}

async function main() {
    // 1. Parse Args
    const args = process.argv.slice(2);
    const getArg = (name) => {
        const idx = args.indexOf(`--${name}`);
        return (idx > -1 && args[idx + 1]) ? args[idx + 1] : null;
    };

    const dryRunOnly = args.includes('--dry-run');
    const tableName = 'gdelt-bq.gdeltv2.events';
    const windowDays = 3; // Fixed for this test script

    // End date: TARGET_DATE or --end-date or today
    const endDateStr = getArg('end-date') || process.env.TARGET_DATE || new Date().toISOString().split('T')[0];
    const endDate = new Date(endDateStr);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - (windowDays - 1)); // 3 days including end date

    console.log(`[R-BASELINES TEST] Building ${windowDays}-day R1-R4 baselines...`);
    console.log(`[R-BASELINES TEST] Window: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

    // 2. Load reference ISO2 list (215 countries)
    let iso2ReferenceList = new Set();
    try {
        const latestV4Raw = await fs.readFile(LATEST_V4_PATH, 'utf-8');
        const latestV4 = JSON.parse(latestV4Raw);
        iso2ReferenceList = new Set(Object.keys(latestV4.countries || {}));
        console.log(`[REFERENCE] Loaded ${iso2ReferenceList.size} ISO2 codes from latest_v4.json`);
    } catch (err) {
        console.warn(`[REFERENCE] Could not load latest_v4.json: ${err.message}`);
        console.warn(`[REFERENCE] Zero-fill will be skipped.`);
    }

    // 3. Initialize BQ
    const bq = new BigQuery();

    // 3. Prepare Query - Return DAILY rows (no stats in BigQuery)
    const startDateInt = parseInt(startDate.toISOString().replace(/-/g, '').slice(0, 8));
    const endDateInt = parseInt(endDate.toISOString().replace(/-/g, '').slice(0, 8));

    // R1-R4 definitions loaded from config/r_definitions.json

    const sql = `
SELECT
  ActionGeo_CountryCode AS fips,
  SQLDATE AS date_int,
  COUNTIF(${buildRCondition(rDefs.R1)}) AS r1_count,
  COUNTIF(${buildRCondition(rDefs.R2)}) AS r2_count,
  COUNTIF(${buildRCondition(rDefs.R3)}) AS r3_count,
  COUNTIF(${buildRCondition(rDefs.R4)}) AS r4_count
FROM \`${tableName}\`
WHERE SQLDATE BETWEEN ${startDateInt} AND ${endDateInt}
  AND ActionGeo_CountryCode IS NOT NULL
  AND ActionGeo_CountryCode != ''
  AND LENGTH(ActionGeo_CountryCode) = 2
GROUP BY fips, date_int
ORDER BY fips, date_int;
    `;

    const options = {
        query: sql,
        useQueryCache: false
    };

    try {
        // A. Dry Run for Cost Estimation
        console.log(`[R-BASELINES TEST] Table: ${tableName}`);
        const [dryJob] = await bq.createQueryJob({ ...options, dryRun: true });
        const bytes = parseInt(dryJob.metadata.statistics.totalBytesProcessed || '0');
        const gb = bytes / Math.pow(1024, 3);
        const costUsd = (bytes / Math.pow(1024, 4)) * 6.25;

        console.log(`[DRY RUN] Estimated scan: ${gb.toFixed(2)} GB ($${costUsd.toFixed(4)})`);

        if (dryRunOnly) {
            console.log("[DRY RUN] Finished. Exiting due to --dry-run.");
            return;
        }

        // B. Actual Execution
        console.log(`[EXECUTE] Running query...`);
        const [rows] = await bq.query(options);
        console.log(`[EXECUTE] Retrieved ${rows.length} daily rows (FIPS x date).`);

        // 4. Step 1: Convert FIPS→ISO2 and aggregate by ISO2+date
        // iso2DailyData[iso2][date] = { r1, r2, r3, r4 }
        const iso2DailyData = {};
        let fipsNotMapped = 0;

        for (const row of rows) {
            // Convert FIPS to ISO2 (fipsToIso2 returns {iso2, status})
            const { iso2 } = fipsToIso2(row.fips);
            if (!iso2) {
                fipsNotMapped++;
                continue;
            }

            const dateKey = String(row.date_int);

            // Initialize if needed
            if (!iso2DailyData[iso2]) {
                iso2DailyData[iso2] = {};
            }
            if (!iso2DailyData[iso2][dateKey]) {
                iso2DailyData[iso2][dateKey] = { r1: 0, r2: 0, r3: 0, r4: 0 };
            }

            // Aggregate (sum) multiple FIPS that map to same ISO2
            iso2DailyData[iso2][dateKey].r1 += row.r1_count || 0;
            iso2DailyData[iso2][dateKey].r2 += row.r2_count || 0;
            iso2DailyData[iso2][dateKey].r3 += row.r3_count || 0;
            iso2DailyData[iso2][dateKey].r4 += row.r4_count || 0;
        }

        console.log(`[AGGREGATE] ISO2 countries: ${Object.keys(iso2DailyData).length}`);
        if (fipsNotMapped > 0) {
            console.log(`[AGGREGATE] FIPS not mapped: ${fipsNotMapped} rows`);
        }

        // 5. Step 2: Calculate stats from daily values per ISO2
        const countries = {};

        for (const [iso2, dailyMap] of Object.entries(iso2DailyData)) {
            const dates = Object.keys(dailyMap);
            const r1Values = dates.map(d => dailyMap[d].r1);
            const r2Values = dates.map(d => dailyMap[d].r2);
            const r3Values = dates.map(d => dailyMap[d].r3);
            const r4Values = dates.map(d => dailyMap[d].r4);

            const daysCounted = dates.length;

            countries[iso2] = {
                gdelt_r: {
                    baseline: {
                        R1: {
                            avg: Math.round(calcAvg(r1Values)),
                            median: Math.round(calcMedian(r1Values)),
                            p90: Math.round(calcP90(r1Values)),
                            days_counted: daysCounted
                        },
                        R2: {
                            avg: Math.round(calcAvg(r2Values)),
                            median: Math.round(calcMedian(r2Values)),
                            p90: Math.round(calcP90(r2Values)),
                            days_counted: daysCounted
                        },
                        R3: {
                            avg: Math.round(calcAvg(r3Values)),
                            median: Math.round(calcMedian(r3Values)),
                            p90: Math.round(calcP90(r3Values)),
                            days_counted: daysCounted
                        },
                        R4: {
                            avg: Math.round(calcAvg(r4Values)),
                            median: Math.round(calcMedian(r4Values)),
                            p90: Math.round(calcP90(r4Values)),
                            days_counted: daysCounted
                        }
                    }
                }
            };
        }

        // 6. Zero-fill missing countries from reference list
        const countriesFromData = Object.keys(countries).length;
        console.log(`[AGGREGATE] ISO2 from data: ${countriesFromData}`);

        const zeroBaseline = {
            avg: 0, median: 0, p90: 0, days_counted: 0
        };
        const zeroFilledList = [];

        for (const iso2 of iso2ReferenceList) {
            if (!countries[iso2]) {
                countries[iso2] = {
                    gdelt_r: {
                        baseline: {
                            R1: { ...zeroBaseline },
                            R2: { ...zeroBaseline },
                            R3: { ...zeroBaseline },
                            R4: { ...zeroBaseline }
                        }
                    }
                };
                zeroFilledList.push(iso2);
            }
        }

        console.log(`[ZERO-FILL] Added: ${zeroFilledList.length}, final countries: ${Object.keys(countries).length}`);

        // 7. Analyze days_counted distribution (only from non-zero-filled)
        const daysCountedValues = Object.entries(countries)
            .filter(([iso2, _]) => !zeroFilledList.includes(iso2))
            .map(([_, c]) => c.gdelt_r.baseline.R1.days_counted);
        const daysMin = daysCountedValues.length > 0 ? Math.min(...daysCountedValues) : 0;
        const daysMax = daysCountedValues.length > 0 ? Math.max(...daysCountedValues) : 0;
        const daysMedian = calcMedian(daysCountedValues);

        console.log(`[STATS] days_counted (data only): min=${daysMin}, median=${daysMedian}, max=${daysMax}`);
        if (daysMax > windowDays) {
            console.warn(`[WARNING] days_counted max (${daysMax}) exceeds window (${windowDays})! This should not happen.`);
        }

        const output = {
            meta: {
                version: "v1.2-test3d",
                generated_at: new Date().toISOString(),
                country_count: Object.keys(countries).length,
                countries_from_data: countriesFromData,
                zero_filled_count: zeroFilledList.length,
                zero_filled_examples: zeroFilledList.slice(0, 5),
                window: {
                    days: windowDays,
                    start_date: startDate.toISOString().split('T')[0],
                    end_date: endDate.toISOString().split('T')[0]
                },
                aggregation: "FIPS→ISO2 daily merge, then stats, then zero-fill",
                sources: {
                    gdelt_events: {
                        table: tableName,
                        metrics: ["r1_security", "r2_living", "r3_governance", "r4_fiscal"]
                    }
                },
                cost_estimate: {
                    bytes_processed: bytes,
                    usd: costUsd
                },
                days_counted_stats: {
                    min: daysMin,
                    median: daysMedian,
                    max: daysMax
                },
                note: "TEST FILE - 3 day window only. Not for production use."
            },
            countries
        };

        // 7. Save File - Use separate filename to avoid overwriting existing baselines
        await fs.mkdir(BASELINE_DIR, { recursive: true });
        const outputFilename = 'gdelt_r_baselines_test3d.json';
        const outputPath = path.join(BASELINE_DIR, outputFilename);

        await fs.writeFile(outputPath, JSON.stringify(output, null, 2));

        console.log(`\n[SUCCESS] Generated: ${outputPath}`);
        console.log(`[SUCCESS] Country count: ${Object.keys(countries).length}`);

        // 8. Sample Output (for verification)
        const sampleCodes = ['US', 'GB', 'JP', 'IR', 'VE'];
        console.log(`\n[SAMPLE] R1-R4 baselines for sample countries:`);
        for (const code of sampleCodes) {
            const c = countries[code];
            if (c) {
                console.log(`  ${code}: R1=${JSON.stringify(c.gdelt_r.baseline.R1)}`);
                console.log(`       R2=${JSON.stringify(c.gdelt_r.baseline.R2)}`);
                console.log(`       R3=${JSON.stringify(c.gdelt_r.baseline.R3)}`);
                console.log(`       R4=${JSON.stringify(c.gdelt_r.baseline.R4)}`);
            }
        }

    } catch (err) {
        console.error(`[ERROR] Build failed:`, err.message);
        process.exit(1);
    }
}

main();
