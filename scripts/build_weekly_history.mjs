
// Scripts for generating weekly historical data for selected countries

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Config
const CONFIG_PATH = path.resolve(__dirname, '../config/history_countries.json');
const DATA_DIR = path.resolve(__dirname, '../public/data');
const OUT_DIR = path.resolve(DATA_DIR, 'history/weekly');

// Load Config
if (!fs.existsSync(CONFIG_PATH)) {
    console.error("Config not found:", CONFIG_PATH);
    process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const TARGET_COUNTRIES = new Set(config.countries);
const WEEKS = config.weeks || 52;

// Load Latest V4 for Baselines & Validation
const LATEST_PATH = path.resolve(DATA_DIR, 'latest_v4.json');
if (!fs.existsSync(LATEST_PATH)) {
    console.error("latest_v4.json not found. Run generate_daily.js first.");
    process.exit(1);
}
const latestData = JSON.parse(fs.readFileSync(LATEST_PATH, 'utf-8'));

// Helper: Ensure directory exists
if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
}

// Helper: Get Past Dates
function getPastDates(startDateStr, daysBack) {
    const dates = [];
    const start = new Date(startDateStr);
    for (let i = 0; i < daysBack; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
}

// Main Build Function
async function buildHistory() {
    console.log(`[HISTORY] Building ${WEEKS}w history for ${TARGET_COUNTRIES.size} countries...`);

    if (!latestData || !latestData.generated_at) {
        console.error("latest_v4.json missing generated_at field.");
        process.exit(1);
    }
    const todayDate = latestData.generated_at.split('T')[0]; // YYYY-MM-DD
    const requiredDays = WEEKS * 7 + 14; // Buffer
    const dateList = getPastDates(todayDate, requiredDays);

    // 1. Load Daily Data Cache (InMemory - optimization)
    // We only need daily counts for R1-R4 for target countries
    // Iterate files in public/data/YYYY-MM-DD.json

    // Optimization: Instead of reading full files, check if we have a "mart" or if we rely on daily files.
    // Given the instructions, we use "public/data/YYYY-MM-DD.json" as source.

    const dailyCache = {}; // { iso: { '2025-XX-XX': { r1:10, r2:5... } } }

    // Initialize cache structure
    TARGET_COUNTRIES.forEach(iso => dailyCache[iso] = {});

    console.log(`[HISTORY] Loading daily JSON files (Scanning ${requiredDays} days)...`);

    let loadedFiles = 0;
    for (const date of dateList) {
        const fPath = path.resolve(DATA_DIR, `${date}.json`);
        if (fs.existsSync(fPath)) {
            try {
                const dData = JSON.parse(fs.readFileSync(fPath, 'utf-8'));
                if (dData.countries) {
                    TARGET_COUNTRIES.forEach(iso => {
                        const c = dData.countries[iso];
                        if (c && c.gdelt) {
                            dailyCache[iso][date] = {
                                r1: c.gdelt.r1_security || 0,
                                r2: c.gdelt.r2_living_count || 0,
                                r3: c.gdelt.r3_governance || 0,
                                r4: c.gdelt.r4_fiscal_count || 0
                            };
                        }
                    });
                }
                loadedFiles++;
            } catch (e) {
                // Ignore corrupt/missing
            }
        }
    }
    console.log(`[HISTORY] Loaded ${loadedFiles} daily files.`);

    // 2. Build Weekly Stats
    const indexData = {
        asof: todayDate,
        weeks: WEEKS,
        available: {}
    };

    for (const iso of TARGET_COUNTRIES) {
        const cLatest = latestData.countries[iso];
        if (!cLatest) continue;

        // Get Baselines from latest_v4 (using surge_r_by_type metadata if available, else derive)
        // Note: latest_v4 structure: c.surge_r_by_type.R1.baseline_median
        const baselines = {
            R1: cLatest.surge_r_by_type?.R1?.baseline_median || 1, // Avoid /0
            R2: cLatest.surge_r_by_type?.R2?.baseline_median || 1,
            R3: cLatest.surge_r_by_type?.R3?.baseline_median || 1,
            R4: cLatest.surge_r_by_type?.R4?.baseline_median || 1
        };

        const result = {
            iso2: iso,
            asof: todayDate,
            weeks: WEEKS,
            week_labels: [],
            week_starts: [],
            thresholds: { yellow: 1.75, orange: 2.75, red: 3.75 },
            by_type: { R1: {}, R2: {}, R3: {}, R4: {} },
            bundle: [],
            overall_level: [],
            first_lit: { R1: {}, R2: {}, R3: {}, R4: {}, overall: {} }
        };

        // Initialize arrays
        ['R1', 'R2', 'R3', 'R4'].forEach(r => {
            result.by_type[r] = { ratio: [], level: [], count: [] };
        });

        let weeksAvailableCount = 0;

        // W0 = today, W-1 = today-7d ...
        // Loop backwards from 0 (Current) to WEEKS-1
        for (let w = 0; w < WEEKS; w++) {
            const startDayIdx = w * 7;
            const weekDates = dateList.slice(startDayIdx, startDayIdx + 7);

            // Calc Sums
            const sums = { R1: 0, R2: 0, R3: 0, R4: 0 };
            let daysWithData = 0;

            weekDates.forEach(d => {
                const entry = dailyCache[iso][d];
                if (entry) {
                    sums.R1 += entry.r1;
                    sums.R2 += entry.r2;
                    sums.R3 += entry.r3;
                    sums.R4 += entry.r4;
                    daysWithData++;
                }
            });

            // STRICT DATA CHECK: Must have 7 full days to be valid
            const isNoData = daysWithData < 7;
            if (!isNoData) weeksAvailableCount++;

            const label = w === 0 ? "W0" : `W-${w}`;
            result.week_labels.unshift(label);
            result.week_starts.unshift(weekDates[weekDates.length - 1]); // Start of week (oldest day)

            // Calc Ratios & Levels
            const weekLevels = [];
            let bundleParts = [];

            ['R1', 'R2', 'R3', 'R4'].forEach(r => {
                const bVal = baselines[r];
                let ratio = null;
                let level = 'None';

                if (isNoData) {
                    level = 'NoData';
                } else if (bVal > 0) {
                    ratio = sums[r] / (bVal * 7);
                    if (ratio >= 3.75) level = 'Red';
                    else if (ratio >= 2.75) level = 'Orange';
                    else if (ratio >= 1.75) level = 'Yellow';
                }

                // Add to head (unshift) because we iterate Current -> Past
                result.by_type[r].ratio.unshift(ratio !== null ? parseFloat(ratio.toFixed(2)) : null);
                result.by_type[r].level.unshift(level);
                result.by_type[r].count.unshift(sums[r]);

                if (['Yellow', 'Orange', 'Red'].includes(level)) {
                    weekLevels.push(level);
                    bundleParts.push(r);
                }
            });

            // Bundle
            result.bundle.unshift(isNoData ? 'NoData' : bundleParts.join('+'));

            // Overall Level
            let maxLvl = isNoData ? 'NoData' : 'None';
            if (!isNoData) {
                if (weekLevels.includes('Red')) maxLvl = 'Red';
                else if (weekLevels.includes('Orange')) maxLvl = 'Orange';
                else if (weekLevels.includes('Yellow')) maxLvl = 'Yellow';
            }
            result.overall_level.unshift(maxLvl);
        }

        result.weeks_available = weeksAvailableCount;

        // First Lit Logic (Scan Forward)
        const levelsOrder = { 'NoData': -1, 'None': 0, 'Yellow': 1, 'Orange': 2, 'Red': 3 };

        ['R1', 'R2', 'R3', 'R4'].forEach(r => {
            // Find first occurrence of Y/O/R
            // Scan from oldest (index 0) to newest
            const lvls = result.by_type[r].level;
            const labels = result.week_labels;

            let fY = null, fO = null, fR = null;

            for (let i = 0; i < lvls.length; i++) {
                const l = lvls[i];
                const val = levelsOrder[l];
                if (val >= 1 && !fY) fY = labels[i];
                if (val >= 2 && !fO) fO = labels[i];
                if (val >= 3 && !fR) fR = labels[i];
            }
            result.first_lit[r] = { yellow: fY, orange: fO, red: fR };
        });

        // Overall First Lit
        {
            const lvls = result.overall_level;
            const labels = result.week_labels;
            let fY = null, fO = null, fR = null;
            for (let i = 0; i < lvls.length; i++) {
                const l = lvls[i];
                const val = levelsOrder[l];
                if (val >= 1 && !fY) fY = labels[i];
                if (val >= 2 && !fO) fO = labels[i];
                if (val >= 3 && !fR) fR = labels[i];
            }
            result.first_lit.overall = { yellow: fY, orange: fO, red: fR };
        }

        // Write File
        const outPath = path.resolve(OUT_DIR, `${iso}.json`);
        fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

        // Update Index
        indexData.available[iso] = {
            weeks: WEEKS,
            updated: todayDate,
            weeks_available: weeksAvailableCount
        };
    }

    // Write Index
    fs.writeFileSync(path.resolve(OUT_DIR, 'index.json'), JSON.stringify(indexData, null, 2));
    console.log("[HISTORY] Complete. Index written.");
}

buildHistory();
