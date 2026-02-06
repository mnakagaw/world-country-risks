import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BigQuery } from '@google-cloud/bigquery';
import 'dotenv/config';
import { fipsToIso2, loadCountryNameMap } from './fips_to_iso2.js';
import { buildRCondition } from './gdelt_bigquery.js';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Config
const DATA_DIR = path.resolve(__dirname, '../public/data');
const WEEKLY_DIR = path.resolve(DATA_DIR, 'weekly');
const COUNTRIES_DIR = path.resolve(WEEKLY_DIR, 'countries');
const BASELINES_5Y_PATH = path.resolve(DATA_DIR, 'baselines/gdelt_r_baselines_5y.json');
const BASELINES_CALMEST3Y_PATH = path.resolve(DATA_DIR, 'baselines/gdelt_calmest3y_baselines.json');
const SCORING_PATH = path.resolve(__dirname, '../config/scoring.json');
const RDEFS_PATH = path.resolve(__dirname, '../config/r_definitions.json');
const SQL_PATH = path.resolve(__dirname, 'weekly_query.sql');

// Load Scoring Config for Gate Logic
const scoringConfig = JSON.parse(fs.readFileSync(SCORING_PATH, 'utf-8'));
const rDefs = JSON.parse(fs.readFileSync(RDEFS_PATH, 'utf-8'));

const THRESHOLDS = scoringConfig.surge_r?.thresholds || { yellow: 1.75, orange: 2.75, red: 3.75 };

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("--")) {
            const key = a.slice(2);
            const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
            out[key] = val;
        }
    }
    return out;
}

/**
 * Gets the Mon-Sun range for the most recently completed ISO week.
 */
function getLastISOWeek() {
    const d = new Date();
    // Move to last Sunday
    const day = d.getDay();
    const diff = day === 0 ? 7 : day;
    const sun = new Date(d);
    sun.setDate(d.getDate() - diff);

    const mon = new Date(sun);
    mon.setDate(sun.getDate() - 6);

    return {
        start: mon.toISOString().split('T')[0],
        end: sun.toISOString().split('T')[0]
    };
}

async function main() {
    const args = parseArgs(process.argv);

    let { start, end } = args;
    if (!start || !end) {
        const last = getLastISOWeek();
        start = start || last.start;
        end = end || last.end;
    }

    console.log(`[WEEKLY-LATEST] Processing week: ${start} to ${end}`);

    // Load Baselines - Prefer calmest3y for ratio7 (pre-crisis windows)
    const baselineJson = JSON.parse(fs.readFileSync(BASELINES_5Y_PATH, 'utf-8'));
    const baselines5y = baselineJson.baselines || baselineJson.countries || {};
    const baselinesCalmest3y = JSON.parse(fs.readFileSync(BASELINES_CALMEST3Y_PATH, 'utf-8')).countries;
    console.log(`[BASELINES] Loaded 5y baselines and calmest3y baselines`);
    const sqlBase = fs.readFileSync(SQL_PATH, 'utf-8');

    // Inject R-Definitions into SQL template
    const sql = sqlBase
        .replace(/\${R1_CONDITION}/g, buildRCondition(rDefs.R1))
        .replace(/\${R2_CONDITION}/g, buildRCondition(rDefs.R2))
        .replace(/\${R3_CONDITION}/g, buildRCondition(rDefs.R3))
        .replace(/\${R4_CONDITION}/g, buildRCondition(rDefs.R4));

    // Init BigQuery
    const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'countryrisks-prod';

    const bigquery = new BigQuery({
        projectId: BQ_PROJECT_ID,
        keyFilename: path.resolve(__dirname, '../credentials/gcp-service-account.json')
    });
    const nameMap = loadCountryNameMap();

    const [job] = await bigquery.createQueryJob({
        query: sql,
        params: {
            start_date: start,
            end_date: new Date(new Date(end).getTime() + 86400000).toISOString().split('T')[0]
        }
    });
    console.log(`[BIGQUERY] Job ${job.id} started...`);
    const [rows] = await job.getQueryResults();

    // Cost Visibility
    const [metadata] = await job.getMetadata();
    const bytes = parseInt(metadata.statistics?.totalBytesProcessed || 0);
    const cost = (bytes / (1024 ** 4) * 5).toFixed(6);
    console.log(`[COST] Weekly Query: ${(bytes / (1024 ** 3)).toFixed(4)} GB scanned, ~$${cost} USD`);

    console.log(`[BIGQUERY] Received ${rows.length} rows.`);

    const weekResult = {};
    let weekId = null;

    rows.forEach(row => {
        const { iso2 } = fipsToIso2(row.iso2);
        if (!iso2) return;
        weekId = row.iso_week;

        // Prefer calmest3y baseline for ratio7 calculation (pre-crisis, lower values)
        const b5y = baselines5y[iso2] || {};
        const bCalm = baselinesCalmest3y[iso2]?.gdelt?.baseline || {};
        // Use calmest3y if available, else fall back to 5y
        const b = {
            R1: { median: bCalm.median_r1 || b5y.R1?.median || 1 },
            R2: { median: bCalm.median_r2 || b5y.R2?.median || 1 },
            R3: { median: bCalm.median_r3 || b5y.R3?.median || 1 },
            R4: { median: bCalm.median_r4 || b5y.R4?.median || 1 }
        };
        const eventCount7 = row.event_count || 0; // Total events for the week (NOT sum of R1-R4)
        const sums = {
            R1: row.r1_security || 0,
            R2: row.r2_living || 0,
            R3: row.r3_governance || 0,
            R4: row.r4_fiscal || 0
        };

        // Unified ratios for Intensity view (same formula as Signal ratio7)
        const k = scoringConfig.surge_r?.smoothing_k ?? 5;
        const unifiedRatios = {};
        const unifiedLevels = {};
        let unifiedBundleParts = [];
        let unifiedMaxLvl = 'None';
        const levelWeights = { 'None': 0, 'Yellow': 1, 'Orange': 2, 'Red': 3 };

        // Track baseline mode for each R-type
        const baselineModes = {};

        ['R1', 'R2', 'R3', 'R4'].forEach(r => {
            const baselineDaily = b[r]?.median || 1;
            const baseline7 = baselineDaily * 7;
            const today7 = sums[r];
            const ratio7 = (today7 + k) / (baseline7 + k);
            unifiedRatios[r] = parseFloat(ratio7.toFixed(3));

            const bCalm = baselinesCalmest3y[iso2]?.gdelt?.baseline || {};
            const calmestKey = `median_${r.toLowerCase()}`;
            baselineModes[r] = bCalm[calmestKey] ? 'calmest3y' : 'fallback_5y';

            let lvl = 'None';
            if (ratio7 >= THRESHOLDS.red) lvl = 'Red';
            else if (ratio7 >= THRESHOLDS.orange) lvl = 'Orange';
            else if (ratio7 >= THRESHOLDS.yellow) lvl = 'Yellow';

            unifiedLevels[r] = lvl;
            if (lvl !== 'None') {
                unifiedBundleParts.push(r);
                if (levelWeights[lvl] > levelWeights[unifiedMaxLvl]) unifiedMaxLvl = lvl;
            }
        });

        // ========== GATE LOGIC (Signal view) ==========
        const highVol = eventCount7 >= scoringConfig.surge_r?.high_volume_floor || eventCount7 >= 5000;
        const minBaseline = scoringConfig.surge_r?.min_baseline_median_for_surge ?? 3;

        const weeklySurgeRByType = {};
        const activeTypes = [];
        let maxRatioActive = 0;

        // R-type config map for abs/share gates
        const rTypeConfigs = {
            R1: scoringConfig.r1_security || { absolute_threshold: 300, ratio_threshold: 0.06 },
            R2: scoringConfig.r2_living || { absolute_threshold: 180, ratio_threshold: 0.035 },
            R3: scoringConfig.r3_governance || { absolute_threshold: 150, ratio_threshold: 0.045 },
            R4: scoringConfig.r4_fiscal || { absolute_threshold: 200, ratio_threshold: 0.04 }
        };

        ['R1', 'R2', 'R3', 'R4'].forEach(r => {
            const today7 = sums[r];
            const baselineDaily = b[r]?.median || 1;
            const baseline7 = baselineDaily * 7; // Full week baseline

            // Smoothed ratio (Gate-based calculation)
            const ratio7 = (today7 + k) / (baseline7 + k);

            // Share calculation (uses total event count, NOT R-type sum)
            const share7 = today7 / Math.max(1, eventCount7);

            // Abs/Share Gates
            // Dynamic Absolute Threshold (New)
            const rGating = scoringConfig.gating?.low_abs || {};
            const absFloor = rGating.floors?.[r] || 0;
            const absShare = rGating.shares?.[r] || 0;
            const dynamicAbsThreshold = Math.max(absFloor, Math.ceil(eventCount7 * absShare));

            const rConf = rTypeConfigs[r];
            const ratioThreshold = rConf.ratio_threshold || 0;

            const absHit = today7 >= dynamicAbsThreshold;
            const shareHitFixed = share7 >= ratioThreshold;

            // Dynamic Share Threshold (Option 1)
            const hvFloor = scoringConfig.surge_r?.high_volume_floor ?? 5000;
            let shareThrUsed = ratioThreshold;
            let shareGateMode = "fixed";

            if (highVol && eventCount7 > hvFloor) {
                const minShareFloor = 0.010; // 1%
                shareThrUsed = Math.max(minShareFloor, ratioThreshold * Math.sqrt(hvFloor / eventCount7));
                shareGateMode = "dynamic";
            }

            const shareHit = share7 >= shareThrUsed;

            // Red-Level Override (Option 2)
            const redThreshold = THRESHOLDS.red;
            const redOverrideUsed = ratio7 >= redThreshold;

            // High-volume suppression: absHit alone not enough, but Red Override bypasses all
            let triggered = shareHit || (absHit && !highVol);
            if (redOverrideUsed) {
                triggered = true;
            }

            // Tiered Baseline Floor (New)
            let dynamicMinBaseline = scoringConfig.surge_r?.min_baseline_median_for_surge || 3;
            if (eventCount7 < 500) dynamicMinBaseline = 1.0;
            else if (eventCount7 < 2000) dynamicMinBaseline = 1.5;

            // Stability check
            const isStable = baselineDaily >= dynamicMinBaseline;
            const activeThreshold = scoringConfig.surge_r?.thresholds?.yellow ?? 1.75;
            const isActive = triggered && isStable && (ratio7 >= activeThreshold);

            // Reason (for UI display)
            let reason = 'active';
            if (isActive) {
                reason = 'active';
                if (shareGateMode === "dynamic" && !shareHitFixed && shareHit) {
                    reason = 'dynamic_share_pass';
                }
            } else {
                // Priority-based gating reason
                if (!triggered) {
                    // triggered = shareHit || (absHit && !highVol) || redOverride
                    if (absHit && highVol && !shareHit) {
                        reason = 'high-vol'; // Keep legacy 'high-vol' for latest for now or unify?
                        // Actually, let's unify with the reason logic I added to backfill for consistency
                        if (absHit && highVol && !shareHit) reason = 'highvol_abs_suppressed';
                        else reason = 'not_triggered';
                    } else if (absHit && !shareHit) {
                        reason = 'low-share';
                    } else if (!absHit && !shareHit) {
                        reason = 'low-abs';
                    }
                } else if (!isStable) {
                    reason = 'low-baseline';
                } else if (ratio7 < activeThreshold) {
                    reason = 'below-threshold';
                }
            }

            if (isActive) {
                activeTypes.push(r);
                if (ratio7 > maxRatioActive) maxRatioActive = ratio7;
            }

            weeklySurgeRByType[r] = {
                today7,
                baseline7: parseFloat(baseline7.toFixed(1)),
                ratio7: parseFloat(ratio7.toFixed(3)),
                share7: parseFloat(share7.toFixed(4)),
                abs_hit: absHit,
                share_hit: shareHit,
                share_thr_used: parseFloat(shareThrUsed.toFixed(4)),
                share_gate_mode: shareGateMode,
                red_override_used: redOverrideUsed,
                high_vol: highVol,
                triggered,
                is_stable: isStable,
                is_active: isActive,
                reason
            };
        });

        // Overall weekly_surge_r level
        let weeklySurgeRLevel = 'green';
        const surgeThresholds = scoringConfig.surge_r?.thresholds || { yellow: 1.75, orange: 2.75, red: 3.75 };
        if (maxRatioActive >= surgeThresholds.red) weeklySurgeRLevel = 'red';
        else if (maxRatioActive >= surgeThresholds.orange) weeklySurgeRLevel = 'orange';
        else if (maxRatioActive >= surgeThresholds.yellow) weeklySurgeRLevel = 'yellow';

        const result = {
            name_en: nameMap[iso2] || iso2,
            // Unified fields (shared by Intensity view - same formula as Signal)
            counts: sums,
            event_count: eventCount7,
            ratios: unifiedRatios,
            levels: unifiedLevels,
            thresholds: THRESHOLDS,
            bundle: unifiedBundleParts.join('+'),
            overall_level: unifiedMaxLvl,
            baseline_modes: baselineModes,
            smoothing_k: k,
            // Gate fields (Signal view)
            weekly_surge_r: {
                level: weeklySurgeRLevel,
                max_ratio_active: parseFloat(maxRatioActive.toFixed(3)),
                active_types: activeTypes,
                thresholds: surgeThresholds,
                smoothing_k: k,
                high_volume_floor: scoringConfig.surge_r?.high_volume_floor ?? 5000,
                min_baseline_median_for_surge: minBaseline
            },
            weekly_surge_r_by_type: weeklySurgeRByType
        };

        weekResult[iso2] = result;
    });

    // [AUDIT] Surge Score Distribution
    const surgeScores = Object.values(weekResult).map(c => c.weekly_surge_r?.max_ratio_active || 0).sort((a, b) => a - b);
    const surgeMax = surgeScores.length > 0 ? surgeScores[surgeScores.length - 1] : 0;
    const surgeMed = surgeScores.length > 0 ? surgeScores[Math.floor(surgeScores.length / 2)] : 0;
    console.log(`[AUDIT] Surge Score Stats (Weekly): Max=${surgeMax.toFixed(1)}, Median=${surgeMed.toFixed(1)}`);

    if (!weekId) {
        console.warn("[WARNING] No data found for the specified period.");
        return;
    }

    // Tier A: Weekly File
    const weekFile = path.join(WEEKLY_DIR, `${weekId}.json`);
    const weekOutput = {
        week: weekId,
        generated_at: new Date().toISOString(),
        countries: weekResult
    };
    fs.writeFileSync(weekFile, JSON.stringify(weekOutput, null, 2));
    console.log(`[STORAGE] Tier A: Written ${weekFile}`);

    // latest.json
    fs.copyFileSync(weekFile, path.join(WEEKLY_DIR, 'latest.json'));

    // index.json
    const weeklyIndexFile = path.join(WEEKLY_DIR, 'index.json');
    const weeklyIndex = JSON.parse(fs.readFileSync(weeklyIndexFile, 'utf-8'));
    if (!weeklyIndex.weeks.includes(weekId)) {
        weeklyIndex.weeks.push(weekId);
        weeklyIndex.weeks.sort();
    }
    weeklyIndex.last_updated = new Date().toISOString();
    weeklyIndex.latest_week = weeklyIndex.weeks[weeklyIndex.weeks.length - 1];
    fs.writeFileSync(weeklyIndexFile, JSON.stringify(weeklyIndex, null, 2));

    // Tier B: Country Files (Update)
    console.log("[STORAGE] Updating Tier B: Country Series...");
    Object.keys(weekResult).forEach(iso => {
        const cFile = path.join(COUNTRIES_DIR, `${iso}.json`);
        if (fs.existsSync(cFile)) {
            const data = JSON.parse(fs.readFileSync(cFile, 'utf-8'));
            // Check if week already exists
            const idx = data.history.findIndex(h => h.week === weekId);
            const entry = { week: weekId, ...weekResult[iso] };
            if (idx > -1) {
                data.history[idx] = entry;
            } else {
                data.history.push(entry);
                data.history.sort((a, b) => a.week.localeCompare(b.week));
            }
            data.generated_at = new Date().toISOString();
            data.weeks_total = data.history.length;
            data.weeks_available = data.history.filter(s => s.overall_level !== 'NoData').length;
            fs.writeFileSync(cFile, JSON.stringify(data, null, 2));
        }
    });

    console.log(`[DONE] Weekly update complete for ${weekId}.`);

    // Run Regression Check
    try {
        console.log("[REGRESSION] Running post-update validation...");
        execSync('node scripts/tests/regression_weekly_cache.mjs', { stdio: 'inherit' });
    } catch (e) {
        console.error("[REGRESSION] Validation failed. Data quality bar not met.");
        // We don't necessarily exit 1 for a single week latest, but it's good for CI
    }
}

main().catch(err => {
    console.error("[FATAL]", err);
    process.exit(1);
});
