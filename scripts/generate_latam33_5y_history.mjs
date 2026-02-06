import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BigQuery } from '@google-cloud/bigquery';
import 'dotenv/config';
import { fipsToIso2, loadCountryNameMap } from './fips_to_iso2.js';
import { buildRCondition } from './gdelt_bigquery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Config
const LATAM33_PATH = path.resolve(__dirname, '../config/latam33.json');
const DATA_DIR = path.resolve(__dirname, '../public/data');
const OUT_DIR = path.resolve(DATA_DIR, 'history/latam33_5y');
const BASELINES_5Y_PATH = path.resolve(DATA_DIR, 'baselines/gdelt_r_baselines_5y.json');
const BASELINES_CALMEST3Y_PATH = path.resolve(DATA_DIR, 'baselines/gdelt_calmest3y_baselines.json');
const SCORING_PATH = path.resolve(__dirname, '../config/scoring.json');
const RDEFS_PATH = path.resolve(__dirname, '../config/r_definitions.json');
const SQL_PATH = path.resolve(__dirname, 'weekly_query.sql');

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');

    console.log(`[LATAM33-5Y] ${dryRun ? 'DRY RUN' : 'STARTING FULL BACKFILL'}`);

    // Load LATAM33 list
    if (!fs.existsSync(LATAM33_PATH)) throw new Error(`Config not found: ${LATAM33_PATH}`);
    const latam33 = JSON.parse(fs.readFileSync(LATAM33_PATH, 'utf-8'));
    const targetIso2s = new Set(latam33.map(s => s.toUpperCase()));
    console.log(`[LATAM33-5Y] Target countries: ${latam33.length}`);

    // Ensure output dir
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    // Load Scoring & R-Defs
    const scoringConfig = JSON.parse(fs.readFileSync(SCORING_PATH, 'utf-8'));
    const rDefs = JSON.parse(fs.readFileSync(RDEFS_PATH, 'utf-8'));
    const THRESHOLDS = scoringConfig.surge_r?.thresholds || { yellow: 1.75, orange: 2.75, red: 3.75 };
    const k = scoringConfig.surge_r?.smoothing_k ?? 5;

    // Load Baselines
    const baselines5y = JSON.parse(fs.readFileSync(BASELINES_5Y_PATH, 'utf-8')).countries || {};
    const baselinesCalmest3y = JSON.parse(fs.readFileSync(BASELINES_CALMEST3Y_PATH, 'utf-8')).countries || {};

    // Prepare SQL
    const sqlBase = fs.readFileSync(SQL_PATH, 'utf-8');
    const sql = sqlBase
        .replace(/\${R1_CONDITION}/g, buildRCondition(rDefs.R1))
        .replace(/\${R2_CONDITION}/g, buildRCondition(rDefs.R2))
        .replace(/\${R3_CONDITION}/g, buildRCondition(rDefs.R3))
        .replace(/\${R4_CONDITION}/g, buildRCondition(rDefs.R4));

    // BigQuery Setup
    const bigquery = new BigQuery({
        projectId: process.env.BQ_PROJECT_ID || 'countryrisks-prod',
        keyFilename: path.resolve(__dirname, '../credentials/gcp-service-account.json')
    });

    const weeksCount = 260; // 5 years
    const endInput = new Date().toISOString().split('T')[0];
    const endSunday = new Date(endInput);
    endSunday.setDate(endSunday.getDate() - endSunday.getDay()); // Round to previous Sunday
    const startDate = new Date(endSunday);
    startDate.setDate(endSunday.getDate() - (weeksCount * 7) + 1);

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = new Date(endSunday.getTime() + 86400000).toISOString().split('T')[0];

    console.log(`[LATAM33-5Y] Range: ${startDateStr} to ${endDateStr}`);

    // Query
    const options = {
        query: sql,
        params: {
            start_date: startDateStr,
            end_date: endDateStr
        },
        dryRun: dryRun
    };

    if (dryRun) {
        const [job] = await bigquery.createQueryJob(options);
        const bytes = parseInt(job.metadata.statistics.totalBytesProcessed);
        console.log(`[DRY-RUN] Total bytes processed: ${bytes} (${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB)`);
        return;
    }

    console.log(`[BIGQUERY] Running query...`);
    const [rows] = await bigquery.query(options);
    console.log(`[BIGQUERY] Received ${rows.length} rows.`);

    const nameMap = loadCountryNameMap();
    const countriesHistory = {};

    rows.forEach(row => {
        const { iso2 } = fipsToIso2(row.iso2);
        if (!iso2 || !targetIso2s.has(iso2)) return;

        if (!countriesHistory[iso2]) countriesHistory[iso2] = [];

        // Baseline Logic (Consistent with generate_weekly_backfill)
        const b5y = baselines5y[iso2] || {};
        const bCalm = baselinesCalmest3y[iso2]?.gdelt?.baseline || {};
        const b = {
            R1: { median: bCalm.median_r1 || b5y.R1?.median || 1 },
            R2: { median: bCalm.median_r2 || b5y.R2?.median || 1 },
            R3: { median: bCalm.median_r3 || b5y.R3?.median || 1 },
            R4: { median: bCalm.median_r4 || b5y.R4?.median || 1 }
        };

        const result = {
            week: row.iso_week,
            ratios: {},
            levels: {},
            counts: {
                R1: row.r1_security || 0,
                R2: row.r2_living || 0,
                R3: row.r3_governance || 0,
                R4: row.r4_fiscal || 0
            },
            event_count: row.event_count || 0
        };

        let maxLvl = 'None';
        const levelWeights = { 'None': 0, 'Yellow': 1, 'Orange': 2, 'Red': 3 };

        ['R1', 'R2', 'R3', 'R4'].forEach(r => {
            const baselineDaily = b[r]?.median || 1;
            const baseline7 = baselineDaily * 7;
            const today7 = result.counts[r];
            const ratio7 = (today7 + k) / (baseline7 + k);

            result.ratios[r] = parseFloat(ratio7.toFixed(3));

            let lvl = 'None';
            if (ratio7 >= THRESHOLDS.red) lvl = 'Red';
            else if (ratio7 >= THRESHOLDS.orange) lvl = 'Orange';
            else if (ratio7 >= THRESHOLDS.yellow) lvl = 'Yellow';

            result.levels[r] = lvl;
            if (levelWeights[lvl] > levelWeights[maxLvl]) maxLvl = lvl;
        });

        result.overall_level = maxLvl;
        countriesHistory[iso2].push(result);
    });

    // Save fragmented files
    console.log(`[STORAGE] Writing files to ${OUT_DIR}...`);
    let totalFiles = 0;
    let totalSize = 0;

    for (const iso2 of Object.keys(countriesHistory)) {
        // Sort by week
        countriesHistory[iso2].sort((a, b) => a.week.localeCompare(b.week));

        const out = {
            iso2,
            name_en: nameMap[iso2] || iso2,
            generated_at: new Date().toISOString(),
            weeks_total: countriesHistory[iso2].length,
            history: countriesHistory[iso2]
        };

        const filePath = path.join(OUT_DIR, `${iso2}.json`);
        const content = JSON.stringify(out, null, 2);
        fs.writeFileSync(filePath, content);

        totalFiles++;
        totalSize += content.length;
    }

    // index.json
    const index = {
        generated_at: new Date().toISOString(),
        countries: Object.keys(countriesHistory).sort().map(iso2 => ({
            iso2,
            name_en: nameMap[iso2] || iso2,
            weeks: countriesHistory[iso2].length
        }))
    };
    fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));

    console.log(`[DONE] Generated ${totalFiles} files. Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB.`);
}

main().catch(err => {
    console.error("[FATAL]", err);
    process.exit(1);
});
