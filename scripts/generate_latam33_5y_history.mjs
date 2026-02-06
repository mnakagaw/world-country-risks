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

        const eventCount7 = row.event_count || 0;
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
            event_count: eventCount7,
            weekly_surge_r_by_type: {}
        };

        let maxLvl = 'None';
        const levelWeights = { 'None': 0, 'Yellow': 1, 'Orange': 2, 'Red': 3 };
        const minBaseline = scoringConfig.surge_r?.min_baseline_median_for_surge || 3;
        const highVolFloor = scoringConfig.surge_r?.high_volume_floor || 5000;
        const isHighVolCountry = eventCount7 >= highVolFloor;

        const rTypeConfigs = {
            R1: scoringConfig.r1_security || { absolute_threshold: 300, ratio_threshold: 0.06 },
            R2: scoringConfig.r2_living || { absolute_threshold: 180, ratio_threshold: 0.035 },
            R3: scoringConfig.r3_governance || { absolute_threshold: 150, ratio_threshold: 0.045 },
            R4: scoringConfig.r4_fiscal || { absolute_threshold: 200, ratio_threshold: 0.04 }
        };

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

            // Full Gating Logic (Mirroring generate_weekly_latest.mjs)
            const rGating = scoringConfig.gating?.low_abs || {};
            const absFloor = rGating.floors?.[r] || 0;
            const absShare = rGating.shares?.[r] || 0;
            const dynamicAbsThreshold = Math.max(absFloor, Math.ceil(eventCount7 * absShare));

            const rConf = rTypeConfigs[r];
            const ratioThreshold = rConf.ratio_threshold || 0;

            const absHit = today7 >= dynamicAbsThreshold;
            const shareHit = share7 >= ratioThreshold;
            const redOverride = ratio7 >= THRESHOLDS.red;

            let triggered = shareHit || (absHit && !isHighVolCountry);
            if (redOverride) triggered = true;

            // Tiered Baseline Floor (New)
            let dynamicMinBaseline = scoringConfig.surge_r?.min_baseline_median_for_surge || 3;
            if (eventCount7 < 500) dynamicMinBaseline = 1.0;
            else if (eventCount7 < 2000) dynamicMinBaseline = 1.5;

            const isStable = b[r]?.median !== undefined && b[r]?.median >= dynamicMinBaseline;
            const activeThreshold = THRESHOLDS.yellow;
            const isActive = triggered && isStable && (ratio7 >= activeThreshold);

            let reason = isActive ? "active" : "unknown";
            if (!isActive) {
                if (!triggered) {
                    if (absHit && isHighVolCountry && !shareHit) reason = "high-vol";
                    else if (absHit && !shareHit) reason = "low-share";
                    else if (!absHit) reason = "low-abs";
                } else if (!isStable) {
                    reason = "low-baseline";
                } else if (ratio7 < activeThreshold) {
                    reason = "below-threshold";
                }
            }

            result.weekly_surge_r_by_type[r] = {
                today7,
                baseline7: parseFloat(baseline7.toFixed(1)),
                ratio7: result.ratios[r],
                share7: parseFloat(share7.toFixed(4)),
                is_active: isActive,
                reason: reason,
                gate_status: isStable ? "stable" : "unknown"
            };

            if (isActive && levelWeights[lvl] > levelWeights[maxLvl]) {
                maxLvl = lvl;
            }
        });

        // Add top-level weekly_surge_r for bundle consistency
        const activeRatios = Object.values(result.weekly_surge_r_by_type)
            .filter(r => r.is_active)
            .map(r => r.ratio7);
        const maxRatioActive = activeRatios.length > 0 ? Math.max(...activeRatios) : 0;
        const activeTypes = Object.entries(result.weekly_surge_r_by_type)
            .filter(([_, v]) => v.is_active)
            .map(([k, _]) => k);

        result.weekly_surge_r = {
            level: maxLvl.toLowerCase(),
            max_ratio_active: parseFloat(maxRatioActive.toFixed(3)),
            active_types: activeTypes,
            thresholds: THRESHOLDS,
            smoothing_k: k
        };

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
