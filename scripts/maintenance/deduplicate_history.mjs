
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HISTORY_DIR = path.resolve(__dirname, '../../public/data/history/weekly_5y');
const SCORING_PATH = path.resolve(__dirname, '../../config/scoring.json');

// Copied / Simplified Logic
const scoringConfig = JSON.parse(fs.readFileSync(SCORING_PATH, 'utf-8'));
const THRESHOLDS = scoringConfig.surge_r?.thresholds || { yellow: 1.75, orange: 2.75, red: 3.75 };
const K = scoringConfig.surge_r?.smoothing_k ?? 5;

// Gating Config
const rGating = scoringConfig.gating?.low_abs || {};
const highVolFloor = scoringConfig.surge_r?.high_volume_floor || 5000;

function recalculateStats(iso2, week, items) {
    if (items.length === 1) return items[0];

    // Merge Counts
    const merged = {
        week,
        counts: { R1: 0, R2: 0, R3: 0, R4: 0 },
        event_count: 0,
        weekly_surge_r_by_type: {},
        ratios: {},
        levels: {}
    };

    // We need baselines. We assume all items share the same baseline (since same ISO/Week).
    const baselines = { R1: 1, R2: 1, R3: 1, R4: 1 }; // Fallback

    items.forEach(item => {
        merged.event_count += (item.event_count || 0);
        merged.counts.R1 += (item.counts.R1 || 0);
        merged.counts.R2 += (item.counts.R2 || 0);
        merged.counts.R3 += (item.counts.R3 || 0);
        merged.counts.R4 += (item.counts.R4 || 0);

        // Extract baseline from first available item
        ['R1', 'R2', 'R3', 'R4'].forEach(r => {
            if (item.weekly_surge_r_by_type[r]?.baseline7) {
                baselines[r] = item.weekly_surge_r_by_type[r].baseline7;
            }
        });
    });

    // Recalculate Logic
    const isHighVol = merged.event_count >= highVolFloor;
    let maxLvl = 'None';
    const levelWeights = { 'None': 0, 'Yellow': 1, 'Orange': 2, 'Red': 3 };

    ['R1', 'R2', 'R3', 'R4'].forEach(r => {
        const baseline7 = baselines[r];
        const today7 = merged.counts[r];
        const ratio7 = (today7 + K) / (baseline7 + K);
        const share7 = today7 / Math.max(1, merged.event_count);

        merged.ratios[r] = parseFloat(ratio7.toFixed(3));

        let lvl = 'None';
        if (ratio7 >= THRESHOLDS.red) lvl = 'Red';
        else if (ratio7 >= THRESHOLDS.orange) lvl = 'Orange';
        else if (ratio7 >= THRESHOLDS.yellow) lvl = 'Yellow';
        merged.levels[r] = lvl;

        // Gating Re-eval
        const absFloor = rGating.floors?.[r] || 0;
        const absShare = rGating.shares?.[r] || 0;
        const dynamicAbsThreshold = Math.max(absFloor, Math.ceil(merged.event_count * absShare));

        const absHit = today7 >= dynamicAbsThreshold;
        const rConf = (r === 'R1' ? scoringConfig.r1_security :
            r === 'R2' ? scoringConfig.r2_living :
                r === 'R3' ? scoringConfig.r3_governance :
                    scoringConfig.r4_fiscal) || {};

        const ratioThreshold = rConf.ratio_threshold || 0;
        const shareHit = share7 >= ratioThreshold;
        const redOverride = ratio7 >= THRESHOLDS.red;

        let triggered = shareHit || (absHit && !isHighVol);
        if (redOverride) triggered = true;

        // Baseline Stability Check (Reverse engineer baselineDaily from baseline7?)
        // baseline7 = baselineDaily * 7 => baselineDaily = baseline7 / 7
        const baselineDaily = baseline7 / 7;
        let dynamicMinBaseline = scoringConfig.surge_r?.min_baseline_median_for_surge || 3;
        if (merged.event_count < 500) dynamicMinBaseline = 1.0;
        else if (merged.event_count < 2000) dynamicMinBaseline = 1.5;

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

        merged.weekly_surge_r_by_type[r] = {
            today7, baseline7,
            ratio7: merged.ratios[r],
            share7: parseFloat(share7.toFixed(4)),
            is_active: isActive,
            reason,
            gate_status: isStable ? 'stable' : 'unstable'
        };

        if (isActive && levelWeights[lvl] > levelWeights[maxLvl]) maxLvl = lvl;
    });

    // Bundle Overall
    const activeRatios = Object.values(merged.weekly_surge_r_by_type).filter(v => v.is_active).map(v => v.ratio7);
    const maxRatio = activeRatios.length > 0 ? Math.max(...activeRatios) : 0;

    merged.weekly_surge_r = {
        level: maxLvl.toLowerCase(),
        max_ratio_active: parseFloat(maxRatio.toFixed(3)),
        active_types: Object.entries(merged.weekly_surge_r_by_type).filter(([_, v]) => v.is_active).map(([k]) => k),
        thresholds: THRESHOLDS,
        smoothing_k: K
    };
    merged.overall_level = maxLvl;

    return merged;
}

// Main Dedup execution
async function main() {
    console.log("[DEDUPE] Starting deduplication pass...");
    if (!fs.existsSync(HISTORY_DIR)) {
        console.error("History dir not found.");
        return;
    }

    const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json') && f !== 'index.json');
    let fixedCountries = 0;

    for (const file of files) {
        const filePath = path.join(HISTORY_DIR, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        // Check for duplicates
        const weeksMap = new Map(); // week -> [items]
        let hasDupes = false;

        data.history.forEach(item => {
            if (!weeksMap.has(item.week)) weeksMap.set(item.week, []);
            weeksMap.get(item.week).push(item);
        });

        for (const [w, items] of weeksMap) {
            if (items.length > 1) {
                hasDupes = true;
                break;
            }
        }

        if (hasDupes) {
            console.log(`[FIX] Fixing duplicates in ${file} (${data.history.length} items)...`);
            const newHistory = [];

            // Sort keys to ensure chronological order before processing? Map preserves insertion order usually, but safer to sort keys
            const sortedWeeks = Array.from(weeksMap.keys()).sort();

            for (const w of sortedWeeks) {
                const items = weeksMap.get(w);
                const mergedItem = recalculateStats(data.iso2, w, items);
                newHistory.push(mergedItem);
            }

            data.history = newHistory;
            data.weeks_total = newHistory.length;
            data.deduplicated_at = new Date().toISOString();

            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            fixedCountries++;
        }
    }

    console.log(`[DEDUPE] Complete. Fixed ${fixedCountries} countries.`);

    // Refresh Index
    console.log("[INDEX] Refreshing index.json...");
    const indexData = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, 'index.json'), 'utf-8'));
    const newCountries = [];

    // We already have files list
    let minW = null, maxW = null;

    for (const file of files) {
        const c = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, file), 'utf-8'));
        newCountries.push({ iso2: c.iso2, name_en: c.name_en, weeks: c.weeks_total });
        if (c.history.length > 0) {
            const start = c.history[0].week;
            const end = c.history[c.history.length - 1].week;
            if (!minW || start < minW) minW = start;
            if (!maxW || end > maxW) maxW = end;
        }
    }

    indexData.countries = newCountries.sort((a, b) => a.iso2.localeCompare(b.iso2));
    indexData.start_week = minW;
    indexData.end_week = maxW;

    fs.writeFileSync(path.join(HISTORY_DIR, 'index.json'), JSON.stringify(indexData, null, 2));
    console.log("[INDEX] Updated.");
}

main();
