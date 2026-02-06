
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

// Helper to get ISO week string "YYYY-WW" from Date
function getIsoWeekStr(d) {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    return `${date.getFullYear()}-${String(weekNum).padStart(2, '0')}`;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    // Arg for target week: --week=2026-04
    // If missing, auto-detect Last Completed Week (e.g. if today is Wed, last complete is prev Sun-Sat)

    // Auto Calc: Last finalized week
    // GDELT stabilizes after 24-48h. Safe: Previous Full Week (Mon-Sun).
    // Today
    const today = new Date();
    // Go back to last Sunday
    const lastSunday = new Date(today);
    lastSunday.setDate(today.getDate() - today.getDay() - 1); // Sat? No, getDay 0=Sun. 
    // Actually, ISO week is Mon-Sun
    // If today is Friday, current week is unfin. Previous week is OK.
    // Logic: Target end date = last Sunday. Start date = last Monday - 7.
    // Let's use standard ISO week logic.

    // Default: The week ending last Sunday.
    const lastWeekEnd = new Date(today);
    lastWeekEnd.setDate(today.getDate() - (today.getDay() || 7)); // Go to previous Sunday
    // Check if we need to go back further?
    // If today is Monday(1), last Sunday is yesterday. Close call.
    // User can specify --week if needed.
    const targetWeekStr = args.find(a => a.startsWith('--week='))?.split('=')[1] || getIsoWeekStr(lastWeekEnd);

    console.log(`[APPEND-WEEK] Target: ${targetWeekStr} (DryRun=${dryRun})`);

    // Determine Date Range for SQL (Mon-Sun of that week)
    // Parse YYYY-WW
    const [yStr, wStr] = targetWeekStr.split('-');
    const year = parseInt(yStr);
    const week = parseInt(wStr);

    // Simple date from week
    // Jan 4th is always in week 1.
    const simple = new Date(year, 0, 4);
    const dow = (simple.getDay() || 7) - 1; // Mon=0
    simple.setDate(simple.getDate() - dow + (week - 1) * 7);
    const startIso = simple.toISOString().split('T')[0];
    const endSimple = new Date(simple);
    endSimple.setDate(simple.getDate() + 6);
    const endIso = endSimple.toISOString().split('T')[0];

    console.log(`[APPEND-WEEK] SQL Range: ${startIso} to ${endIso}`);

    // Ensure output dir
    if (!fs.existsSync(OUT_DIR)) {
        console.error(`[ERROR] Output directory ${OUT_DIR} missing. Run full backfill first.`);
        process.exit(1);
    }

    // Config loading
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

    // SQL
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

    const options = {
        query: sqlTemplate,
        params: { start_date: startIso, end_date: endIso },
        dryRun: dryRun
    };

    if (dryRun) {
        console.log(`[DRY-RUN] Estimating cost...`);
        const [job] = await bigquery.createQueryJob(options);
        const bytes = parseInt(job.metadata.statistics.totalBytesProcessed);
        console.log(`[DRY-RUN] Bytes: ${bytes} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
        return;
    }

    console.log(`[BQ] Running query...`);
    const [rows] = await bigquery.query(options);
    console.log(`[BQ] Hit: ${rows.length} rows.`);

    const newWeeklyData = {}; // iso2 -> [rows]
    const nameMap = loadCountryNameMap();

    rows.forEach(row => {
        const { iso2 } = fipsToIso2(row.iso2);
        if (!iso2 || iso2.length !== 2 || iso2 === 'XX') return;
        if (!newWeeklyData[iso2]) newWeeklyData[iso2] = [];

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

    console.log(`[IO] Appending files for ${Object.keys(newWeeklyData).length} countries...`);
    for (const iso2 of Object.keys(newWeeklyData)) {
        const filePath = path.join(OUT_DIR, `${iso2}.json`);
        let fileData = { iso2, name_en: nameMap[iso2] || iso2, generated_at: null, weeks_total: 0, history: [] };

        if (fs.existsSync(filePath)) {
            fileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }

        const freshRows = newWeeklyData[iso2];
        const existingWeeks = new Set(fileData.history.map(h => h.week));

        freshRows.forEach(row => {
            if (existingWeeks.has(row.week)) {
                // Update existing
                const idx = fileData.history.findIndex(h => h.week === row.week);
                if (idx !== -1) fileData.history[idx] = row;
            } else {
                // Append
                fileData.history.push(row);
            }
        });

        // Ensure sorted
        fileData.history.sort((a, b) => a.week.localeCompare(b.week));

        // Clean up old history? (Keep 5y = 260 weeks)
        if (fileData.history.length > 270) {
            fileData.history = fileData.history.slice(fileData.history.length - 260); // Keep last 260
        }

        fileData.weeks_total = fileData.history.length;
        fileData.generated_at = new Date().toISOString();

        fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));
    }

    // Update Index
    refreshIndex(OUT_DIR, nameMap);
    console.log(`[DONE] Append complete for ${targetWeekStr}.`);
}

function calculateWeeklyStats(row, eventCount7, b, scoringConfig, THRESHOLDS, k) {
    const result = {
        week: row.iso_week,
        ratios: {},
        levels: {},
        counts: { R1: row.r1_security || 0, R2: row.r2_living || 0, R3: row.r3_governance || 0, R4: row.r4_fiscal || 0 },
        event_count: eventCount7,
        weekly_surge_r_by_type: {}
    };

    // Helper Maps
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

function refreshIndex(outDir, nameMap) {
    let indexData = {};
    if (fs.existsSync(INDEX_PATH)) {
        indexData = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
    }

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
    indexData.generated_at = new Date().toISOString();

    fs.writeFileSync(INDEX_PATH, JSON.stringify(indexData, null, 2));
    console.log("[INDEX] Updated index.json");
}

main().catch(console.error);
