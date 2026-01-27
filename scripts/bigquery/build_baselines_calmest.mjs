import { BigQuery } from '@google-cloud/bigquery';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { fipsToIso2 } from '../fips_to_iso2.js';

/**
 * scripts/bigquery/build_baselines_calmest.mjs
 * 
 * Builds a "Calmest 3-Year Baseline" for GDELT Events per country (ISO2).
 * Range: 2015-02-18 (GDELT 2.0 Start) to Present.
 * Logic:
 * 1. Fetch Daily Aggregates (Total, R1-R4) from BigQuery.
 * 2. Convert FIPS to ISO2 and merge daily counts.
 * 3. Find sliding window (3 years) with lowest median event count.
 * 4. Fallback to 2 years if needed.
 * 5. Safety Floor: Ignore windows with median < 10.
 * 
 * Outputs public/data/baselines/gdelt_calmest3y_baselines.json
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = path.resolve(__dirname, '../../public/data/baselines');
const R_DEFS_PATH = path.resolve(__dirname, '../../config/r_definitions.json');

// Helper to build COUNTIF condition
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
    if (parts.length === 0) return 'FALSE';
    return parts.join(' OR ');
}

// Statistics helpers
function getMedian(arr) {
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getP90(arr) {
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil(0.9 * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

function getAvg(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Fill missing dates
function getDailySeries(dateMap) {
    const dates = Object.keys(dateMap).sort();
    if (dates.length === 0) return [];

    // Determine bounds
    let minDate = new Date(dates[0]);
    let maxDate = new Date(dates[dates.length - 1]);

    // Ensure we cover 2015-now if possible, but practical range is fine
    const series = [];
    let curr = new Date(minDate);
    while (curr <= maxDate) {
        const dateStr = curr.toISOString().split('T')[0];
        const data = dateMap[dateStr] || { events: 0, r1: 0, r2: 0, r3: 0, r4: 0 };
        series.push({ date: new Date(curr), ...data });
        curr.setDate(curr.getDate() + 1);
    }
    return series;
}

async function main() {
    // 1. Arguments
    const args = process.argv.slice(2);
    const getArg = (name) => {
        const idx = args.indexOf(`--${name}`);
        return (idx > -1 && args[idx + 1]) ? args[idx + 1] : null;
    };
    const maxGb = parseInt(getArg('max_gb') || '20');
    const dryRunOnly = args.includes('--dry-run');

    // 2. Load R-Definitions
    let rDefs;
    try {
        rDefs = JSON.parse(readFileSync(R_DEFS_PATH, 'utf-8'));
    } catch (err) {
        console.error(`[ERROR] Failed to load R-definitions: ${err.message}`);
        process.exit(1);
    }

    // 3. Initialize BQ
    const bq = new BigQuery();

    // 4. Construct Query
    const startInt = 20150218;

    const sql = `
        SELECT
            PARSE_DATE('%Y%m%d', CAST(SQLDATE AS STRING)) as d,
            ActionGeo_CountryCode as fips,
            COUNT(*) as events,
            COUNTIF(${buildRCondition(rDefs.R1)}) as r1,
            COUNTIF(${buildRCondition(rDefs.R2)}) as r2,
            COUNTIF(${buildRCondition(rDefs.R3)}) as r3,
            COUNTIF(${buildRCondition(rDefs.R4)}) as r4
        FROM \`gdelt-bq.gdeltv2.events\`
        WHERE SQLDATE >= ${startInt}
          AND ActionGeo_CountryCode IS NOT NULL
          AND LENGTH(ActionGeo_CountryCode) = 2
        GROUP BY 1, 2
    `;

    const options = { query: sql, useQueryCache: false };

    try {
        // A. Dry Run
        console.log(`[DRY RUN] Checking cost...`);
        const [dryJob] = await bq.createQueryJob({ ...options, dryRun: true });
        const bytes = parseInt(dryJob.metadata.statistics.totalBytesProcessed || '0');
        const gb = bytes / Math.pow(1024, 3);
        const costUsd = (bytes / Math.pow(1024, 4)) * 6.25;

        console.log(`[DRY RUN] Scan: ${gb.toFixed(2)} GB (~$${costUsd.toFixed(4)})`);

        if (gb > maxGb) {
            console.error(`[ABORT] Estimated scan (${gb.toFixed(2)} GB) exceeds limit (${maxGb} GB).`);
            process.exit(1);
        }

        if (dryRunOnly) {
            console.log("[DRY RUN] Done. Exiting.");
            return;
        }

        // B. Execute
        console.log(`[EXECUTE] Running query...`);
        const [rows] = await bq.query(options);
        console.log(`[EXECUTE] Fetched ${rows.length} rows.`);

        // 5. Processing (FIPS -> ISO2 Daily Aggregation)
        const iso2DailyMap = {}; // { ISO2: { 'YYYY-MM-DD': { events, r1... } } }

        let mappedCount = 0;
        let excludedCount = 0;

        rows.forEach(row => {
            const dateStr = row.d.value || row.d; // BQ Date object or string
            const { iso2, status } = fipsToIso2(row.fips);

            if (status === 'excluded' || !iso2) {
                excludedCount++;
                return;
            }
            mappedCount++;

            if (!iso2DailyMap[iso2]) iso2DailyMap[iso2] = {};
            if (!iso2DailyMap[iso2][dateStr]) {
                iso2DailyMap[iso2][dateStr] = { events: 0, r1: 0, r2: 0, r3: 0, r4: 0 };
            }

            iso2DailyMap[iso2][dateStr].events += row.events;
            iso2DailyMap[iso2][dateStr].r1 += row.r1;
            iso2DailyMap[iso2][dateStr].r2 += row.r2;
            iso2DailyMap[iso2][dateStr].r3 += row.r3;
            iso2DailyMap[iso2][dateStr].r4 += row.r4;
        });

        console.log(`[PROCESS] Mapped ${mappedCount} rows to ${Object.keys(iso2DailyMap).length} ISO2 countries. (Excluded ${excludedCount})`);

        // 6. Window Selection
        const results = {};
        const adoptionStats = { target3y: 0, fallback2y: 0, failed: 0 };
        const MIN_MEDIAN_FLOOR = 10;
        const WINDOW_3Y = 1095; // 3 * 365
        const WINDOW_2Y = 730;

        for (const [iso2, dateMap] of Object.entries(iso2DailyMap)) {
            const series = getDailySeries(dateMap);
            let bestWindow = null;
            let lowestMedian = Infinity;

            // Helper to scan windows
            const scanWindows = (windowSize) => {
                let best = null;
                let minMed = Infinity;

                // Min coverage: 85% of days should exist in series range?
                // getDailySeries fills zeros, so coverage is technically 100% of range.
                // We rely on actual data coverage implicitly.

                for (let i = 0; i <= series.length - windowSize; i += 30) { // Step 30 days for speed
                    const chunk = series.slice(i, i + windowSize);
                    const events = chunk.map(d => d.events);
                    const med = getMedian(events);

                    if (med < MIN_MEDIAN_FLOOR) continue; // Safety floor check

                    if (med < minMed) {
                        minMed = med;
                        best = {
                            start: chunk[0].date,
                            end: chunk[chunk.length - 1].date,
                            median: med,
                            chunk
                        };
                    }
                }
                return best;
            };

            // Try 3 Year
            let selected = scanWindows(WINDOW_3Y);
            let method = '3y';

            if (!selected) {
                // Try 2 Year Fallback
                selected = scanWindows(WINDOW_2Y);
                method = '2y';
            }

            if (selected) {
                // Calculate full metrics for selected window
                const chunk = selected.chunk;
                const stats = {
                    events: chunk.map(d => d.events),
                    r1: chunk.map(d => d.r1),
                    r2: chunk.map(d => d.r2),
                    r3: chunk.map(d => d.r3),
                    r4: chunk.map(d => d.r4)
                };

                results[iso2] = {
                    name_en: "", // Placeholder
                    name_ja: "",
                    gdelt: {
                        baseline: {
                            avg_5y: Math.round(getAvg(stats.events)), // Keep name avg_5y for compatibility
                            median_5y: Math.round(getMedian(stats.events)),
                            p90_5y: Math.round(getP90(stats.events)),
                            days_counted: chunk.length,
                            // NEW FIELDS
                            avg_r1: Math.round(getAvg(stats.r1)),
                            median_r1: Math.round(getMedian(stats.r1)),
                            avg_r2: Math.round(getAvg(stats.r2)),
                            median_r2: Math.round(getMedian(stats.r2)),
                            avg_r3: Math.round(getAvg(stats.r3)),
                            median_r3: Math.round(getMedian(stats.r3)),
                            avg_r4: Math.round(getAvg(stats.r4)),
                            median_r4: Math.round(getMedian(stats.r4))
                        },
                        GDELTweight: Math.round(getMedian(stats.events))
                    },
                    // Compatibility fields
                    basics: { population: null, gdp_nominal: null },
                    baseline_meta: {
                        method: `calmest${method}`,
                        start: selected.start.toISOString().split('T')[0],
                        end: selected.end.toISOString().split('T')[0],
                        median: selected.median,
                        window_days: chunk.length
                    }
                };

                if (method === '3y') adoptionStats.target3y++;
                else adoptionStats.fallback2y++;

            } else {
                adoptionStats.failed++;
                console.warn(`[WARN] ${iso2}: No valid window found (Floor=${MIN_MEDIAN_FLOOR}).`);
                // Fallback to simplistic "whole range" or skip?
                // Skip. Code handling "missing baseline" should handle it.
            }
        }

        console.log(`[STATS] Adoption: 3y=${adoptionStats.target3y}, 2y=${adoptionStats.fallback2y}, Failed=${adoptionStats.failed}`);

        // 7. Output
        const output = {
            meta: {
                version: "calmest-v1",
                generated_at: new Date().toISOString(),
                country_count: Object.keys(results).length,
                method: "calmest_sliding_window",
                floor: MIN_MEDIAN_FLOOR
            },
            countries: results
        };

        // Save
        await fs.mkdir(BASELINE_DIR, { recursive: true });
        await fs.writeFile(path.join(BASELINE_DIR, 'gdelt_calmest3y_baselines.json'), JSON.stringify(output, null, 4));

        // Meta file
        const meta = {
            latest_file: 'gdelt_calmest3y_baselines.json',
            stats: adoptionStats
        };
        await fs.writeFile(path.join(BASELINE_DIR, 'gdelt_calmest3y_baselines.meta.json'), JSON.stringify(meta, null, 4));

        console.log(`[SUCCESS] Saved to public/data/baselines/gdelt_calmest3y_baselines.json`);

    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();
