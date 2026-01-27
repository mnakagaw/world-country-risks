import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BigQuery } from '@google-cloud/bigquery';
import 'dotenv/config';
import { fipsToIso2, loadCountryNameMap } from './fips_to_iso2.js';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Config
const DATA_DIR = path.resolve(__dirname, '../public/data');
const WEEKLY_DIR = path.resolve(DATA_DIR, 'weekly');
const COUNTRIES_DIR = path.resolve(WEEKLY_DIR, 'countries');
const BASELINES_5Y_PATH = path.resolve(DATA_DIR, 'baselines/gdelt_r_baselines_5y.json');
const BASELINES_CALMEST3Y_PATH = path.resolve(DATA_DIR, 'baselines/gdelt_calmest3y_baselines.json');
const SCORING_PATH = path.resolve(__dirname, '../config/scoring.json');
const SQL_PATH = path.resolve(__dirname, 'weekly_query.sql');

// Load Scoring Config for Gate Logic
const scoringConfig = JSON.parse(fs.readFileSync(SCORING_PATH, 'utf-8'));

const THRESHOLDS = { yellow: 1.75, orange: 2.75, red: 3.75 };
const DEBUG_DIR = path.resolve(__dirname, '../weekly_debug');

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
 * Rounds a date to the previous Sunday (end of ISO week).
 * If date is already Sunday, returns date.
 */
function getPreviousSunday(dateStr) {
    const date = new Date(dateStr);
    const day = date.getDay(); // 0 (Sun) to 6 (Sat)
    if (day !== 0) {
        date.setDate(date.getDate() - day);
    }
    return date;
}

async function main() {
    const args = parseArgs(process.argv);
    const weeksCount = parseInt(args.weeks || '52');
    const debugIso2s = args.iso2 ? args.iso2.split(',').map(s => s.trim().toUpperCase()) : [];
    const endInput = args.end || new Date().toISOString().split('T')[0];

    const endSunday = getPreviousSunday(endInput);
    if (endSunday.toISOString().split('T')[0] !== endInput) {
        console.log(`[DATE] Input ${endInput} is not a Sunday. Rounding to previous Sunday: ${endSunday.toISOString().split('T')[0]}`);
    }

    const startDate = new Date(endSunday);
    startDate.setDate(endSunday.getDate() - (weeksCount * 7) + 1);

    console.log(`[BACKFILL] Starting ${weeksCount}-week backfill: ${startDate.toISOString().split('T')[0]} to ${endSunday.toISOString().split('T')[0]}`);
    if (debugIso2s.length > 0) {
        console.log(`[DEBUG] Instrumented mode enabled for: ${debugIso2s.join(', ')}`);
        if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
    }

    // Ensure Dirs
    [WEEKLY_DIR, COUNTRIES_DIR].forEach(d => {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });

    // Load Baselines - Prefer calmest3y for ratio7 (pre-crisis windows)
    if (!fs.existsSync(BASELINES_5Y_PATH)) {
        throw new Error(`Baseline not found: ${BASELINES_5Y_PATH}`);
    }
    const baselineJson = JSON.parse(fs.readFileSync(BASELINES_5Y_PATH, 'utf-8'));
    const baselines5y = baselineJson.baselines || baselineJson.countries || {};
    const baselinesCalmest3y = JSON.parse(fs.readFileSync(BASELINES_CALMEST3Y_PATH, 'utf-8')).countries;
    console.log(`[BASELINES] Loaded 5y baselines and calmest3y baselines`);

    // Load SQL
    const sqlBase = fs.readFileSync(SQL_PATH, 'utf-8');

    // Init BigQuery
    const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'countryrisks-prod';

    const bigquery = new BigQuery({
        projectId: BQ_PROJECT_ID,
        keyFilename: path.resolve(__dirname, '../credentials/gcp-service-account.json')
    });

    console.log("[BIGQUERY] Fetching 52-week data...");
    const nameMap = loadCountryNameMap();

    const [rows] = await bigquery.query({
        query: sqlBase,
        params: {
            start_date: startDate.toISOString().split('T')[0],
            end_date: new Date(endSunday.getTime() + 86400000).toISOString().split('T')[0] // Day after Sunday
        }
    });
    console.log(`[BIGQUERY] Received ${rows.length} rows.`);

    if (rows.length > 0) {
        console.log("[DEBUG] Sample rows:", JSON.stringify(rows.slice(0, 3), null, 2));
    } else {
        console.log("[DEBUG] Params used:", {
            start: startDate.toISOString().split('T')[0],
            end: new Date(endSunday.getTime() + 86400000).toISOString().split('T')[0]
        });
    }

    // Process Rows
    // Map of week -> iso2 -> data
    const weeksData = {};
    // Map of iso2 -> week -> data
    const countriesData = {};
    // Map of iso2 -> [debugEntries]
    const debugStore = {};

    rows.forEach(row => {
        const { iso2 } = fipsToIso2(row.iso2);
        if (!iso2) return;

        const week = row.iso_week; // YYYY-WW
        if (!weeksData[week]) weeksData[week] = {};
        if (!countriesData[iso2]) countriesData[iso2] = {};

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
            const baseline7 = baselineDaily * 7; // Full week baseline
            const today7 = sums[r];
            // Unified formula: same as Signal ratio7
            const ratio7 = (today7 + k) / (baseline7 + k);
            unifiedRatios[r] = parseFloat(ratio7.toFixed(3));

            // Track baseline source
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
            const rConf = rTypeConfigs[r];
            const absThreshold = rConf.absolute_threshold || 0;
            const ratioThreshold = rConf.ratio_threshold || 0;

            const absHit = today7 >= absThreshold;
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

            // Stability check
            const isStable = baselineDaily >= minBaseline;
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
                if (eventCount7 === 0) {
                    reason = 'eventCount_missing';
                } else if (!isStable) {
                    reason = 'unstable_baseline';
                } else if (!triggered) {
                    // triggered = shareHit || (absHit && !highVol) || redOverride
                    if (absHit && highVol && !shareHit) {
                        reason = 'highvol_abs_suppressed';
                    } else {
                        reason = 'not_triggered';
                    }
                } else if (ratio7 < activeThreshold) {
                    reason = 'below_threshold';
                } else {
                    reason = 'other';
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

            // Debug storage
            if (debugIso2s.includes(iso2)) {
                if (!debugStore[iso2]) debugStore[iso2] = [];
                debugStore[iso2].push({
                    week,
                    r,
                    today7,
                    baseline7: parseFloat(baseline7.toFixed(1)),
                    ratio7: parseFloat(ratio7.toFixed(3)),
                    share7: parseFloat(share7.toFixed(4)),
                    eventCount7,
                    absHit,
                    shareHit,
                    shareThrUsed: parseFloat(shareThrUsed.toFixed(4)),
                    shareGateMode,
                    redOverrideUsed,
                    highVol,
                    triggered,
                    isStable,
                    isActive,
                    reason,
                    thresholds: {
                        abs: absThreshold,
                        share: ratioThreshold,
                        active: activeThreshold,
                        highVolFloor: scoringConfig.surge_r?.high_volume_floor ?? 5000
                    }
                });
            }
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

        weeksData[week][iso2] = result;
        countriesData[iso2][week] = result;
    });

    // [AUDIT] Total Surge Distribution
    const allSurgeScores = Object.values(countriesData).flatMap(w => Object.values(w).map(c => c.weekly_surge_r?.max_ratio_active || 0)).sort((a, b) => a - b);
    const surgeMax = allSurgeScores.length > 0 ? allSurgeScores[allSurgeScores.length - 1] : 0;
    const surgeMed = allSurgeScores.length > 0 ? allSurgeScores[Math.floor(allSurgeScores.length / 2)] : 0;
    console.log(`[AUDIT] Backfill Surge Stats: Max=${surgeMax.toFixed(1)}, Median=${surgeMed.toFixed(1)}`);

    // Tier A: Weekly Files
    console.log("[STORAGE] Writing Tier A: Weekly Summaries...");
    const availableWeeks = Object.keys(weeksData).sort();
    availableWeeks.forEach(w => {
        const out = {
            week: w,
            generated_at: new Date().toISOString(),
            countries: weeksData[w]
        };
        fs.writeFileSync(path.join(WEEKLY_DIR, `${w}.json`), JSON.stringify(out, null, 2));
    });

    // latest.json (Tier A)
    if (availableWeeks.length > 0) {
        const lastWeek = availableWeeks[availableWeeks.length - 1];
        fs.copyFileSync(path.join(WEEKLY_DIR, `${lastWeek}.json`), path.join(WEEKLY_DIR, 'latest.json'));
        console.log(`[STORAGE] latest.json set to ${lastWeek}`);
    }

    fs.writeFileSync(path.join(WEEKLY_DIR, 'index.json'), JSON.stringify({
        last_updated: new Date().toISOString(),
        latest_week: availableWeeks[availableWeeks.length - 1],
        weeks: availableWeeks
    }, null, 2));

    // Tier B: Country Files
    console.log("[STORAGE] Writing Tier B: Country Series...");
    const isos = Object.keys(countriesData).sort();
    isos.forEach(iso => {
        const series = [];
        // Use all available weeks to ensure full sequence, even if gaps
        availableWeeks.forEach(w => {
            const data = countriesData[iso][w];
            if (data) {
                series.push({ week: w, ...data });
            } else {
                // NoData gap - include Gate fields for UI compatibility
                series.push({
                    week: w,
                    counts: { R1: 0, R2: 0, R3: 0, R4: 0 },
                    event_count: 0,
                    ratios: { R1: 0, R2: 0, R3: 0, R4: 0 },
                    levels: { R1: 'NoData', R2: 'NoData', R3: 'NoData', R4: 'NoData' },
                    overall_level: 'NoData',
                    bundle: 'NoData',
                    weekly_surge_r: {
                        level: 'nodata',
                        max_ratio_active: 0,
                        active_types: [],
                        thresholds: scoringConfig.surge_r?.thresholds || { yellow: 1.75, orange: 2.75, red: 3.75 }
                    },
                    weekly_surge_r_by_type: {
                        R1: { today7: 0, baseline7: 0, ratio7: 0, share7: 0, triggered: false, is_active: false, reason: 'no-data' },
                        R2: { today7: 0, baseline7: 0, ratio7: 0, share7: 0, triggered: false, is_active: false, reason: 'no-data' },
                        R3: { today7: 0, baseline7: 0, ratio7: 0, share7: 0, triggered: false, is_active: false, reason: 'no-data' },
                        R4: { today7: 0, baseline7: 0, ratio7: 0, share7: 0, triggered: false, is_active: false, reason: 'no-data' }
                    }
                });
            }
        });

        const availableCount = series.filter(s => s.overall_level !== 'NoData').length;
        const out = {
            iso2: iso,
            generated_at: new Date().toISOString(),
            weeks_total: series.length,
            weeks_available: availableCount,
            history: series
        };
        fs.writeFileSync(path.join(COUNTRIES_DIR, `${iso}.json`), JSON.stringify(out, null, 2));
    });

    // countries/index.json
    const countryIndices = {};
    isos.forEach(iso => {
        const series = countriesData[iso];
        const count = Object.keys(series).length;
        countryIndices[iso] = {
            weeks_total: availableWeeks.length,
            weeks_available: count,
            updated: new Date().toISOString()
        };
    });
    fs.writeFileSync(path.join(COUNTRIES_DIR, 'index.json'), JSON.stringify({
        last_updated: new Date().toISOString(),
        countries: countryIndices
    }, null, 2));

    console.log(`[DONE] Backfill complete. Generated ${availableWeeks.length} weeks and ${isos.length} country files.`);

    // Write Debug Output
    if (Object.keys(debugStore).length > 0) {
        console.log("\n" + "=".repeat(60));
        console.log("WEEKLY SIGNAL DEBUG SUMMARY");
        console.log("=".repeat(60));

        for (const iso of debugIso2s) {
            const entries = debugStore[iso];
            if (!entries) {
                console.log(`\n[${iso}] No data found in BigQuery results for requested weeks.`);
                continue;
            }

            // Write JSON
            fs.writeFileSync(path.join(DEBUG_DIR, `${iso}.json`), JSON.stringify(entries, null, 2));

            // Console Summary
            const stats = {};
            entries.forEach(e => {
                const key = `${e.r}: ${e.reason}`;
                stats[key] = (stats[key] || 0) + 1;
            });

            console.log(`\n[${iso}] Reasons Summary (Last ${weeksCount} weeks):`);
            Object.entries(stats).sort().forEach(([k, v]) => {
                console.log(`  - ${k.padEnd(25)}: ${v}`);
            });
            console.log(`Detailed log: ${path.join(DEBUG_DIR, `${iso}.json`)}`);
        }
        console.log("=".repeat(60) + "\n");
    }

    // Run Regression Check
    try {
        console.log("[REGRESSION] Running post-backfill validation...");
        execSync('node scripts/tests/regression_weekly_cache.mjs', { stdio: 'inherit' });
    } catch (e) {
        console.error("[REGRESSION] Validation failed. Please check the Tier A/B data quality.");
        process.exit(1);
    }
}

main().catch(err => {
    console.error("[FATAL]", err);
    process.exit(1);
});
