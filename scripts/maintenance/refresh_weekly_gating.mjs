
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.resolve(__dirname, '../../public/data');
const WEEKLY_DIR = path.resolve(DATA_DIR, 'weekly/countries');
const SCORING_PATH = path.resolve(__dirname, '../../config/scoring.json');

// Load Scoring Config
const scoringConfig = JSON.parse(fs.readFileSync(SCORING_PATH, 'utf-8'));
const rTypeConfigs = {
    R1: scoringConfig.r1_security,
    R2: scoringConfig.r2_living,
    R3: scoringConfig.r3_governance,
    R4: scoringConfig.r4_fiscal
};

// Thresholds
const THRESHOLDS = scoringConfig.surge_r?.thresholds || { yellow: 1.75, orange: 2.75, red: 3.75 };
const highVolFloor = scoringConfig.surge_r?.high_volume_floor || 5000;

function reevaluateGating(h) {
    const eventCount7 = h.event_count || 0;
    const isHighVolCountry = eventCount7 >= highVolFloor;

    // Tiered Baseline logic
    let dynamicMinBaseline = scoringConfig.surge_r?.min_baseline_median_for_surge || 3;
    if (eventCount7 < 500) dynamicMinBaseline = 1.0;
    else if (eventCount7 < 2000) dynamicMinBaseline = 1.5;

    ['R1', 'R2', 'R3', 'R4'].forEach(r => {
        if (!h.weekly_surge_r_by_type[r]) return;

        const sr = h.weekly_surge_r_by_type[r];
        const ratio7 = sr.ratio7;
        const baseline7 = sr.baseline7;
        const baselineDaily = baseline7 / 7;
        const today7 = sr.today7;
        const share7 = sr.share7;

        // Dynamic Abs Threshold
        const rGating = scoringConfig.gating?.low_abs || {};
        const absFloor = rGating.floors?.[r] || 0;
        const absShare = rGating.shares?.[r] || 0;
        const dynamicAbsThreshold = Math.max(absFloor, Math.ceil(eventCount7 * absShare));

        // Re-evaluate hits
        const absHit = today7 >= dynamicAbsThreshold;
        const rConf = rTypeConfigs[r];
        const ratioThreshold = rConf?.ratio_threshold || 0;
        const shareHit = share7 >= ratioThreshold;

        // Red override
        const redOverride = ratio7 >= THRESHOLDS.red;

        // Triggered
        let triggered = shareHit || (absHit && !isHighVolCountry);
        if (redOverride) triggered = true;

        // Stability
        const isStable = baselineDaily >= dynamicMinBaseline;

        // Active
        const MIN_ACTIVE_RATIO = THRESHOLDS.yellow; // 1.75
        const isActive = triggered && isStable && (ratio7 >= MIN_ACTIVE_RATIO);

        // Update SR fields
        sr.abs_hit = absHit;
        sr.triggered = triggered;
        sr.is_stable = isStable;
        sr.is_active = isActive;

        // Reason update
        let reason = 'active';
        if (isActive) {
            reason = 'active';
        } else {
            if (!triggered) {
                if (absHit && isHighVolCountry && !shareHit) reason = 'high-vol';
                else if (absHit && !shareHit) reason = 'low-share';
                else if (!absHit) reason = 'low-abs';
                else reason = 'below-threshold';
            } else if (!isStable) {
                reason = 'low-baseline';
            } else {
                reason = 'below-threshold';
            }
        }
        sr.reason = reason;

        // Update Level (Visual)
        // If not active, do we clear the level? 
        // In the original logic, 'levels' dict stores the RAW level (Red/Orange/Yellow) based on ratio.
        // It is NOT cleared by gating in the JSON, but the UI uses is_active to gate it.
        // So we leave h.levels as is (Raw).
    });

    // We should also update the top-level bundle/weekly_surge_r if we want consistency, 
    // but CountryDetailView mostly uses weekly_surge_r_by_type for the grid.
    // The "Bundle" row uses max_ratio_active.
    updateBundleRow(h);
}

function updateBundleRow(h) {
    if (!h.weekly_surge_r) return;

    const activeRatios = [];
    const activeTypes = [];

    ['R1', 'R2', 'R3', 'R4'].forEach(r => {
        const sr = h.weekly_surge_r_by_type?.[r];
        if (sr && sr.is_active) {
            activeRatios.push(sr.ratio7);
            activeTypes.push(r);
        }
    });

    const maxActive = activeRatios.length > 0 ? Math.max(...activeRatios) : 0;
    h.weekly_surge_r.max_ratio_active = parseFloat(maxActive.toFixed(3));
    h.weekly_surge_r.active_types = activeTypes;

    // Also update `level` field in weekly_surge_r roughly? 
    // The UI uses max_ratio_active to determine color for bundle.
}

// Main
console.log("Refreshing weekly gating...");
const files = fs.readdirSync(WEEKLY_DIR).filter(f => f.endsWith('.json'));
let updatedCount = 0;

for (const f of files) {
    const p = path.join(WEEKLY_DIR, f);
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));

    if (data.history) {
        data.history.forEach(h => reevaluateGating(h));
        fs.writeFileSync(p, JSON.stringify(data, null, 2));
        updatedCount++;
    }
}

console.log(`Updated ${updatedCount} files.`);
