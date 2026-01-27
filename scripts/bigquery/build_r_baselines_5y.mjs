import { BigQuery } from '@google-cloud/bigquery';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

// Import FIPS to ISO2 mapping for SQL CTE generation
import { FIPS_TO_ISO2 } from '../fips_to_iso2.js';

/**
 * scripts/bigquery/build_r_baselines_5y.mjs
 * 
 * Builds a 5-year baseline for R1-R4 signals per country.
 * Implements zero-filling by date-country grid to ensure realistic medians.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = path.resolve(__dirname, '../../public/data/baselines');
const LATEST_V4_PATH = path.resolve(__dirname, '../../public/data/latest_v4.json');
const R_DEFS_PATH = path.resolve(__dirname, '../../config/r_definitions.json');

const MAX_SCAN_GB = parseInt(process.env.MAX_SCAN_GB || '50');

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

async function main() {
  console.log(`[R-BASELINES 5Y] Initializing 5-year baseline generation...`);

  // 1. Load R Definitions
  let rDefs;
  try {
    rDefs = JSON.parse(fsSync.readFileSync(R_DEFS_PATH, 'utf-8'));
    console.log(`[R-DEFS] Loaded ${R_DEFS_PATH} (version: ${rDefs.version})`);
  } catch (err) {
    throw new Error(`[R-DEFS] FATAL: Could not load ${R_DEFS_PATH}: ${err.message}`);
  }

  // 2. Load reference ISO2 list (215 countries)
  let countriesList = [];
  try {
    const latestV4 = JSON.parse(await fs.readFile(LATEST_V4_PATH, 'utf-8'));
    countriesList = Object.keys(latestV4.countries || {}).sort();
    console.log(`[REFERENCE] Loaded ${countriesList.length} ISO2 codes from latest_v4.json`);
  } catch (err) {
    throw new Error(`[REFERENCE] FATAL: Could not load ${LATEST_V4_PATH}: ${err.message}`);
  }

  // 3. Setup Window (5 years)
  const windowYears = 5;
  const endDateStr = process.env.TARGET_DATE || new Date().toISOString().split('T')[0];
  const endDate = new Date(endDateStr);
  const startDate = new Date(endDate);
  startDate.setFullYear(endDate.getFullYear() - windowYears);

  const startDateStr = startDate.toISOString().split('T')[0];
  console.log(`[WINDOW] ${startDateStr} to ${endDateStr} (~1825 days)`);

  // 4. Initialize BQ
  const bq = new BigQuery();

  // 5. Prepare SQL Parts
  const fipsMappingSql = Object.entries(FIPS_TO_ISO2)
    .map(([fips, iso2]) => `SELECT '${fips}' as fips, '${iso2}' as iso2`)
    .join('\nUNION ALL\n');

  const countryListSql = countriesList
    .map(iso2 => `SELECT '${iso2}' as iso2`)
    .join('\nUNION ALL\n');

  const sql = `
WITH fips_to_iso2 AS (
  ${fipsMappingSql}
),
country_grid AS (
  ${countryListSql}
),
date_grid AS (
  SELECT d FROM UNNEST(GENERATE_DATE_ARRAY(DATE('${startDateStr}'), DATE('${endDateStr}'))) AS d
),
r_type_grid AS (
  SELECT 'R1' as r_type UNION ALL SELECT 'R2' UNION ALL SELECT 'R3' UNION ALL SELECT 'R4'
),
full_grid AS (
  SELECT g.d, c.iso2, r.r_type
  FROM date_grid g
  CROSS JOIN country_grid c
  CROSS JOIN r_type_grid r
),
daily_counts_fips AS (
  SELECT
    PARSE_DATE('%Y%m%d', CAST(SQLDATE AS STRING)) as d,
    ActionGeo_CountryCode as fips,
    COUNTIF(${buildRCondition(rDefs.R1)}) as r1,
    COUNTIF(${buildRCondition(rDefs.R2)}) as r2,
    COUNTIF(${buildRCondition(rDefs.R3)}) as r3,
    COUNTIF(${buildRCondition(rDefs.R4)}) as r4
  FROM \`gdelt-bq.gdeltv2.events\`
  WHERE SQLDATE BETWEEN ${startDate.toISOString().replace(/-/g, '').slice(0, 8)} AND ${endDate.toISOString().replace(/-/g, '').slice(0, 8)}
    AND ActionGeo_CountryCode IS NOT NULL
  GROUP BY d, fips
),
daily_counts_iso2_long AS (
  SELECT 
    d,
    iso2,
    r_type,
    SUM(count) OVER (PARTITION BY iso2, r_type ORDER BY d ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) as rolling_count
  FROM (
    SELECT 
      d,
      iso2,
      'R1' as r_type,
      SUM(r1) as count
    FROM daily_counts_fips
    JOIN fips_to_iso2 USING(fips)
    GROUP BY 1, 2, 3
    UNION ALL
    SELECT d, iso2, 'R2' as r_type, SUM(r2) as count FROM daily_counts_fips JOIN fips_to_iso2 USING(fips) GROUP BY 1, 2, 3
    UNION ALL
    SELECT d, iso2, 'R3' as r_type, SUM(r3) as count FROM daily_counts_fips JOIN fips_to_iso2 USING(fips) GROUP BY 1, 2, 3
    UNION ALL
    SELECT d, iso2, 'R4' as r_type, SUM(r4) as count FROM daily_counts_fips JOIN fips_to_iso2 USING(fips) GROUP BY 1, 2, 3
  )
),
final_grid_counts AS (
  SELECT 
    f.iso2,
    f.r_type,
    COALESCE(c.rolling_count, 0) as daily_count
  FROM full_grid f
  LEFT JOIN daily_counts_iso2_long c ON f.d = c.d AND f.iso2 = c.iso2 AND f.r_type = c.r_type
)
SELECT 
  iso2,
  r_type,
  APPROX_QUANTILES(daily_count, 101)[OFFSET(50)] as median,
  ROUND(AVG(daily_count), 2) as avg,
  COUNT(*) as days_counted
FROM final_grid_counts
GROUP BY iso2, r_type
ORDER BY iso2, r_type;
    `;

  // 5. ... (SQL construction)
  // console.log(sql); // DEBUG
  await fs.writeFile('debug_query.sql', sql);
  console.log(`[DEBUG] Generated SQL saved to debug_query.sql`);

  // 6. Dry Run & Safety Valve
  let dryJob;
  try {
    [dryJob] = await bq.createQueryJob({ query: sql, dryRun: true });
  } catch (err) {
    console.error(`[DRY RUN] FAILED: ${err.message}`);
    if (err.errors) {
      err.errors.forEach(e => console.error(`  - ${e.message}`));
    }
    process.exit(1);
  }
  const bytes = parseInt(dryJob.metadata.statistics.totalBytesProcessed || '0');
  const gb = bytes / Math.pow(1024, 3);
  const costUsd = (bytes / Math.pow(1024, 4)) * 6.25;

  console.log(`[DRY RUN] Estimated scan: ${gb.toFixed(2)} GB ($${costUsd.toFixed(4)})`);

  if (gb > MAX_SCAN_GB) {
    console.error(`[FATAL] Scan size ${gb.toFixed(2)} GB exceeds safety limit ${MAX_SCAN_GB} GB.`);
    console.error(`[TIP] You can increase the limit via MAX_SCAN_GB env var if needed.`);
    process.exit(1);
  }

  // 7. Execution
  console.log(`[EXECUTE] Running 5-year baseline query (Safety Limit OK)...`);
  const [rows, job] = await bq.query({ query: sql, useQueryCache: true });
  const bytesProcessed = parseInt(job.metadata?.statistics?.totalBytesProcessed || '0');
  console.log(`[EXECUTE] Query finished. Actual scan: ${(bytesProcessed / Math.pow(1024, 3)).toFixed(2)} GB.`);

  // 8. Format Output
  const baselines = {};
  for (const row of rows) {
    if (!baselines[row.iso2]) baselines[row.iso2] = {};
    baselines[row.iso2][row.r_type] = {
      median: row.median,
      avg: row.avg,
      days_counted: row.days_counted
    };
  }

  const output = {
    meta: {
      baseline_type: "5y",
      start_date: startDateStr,
      end_date: endDateStr,
      generated_at: new Date().toISOString(),
      expected_country_count: 215,
      actual_country_count: Object.keys(baselines).length,
      r_definitions_source: "config/r_definitions.json",
      zero_fill: true,
      query_bytes_processed: bytesProcessed,
      stats: {
        total_rows: rows.length
      },
      notes: "5-year historical median baseline with 0-filling. Values represent 48-hour rolling sums (matching daily fetch). Generated via APPROX_QUANTILES."
    },
    baselines
  };

  // 9. Save
  await fs.mkdir(BASELINE_DIR, { recursive: true });
  const outputFilename = 'gdelt_r_baselines_5y.json';
  const outputPath = path.join(BASELINE_DIR, outputFilename);
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n[SUCCESS] Generated: ${outputPath}`);
  console.log(`[SUCCESS] Actually produced ${Object.keys(baselines).length} countries.`);

  // 10. Sample & Distribution Check
  const sample = ['US', 'JP', 'HT', 'IQ'];
  console.log(`\n[LOG] Sample Medians (5y):`);
  for (const iso2 of sample) {
    if (baselines[iso2]) {
      console.log(`  ${iso2}: R1=${baselines[iso2].R1?.median}, R2=${baselines[iso2].R2?.median}, R3=${baselines[iso2].R3?.median}, R4=${baselines[iso2].R4?.median}`);
    }
  }
}

main().catch(err => {
  console.error(`[ERROR] ${err.message}`);
  process.exit(1);
});
