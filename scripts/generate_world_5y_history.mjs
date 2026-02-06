import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BigQuery } from '@google-cloud/bigquery';
import 'dotenv/config';
import { fipsToIso2, loadCountryNameMap } from './fips_to_iso2.js';
import { buildRCondition } from './gdelt_bigquery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Config
const DATA_DIR = path.resolve(__dirname, '../public/data');
const OUT_DIR = path.resolve(DATA_DIR, 'history/weekly_5y');
const BASELINES_5Y_PATH = path.resolve(DATA_DIR, 'baselines/gdelt_r_baselines_5y.json');
const BASELINES_CALMEST3Y_PATH = path.resolve(DATA_DIR, 'baselines/gdelt_calmest3y_baselines.json');
const SCORING_PATH = path.resolve(__dirname, '../config/scoring.json');
const RDEFS_PATH = path.resolve(__dirname, '../config/r_definitions.json');
const SQL_PATH = path.resolve(__dirname, 'weekly_query.sql');
const INDEX_PATH = path.join(OUT_DIR, 'index.json');

async function main() {
    console.log("[DEBUG] Entered main function");
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    // Allow resuming or forcing specific years
    // Default: split into 1-year chunks from OLD to NEW

    console.log(`[WORLD-5Y] ${dryRun ? 'DRY RUN' : 'STARTING ROBUST BACKFILL'}`);

    // Ensure output dir
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

    // Load Metadata/Progress
    let indexData = {
        generated_at: null,
        weeks: 0,
        countries: [],
        chunks_completed: [] // Track completed year chunks e.g. ["2021", "2022"]
    };
    if (fs.existsSync(INDEX_PATH)) {
        try {
            indexData = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
            // Normalize legacy index
            if (!indexData.chunks_completed) indexData.chunks_completed = [];
        } catch (e) { console.warn("[WARN] Corrupt index.json, starting fresh."); }
    }

    // Config loading (Scoring, Baselines) - SAME AS BEFORE
    const scoringConfig = JSON.parse(fs.readFileSync(SCORING_PATH, 'utf-8'));
    const rDefs = JSON.parse(fs.readFileSync(RDEFS_PATH, 'utf-8'));
    const THRESHOLDS = scoringConfig.surge_r?.thresholds || { yellow: 1.75, orange: 2.75, red: 3.75 };
    const k = scoringConfig.surge_r?.smoothing_k ?? 5;
    let baselines5y = {};
    let baselinesCalmest3y = {};
    try {
        if (fs.existsSync(BASELINES_5Y_PATH)) baselines5y = JSON.parse(fs.readFileSync(BASELINES_5Y_PATH, 'utf-8')).countries || {};
        if (fs.existsSync(BASELINES_CALMEST3Y_PATH)) baselinesCalmest3y = JSON.parse(fs.readFileSync(BASELINES_CALMEST3Y_PATH, 'utf-8')).countries || {};
    } catch (e) { }

    // SQL Prep
    const sqlBase = fs.readFileSync(SQL_PATH, 'utf-8');
    const sqlTemplate = sqlBase
        .replace(/\${R1_CONDITION}/g, buildRCondition(rDefs.R1))
        .replace(/\${R2_CONDITION}/g, buildRCondition(rDefs.R2))
        .replace(/\${R3_CONDITION}/g, buildRCondition(rDefs.R3))
        .replace(/\${R4_CONDITION}/g, buildRCondition(rDefs.R4));

    const bigquery = new BigQuery({
        projectId: process.env.BQ_PROJECT_ID || 'countryrisks-prod',
        keyFilename: path.resolve(__dirname, '../credentials/gcp-service-account.json')
    });

    // Generate Year Chunks (2021..2026)
    // 5 years back from now.
    const chunks = [];
    const today = new Date();
    const startYear = today.getFullYear() - 5;
    const endYear = today.getFullYear();

    for (let y = startYear; y <= endYear; y++) {
        const start = `${y}-01-01`;
        const end = `${y}-12-31`;
        // Clamp end to today
        const effectiveEnd = (y === endYear) ? today.toISOString().split('T')[0] : end;
        if (new Date(start) > today) continue;

        chunks.push({ id: String(y), start, end: effectiveEnd });
    }

    console.log(`[PLAN] Processing ${chunks.length} chunks: ${chunks.map(c => c.id).join(', ')}`);

    const nameMap = loadCountryNameMap();
    let totalBytesProcesssed = 0;

    for (const chunk of chunks) {
        if (indexData.chunks_completed.includes(chunk.id) && !dryRun) {
            console.log(`[SKIP] Chunk ${chunk.id} already completed.`);
            continue;
        }

        console.log(`\n>>> Processing Chunk ${chunk.id} (${chunk.start} to ${chunk.end})`);

        const options = {
            query: sqlTemplate,
            params: { start_date: chunk.start, end_date: chunk.end },
            dryRun: dryRun
        };

        if (dryRun) {
            console.log(`   [DRY-RUN] Estimating cost for ${chunk.id}...`);
            const [job] = await bigquery.createQueryJob(options);
            const bytes = parseInt(job.metadata.statistics.totalBytesProcessed);
            totalBytesProcesssed += bytes;
            console.log(`   [DRY-RUN] Bytes: ${bytes} (${(bytes / 1024 / 1024 / 1024).toFixed(3)} GB)`);
            continue; // Skip processing in dry-run
        }

        // EXECUTE QUERY
        console.log(`   [BQ] Running query...`);
        const [rows] = await bigquery.query(options);
        console.log(`   [BQ] Hit: ${rows.length} rows.`);

        // PROCESSING & MERGING
        // Load all existing JSONs (or load on demand? Buffer all in memory for batch write is faster if memory allows)
        // Since we write per country, we can process rows into memory structure, then merge with disk.

        const newWeeklyData = {}; // iso2 -> [rows]
        const nameMap = loadCountryNameMap();

        rows.forEach(row => {
            const { iso2 } = fipsToIso2(row.iso2);
            if (!iso2 || iso2.length !== 2 || iso2 === 'XX') return;
            if (!newWeeklyData[iso2]) newWeeklyData[iso2] = [];

            // Calc Logic (Same as before)
            const b = {
                R1: { median: baselinesCalmest3y[iso2]?.gdelt?.baseline?.median_r1 || baselines5y[iso2]?.R1?.median || 1 },
                R2: { median: baselinesCalmest3y[iso2]?.gdelt?.baseline?.median_r2 || baselines5y[iso2]?.R2?.median || 1 },
                R3: { median: baselinesCalmest3y[iso2]?.gdelt?.baseline?.median_r3 || baselines5y[iso2]?.R3?.median || 1 },
                R4: { median: baselinesCalmest3y[iso2]?.gdelt?.baseline?.median_r4 || baselines5y[iso2]?.R4?.median || 1 }
            };
            const eventCount7 = row.event_count || 0;
            const result = calculateWeeklyStats(row, eventCount7, b, scoringConfig, THRESHOLDS, k);
            newWeeklyData[iso2].push(result);
        });

        // MERGE & WRITE
        console.log(`   [IO] Merging and writing files for ${Object.keys(newWeeklyData).length} countries...`);
        for (const iso2 of Object.keys(newWeeklyData)) {
            const filePath = path.join(OUT_DIR, `${iso2}.json`);
            let fileData = { iso2, name_en: nameMap[iso2] || iso2, generated_at: null, weeks_total: 0, history: [] };

            if (fs.existsSync(filePath)) {
                fileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            }

            // Merge Logic: Deduplicate by week
            const existingWeeks = new Set(fileData.history.map(h => h.week));
            const freshRows = newWeeklyData[iso2];

            freshRows.forEach(row => {
                if (existingWeeks.has(row.week)) {
                    // Overwrite logic (finding index)
                    const idx = fileData.history.findIndex(h => h.week === row.week);
                    if (idx !== -1) fileData.history[idx] = row;
                } else {
                    fileData.history.push(row);
                }
            });

            // Sort
            fileData.history.sort((a, b) => a.week.localeCompare(b.week));
            fileData.weeks_total = fileData.history.length;
            fileData.generated_at = new Date().toISOString();

            fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));
        }

        // UPDATE INDEX (CHECKPOINT)
        indexData.chunks_completed.push(chunk.id);
        indexData.generated_at = new Date().toISOString();
        // Update countries listing in index (expensive to scan all files? just use memory set of knowns if possible, or scan dir once at end)
        // For checkpoints, we can just save chunks_completed.
        fs.writeFileSync(INDEX_PATH, JSON.stringify(indexData, null, 2));
        console.log(`   [CHECKPOINT] Saved progress. Chunk ${chunk.id} done.`);
    }

    if (dryRun) {
        console.log(`\n[DRY-RUN] Total Estimate: ${(totalBytesProcesssed / 1024 / 1024 / 1024).toFixed(4)} GB`);
    } else {
        // Final Index Refresh
        refreshIndex(OUT_DIR, nameMap, indexData);
        console.log("[DONE] Full backfill complete.");
    }
}

// Helper: Logic Refactor
function calculateWeeklyStats(row, eventCount7, b, scoringConfig, THRESHOLDS, k) {
    const result = {
        week: row.iso_week,
        ratios: {},
        levels: {},
        counts: { R1: row.r1_security || 0, R2: row.r2_living || 0, R3: row.r3_governance || 0, R4: row.r4_fiscal || 0 },
        event_count: eventCount7,
        weekly_surge_r_by_type: {}
    };

    // Configs
    const levelWeights = { 'None': 0, 'Yellow': 1, 'Orange': 2, 'Red': 3 };
    const highVolFloor = scoringConfig.surge_r?.high_volume_floor || 5000;
    const isHighVol = eventCount7 >= highVolFloor;
    const rTypeConfigs = {
        R1: scoringConfig.r1_security, R2: scoringConfig.r2_living,
        R3: scoringConfig.r3_governance, R4: scoringConfig.r4_fiscal
    };

    let maxLvl = 'None';

    ['R1', 'R2', 'R3', 'R4'].forEach(r => {
        const baselineDaily = b[r]?.median || 1;
        const baseline7 = baselineDaily * 7;
        const today7 = result.counts[r];
        const ratio7 = (today7 + k) / (baseline7 + k);
        const share7 = today7 / Math.max(1, eventCount7);

        result.ratios[r] = parseFloat(ratio7.toFixed(3));

        let lvl = 'None';
        if (ratio7 >= THRESHOLDS.red) lvl = 'Red';
        else if (ratio7 >= THRESHOLDS.orange) lvl = 'Orange';
        else if (ratio7 >= THRESHOLDS.yellow) lvl = 'Yellow';
        result.levels[r] = lvl;

        // Gating
        const rGating = scoringConfig.gating?.low_abs || {};
        const absFloor = rGating.floors?.[r] || 0;
        const absShare = rGating.shares?.[r] || 0;
        const dynamicAbsThreshold = Math.max(absFloor, Math.ceil(eventCount7 * absShare));

        const absHit = today7 >= dynamicAbsThreshold;
        const rConf = rTypeConfigs[r] || {};
        const ratioThreshold = rConf.ratio_threshold || 0;
        const shareHit = share7 >= ratioThreshold;
        const redOverride = ratio7 >= THRESHOLDS.red;

        let triggered = shareHit || (absHit && !isHighVol);
        if (redOverride) triggered = true;

        let dynamicMinBaseline = scoringConfig.surge_r?.min_baseline_median_for_surge || 3;
        if (eventCount7 < 500) dynamicMinBaseline = 1.0;
        else if (eventCount7 < 2000) dynamicMinBaseline = 1.5;

        const isStable = baselineDaily >= dynamicMinBaseline;
        const isActive = triggered && isStable && (ratio7 >= THRESHOLDS.yellow);

        let reason = isActive ? 'active' : 'unknown';
        if (!isActive) {
            if (!triggered) {
                if (absHit && isHighVol && !shareHit) reason = 'high-vol';
                else if (absHit && !shareHit) reason = 'low-share';
                else if (!absHit) reason = 'low-abs';
            } else if (!isStable) reason = 'low-baseline';
            else reason = 'below-threshold';
        }

        result.weekly_surge_r_by_type[r] = {
            today7, baseline7: parseFloat(baseline7.toFixed(1)),
            ratio7: result.ratios[r], share7: parseFloat(share7.toFixed(4)),
            is_active: isActive, reason, gate_status: isStable ? 'stable' : 'unknown'
        };

        if (isActive && levelWeights[lvl] > levelWeights[maxLvl]) maxLvl = lvl;
    });

    // Bundle
    const activeRatios = Object.values(result.weekly_surge_r_by_type).filter(v => v.is_active).map(v => v.ratio7);
    const maxRatio = activeRatios.length > 0 ? Math.max(...activeRatios) : 0;
    result.weekly_surge_r = {
        level: maxLvl.toLowerCase(), max_ratio_active: parseFloat(maxRatio.toFixed(3)),
        active_types: Object.entries(result.weekly_surge_r_by_type).filter(([_, v]) => v.is_active).map(([k]) => k),
        thresholds: THRESHOLDS, smoothing_k: k
    };
    result.overall_level = maxLvl;
    return result;
}

function refreshIndex(outDir, nameMap, indexData) {
    console.log("[INDEX] Refreshing index stats...");
    const files = fs.readdirSync(outDir).filter(f => f.endsWith('.json') && f !== 'index.json');
    const countries = [];

    let minW = null;
    let maxW = null;

    files.forEach(f => {
        const c = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf-8'));
        countries.push({ iso2: c.iso2, name_en: c.name_en, weeks: c.weeks_total });
        if (c.history.length > 0) {
            const start = c.history[0].week;
            const end = c.history[c.history.length - 1].week;
            if (!minW || start < minW) minW = start;
            if (!maxW || end > maxW) maxW = end;
        }
    });

    indexData.countries = countries.sort((a, b) => a.iso2.localeCompare(b.iso2));
    indexData.start_week = minW;
    indexData.end_week = maxW;
    indexData.weeks = 260; // Nominal
    indexData.schema_version = "weekly5y-v1";
    indexData.generated_at = new Date().toISOString();

    fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(indexData, null, 2));
    console.log("[INDEX] Updated index.json");
}

main().catch(err => {
    console.error("\n[FATAL ERROR IN MAIN]");
    console.error(err);
    if (err.response) console.error("API Response:", JSON.stringify(err.response.data));
    process.exit(1);
});
