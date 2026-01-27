/**
 * scoring.mjs - v4 Scoring Engine
 * 
 * Unified scoring logic with:
 * - Volume Jump Signal (replacing absolute volume threshold)
 * - R1/R3 Baseline Jump Gate (Optional, suppresses constant orange)
 * - D2 Refined: High Volume (Abs > Threshold) countries MUST pass Jump Gate.
 * 
 * Environment: SCORING_ENGINE=v4|legacy (default: v4)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ CONFIG ============
let config;
try {
    const configPath = path.resolve(__dirname, '../config/scoring.json');
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (e) {
    console.warn('[SCORING] Config load failed, using defaults');
    config = getDefaultConfig();
}

function getDefaultConfig() {
    return {
        version: 'v4.2-default',
        event_count_floor: 100,
        r1_security: { absolute_threshold: 250, ratio_threshold: 0.05, use_jump_gate: false },
        r2_living: { absolute_threshold: 150, ratio_threshold: 0.03, use_jump_gate: false },
        r3_governance: { absolute_threshold: 120, ratio_threshold: 0.035, use_jump_gate: false },
        r4_fiscal: { absolute_threshold: 150, ratio_threshold: 0.03, use_jump_gate: false },
        volume: { threshold: 5000 },
        tone: { bad_threshold: -3, mild_threshold: -1.5 },
        alert_levels: { red_bundles: 3, orange_bundles: 2, yellow_min_bundles: 1, yellow_requires_tone: true },
        high_volume_suppression: { enabled: false },
        vol_jump: {
            enabled: true,
            window_days: 14,
            threshold: 1.5,
            min_history_days: 10,
            min_median_floor: 200
        }
    };
}

// ============ STATISTICS ============
function percentile(arr, p) {
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

function median(arr) {
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ============ HISTORICAL DATA ============
// In-memory cache for rolling calculations
let historicalData = {};

export function loadHistoricalData(data) {
    historicalData = data || {};
}

export function addDailySnapshot(date, countryData) {
    historicalData[date] = countryData;

    // Keep only last 30 days
    const dates = Object.keys(historicalData).sort();
    while (dates.length > 30) {
        delete historicalData[dates.shift()];
    }
}

function getRollingP95(windowDays = 7) {
    const dates = Object.keys(historicalData).sort().slice(-windowDays);
    if (dates.length === 0) return config.high_volume_suppression?.fallback_threshold || 50000;

    const allCounts = [];
    for (const date of dates) {
        for (const country of Object.values(historicalData[date] || {})) {
            if (country.event_count) allCounts.push(country.event_count);
        }
    }

    return allCounts.length > 0 ? percentile(allCounts, 95) : (config.high_volume_suppression?.fallback_threshold || 50000);
}

function getCountryRollingMedian(code, windowDays = 14, metric = 'event_count') {
    const dates = Object.keys(historicalData).sort().slice(-windowDays);
    const counts = [];

    for (const date of dates) {
        const country = historicalData[date]?.[code];
        if (country && typeof country[metric] === 'number') counts.push(country[metric]);
    }

    return {
        median: counts.length > 0 ? median(counts) : 0,
        historyDays: counts.length
    };
}

// ============ BASELINE ADJUSTMENT ============
/**
 * applyBaselineAdjust
 * @param {number} raw - The original score
 * @param {number} weight - Baseline weight (e.g. median_5y)
 * @param {string} mode - "none" | "subtract" | "ratio"
 * @param {number} k - Coefficient
 * @param {number} floor - Scale reference (for ratio) or minimum (for subtract)
 * @param {number} epsilon - Safety floor for division
 */
function applyBaselineAdjust(raw, weight, mode, k = 1.0, floor = 50, epsilon = 1) {
    if (mode === 'none') return { adj: raw, ratio: 1.0 };

    // Use floor as the minimum expected weight to avoid inflating low-volume countries
    // If weight is missing or null, we treat it as 'floor' to avoid ratio explosion.
    const effectiveWeight = Math.max(weight || 0, floor);

    if (mode === 'subtract') {
        const adj = Math.max(floor / 10, raw - (weight * k / 5000)); // Subtract mode is less used now
        return { adj, ratio: raw > 0 ? adj / raw : 1.0 };
    }

    if (mode === 'ratio') {
        // Only dampen hub countries. Never inflate (ratio capped at 1.0).
        const den = Math.max(effectiveWeight * k, epsilon);
        const ratio = Math.min(1.0, floor / den);
        const adj = raw * ratio;
        return { adj, ratio };
    }

    return { adj: raw, ratio: 1.0 };
}

// ============ SCORING ============
export function scoreCountry(countryData, context = {}) {
    const { event_count, avg_tone, r1_security, r2_living_count, r3_governance, r4_fiscal_count, baselineData, domestic_ratio } = countryData;
    const code = countryData.code || context.code;

    // External Pressure Noise Detection (Greenland/etc)
    // If domestic_ratio <= 0.20, suppress R1 and R3 bundles
    const externalPressureNoise = (domestic_ratio ?? 1.0) <= 0.20;

    const r2_raw = r2_living_count || 0;
    const r4_raw = r4_fiscal_count || 0;

    // --- Baseline Adjustment Calculation ---
    const adjCfg = config.baseline_adjustment || { enabled: false, mode: 'none' };
    const weight = baselineData?.gdelt?.GDELTweight || 0;

    // We adjust R1-R4 using rough share of baseline weight
    const adjEvent = applyBaselineAdjust(event_count, weight, adjCfg.mode, adjCfg.k, adjCfg.floor, adjCfg.epsilon || 1);
    const adjR1 = applyBaselineAdjust(r1_security || 0, (weight * 0.05), adjCfg.mode, adjCfg.k, adjCfg.floor * 0.05, adjCfg.epsilon || 1);
    const adjR2 = applyBaselineAdjust(r2_raw, (weight * 0.01), adjCfg.mode, adjCfg.k, adjCfg.floor * 0.01, adjCfg.epsilon || 1);
    const adjR3 = applyBaselineAdjust(r3_governance || 0, (weight * 0.02), adjCfg.mode, adjCfg.k, adjCfg.floor * 0.02, adjCfg.epsilon || 1);
    const adjR4 = applyBaselineAdjust(r4_raw, (weight * 0.03), adjCfg.mode, adjCfg.k, adjCfg.floor * 0.03, adjCfg.epsilon || 1);

    // AUDIT LOG START
    const isTrace = code === 'IR';
    if (isTrace) {
        console.log(`[AUDIT-TRACE] Scoring IR: Events=${event_count}`);
    }
    // AUDIT LOG END

    // Event floor
    if (event_count < config.event_count_floor) {
        return { level: 'green', bundles: 0, score: 0, reason: 'low_volume', signals: [] };
    }

    let bundles = 0;
    let score = 0;
    const signals = [];

    // --- R1 Security Signal ---
    let r1_bundled = false;
    let r1_jump = 0;
    let r1_median = 0;
    let r1_skip_reason = null;

    const r1Config = config.r1_security;
    const r1_ratio = r1_security / event_count;

    // Check Trigger Conditions
    const r1_abs_hit = r1_security > r1Config.absolute_threshold;
    const r1_ratio_hit = r1_ratio > r1Config.ratio_threshold;

    if (r1_abs_hit || r1_ratio_hit) {
        // D2 Refined Logic:
        // If Absolute Threshold is hit (High Volume Risks), we REQUIRE Jump (Gate).
        // Ratio only bypasses Gate if Absolute is NOT hit (Low Volume / Concentrated Risks).

        if (r1Config.use_jump_gate && r1_abs_hit) {
            // Absolute Hit -> Must Jump
            const roll = getCountryRollingMedian(code, 14, 'r1_security');
            r1_median = roll.median;
            if (roll.historyDays < (r1Config.min_history_days || 10)) {
                // Low history -> Fail Safe (Bundle)
                r1_bundled = true;
                r1_skip_reason = 'low_history';
            } else if (r1_median < (r1Config.min_median_floor || 0)) {
                // Low baseline -> Fail Safe (Bundle)
                r1_bundled = true;
                r1_skip_reason = 'low_median';
            } else {
                // Check Jump
                r1_jump = r1_security / (r1_median || 1);
                if (r1_jump >= (r1Config.jump_threshold || 1.3)) {
                    r1_bundled = true;
                } else {
                    // Suppressed by Gate
                    r1_bundled = false;
                    r1_skip_reason = 'gate_suppressed';
                }
            }
        } else if (r1_ratio_hit) {
            // Ratio Hit (and Abs NOT hit, or Gate disabled) -> Pass
            r1_bundled = true;
        } else {
            // Abs Hit (Gate disabled) -> Pass (Legacy)
            r1_bundled = true;
        }
    }

    // External Pressure Suppression: If mostly foreign news, suppress R1
    if (r1_bundled && externalPressureNoise) {
        r1_bundled = false;
        r1_skip_reason = 'external_pressure_suppressed';
    }

    if (r1_bundled) {
        bundles++;
        score += r1_security;
        signals.push({ type: 'R1', value: r1_security, ratio: r1_ratio, jump: r1_jump.toFixed(2), median: r1_median });
    }

    // --- R2 Living Signal (with Jump Gate) ---
    let r2_bundled = false;
    let r2_jump = 0;
    let r2_median = 0;
    let r2_skip_reason = null;
    const r2Config = config.r2_living || { absolute_threshold: 180, ratio_threshold: 0.03, use_jump_gate: true };
    const r2_ratio = r2_raw / event_count;

    const r2_abs_hit = r2_raw > r2Config.absolute_threshold;
    const r2_ratio_hit = r2_ratio > r2Config.ratio_threshold;

    if (r2_abs_hit || r2_ratio_hit) {
        // Hybrid Jump Gate Logic (same as R1/R3)
        const roll = getCountryRollingMedian(code, 14, 'r2_living_count');
        r2_median = roll.median;
        const minHistoryDays = r2Config.min_history_days || 10;
        const absThreshold = r2Config.absolute_threshold || 180;
        const jumpThreshold = r2Config.jump_threshold || 1.5;

        if (roll.historyDays >= minHistoryDays && r2_median >= absThreshold) {
            // Sufficient history and baseline -> use Jump Gate
            r2_jump = r2_raw / (r2_median || 1);
            if (r2_jump >= jumpThreshold) {
                r2_bundled = true;
            } else {
                r2_bundled = false;
                r2_skip_reason = 'gate_suppressed';
            }
        } else if (roll.historyDays < minHistoryDays) {
            // Low history -> fallback to absolute threshold
            r2_bundled = (r2_abs_hit || r2_ratio_hit);
            r2_skip_reason = 'low_history_abs_fallback';
        } else {
            // Low median but enough history -> fallback to absolute
            r2_bundled = (r2_abs_hit || r2_ratio_hit);
            r2_skip_reason = 'low_median_abs_fallback';
        }
    }

    if (r2_bundled) {
        bundles++;
        score += r2_raw;
        signals.push({ type: 'R2', value: r2_raw, ratio: r2_ratio, jump: r2_jump.toFixed(2), median: r2_median });
    }

    // --- R3 Governance Signal ---
    let r3_bundled = false;
    let r3_jump = 0;
    let r3_median = 0;
    let r3_skip_reason = null;

    const r3Config = config.r3_governance;
    const r3_ratio = r3_governance / event_count;

    const r3_abs_hit = r3_governance > r3Config.absolute_threshold;
    const r3_ratio_hit = r3_ratio > r3Config.ratio_threshold;

    if (r3_abs_hit || r3_ratio_hit) {
        if (r3Config.use_jump_gate && r3_abs_hit) {
            const roll = getCountryRollingMedian(code, 14, 'r3_governance');
            r3_median = roll.median;
            if (roll.historyDays < (r3Config.min_history_days || 10)) {
                r3_bundled = true;
                r3_skip_reason = 'low_history';
            } else if (r3_median < (r3Config.min_median_floor || 0)) {
                r3_bundled = true;
                r3_skip_reason = 'low_median';
            } else {
                r3_jump = r3_governance / (r3_median || 1);
                if (r3_jump >= (r3Config.jump_threshold || 1.3)) {
                    r3_bundled = true;
                } else {
                    r3_bundled = false;
                    r3_skip_reason = 'gate_suppressed';
                }
            }
        } else if (r3_ratio_hit) {
            r3_bundled = true;
        } else {
            r3_bundled = true;
        }
    }

    // External Pressure Suppression: If mostly foreign news, suppress R3
    if (r3_bundled && externalPressureNoise) {
        r3_bundled = false;
        r3_skip_reason = 'external_pressure_suppressed';
    }

    if (r3_bundled) {
        bundles++;
        score += r3_governance;
        signals.push({ type: 'R3', value: r3_governance, ratio: r3_ratio, jump: r3_jump.toFixed(2), median: r3_median });
    }

    // --- R4 Fiscal Signal (with Jump Gate) ---
    let r4_bundled = false;
    let r4_jump = 0;
    let r4_median = 0;
    let r4_skip_reason = null;
    const r4Config = config.r4_fiscal || { absolute_threshold: 200, ratio_threshold: 0.03, use_jump_gate: true };
    const r4_ratio = r4_raw / event_count;

    const r4_abs_hit = r4_raw > r4Config.absolute_threshold;
    const r4_ratio_hit = r4_ratio > r4Config.ratio_threshold;

    if (r4_abs_hit || r4_ratio_hit) {
        // Hybrid Jump Gate Logic (same as R2)
        const roll = getCountryRollingMedian(code, 14, 'r4_fiscal_count');
        r4_median = roll.median;
        const minHistoryDays = r4Config.min_history_days || 10;
        const absThreshold = r4Config.absolute_threshold || 200;
        const jumpThreshold = r4Config.jump_threshold || 1.5;

        if (roll.historyDays >= minHistoryDays && r4_median >= absThreshold) {
            // Sufficient history and baseline -> use Jump Gate
            r4_jump = r4_raw / (r4_median || 1);
            if (r4_jump >= jumpThreshold) {
                r4_bundled = true;
            } else {
                r4_bundled = false;
                r4_skip_reason = 'gate_suppressed';
            }
        } else if (roll.historyDays < minHistoryDays) {
            // Low history -> fallback to absolute threshold
            r4_bundled = (r4_abs_hit || r4_ratio_hit);
            r4_skip_reason = 'low_history_abs_fallback';
        } else {
            // Low median but enough history -> fallback to absolute
            r4_bundled = (r4_abs_hit || r4_ratio_hit);
            r4_skip_reason = 'low_median_abs_fallback';
        }
    }

    if (r4_bundled) {
        bundles++;
        score += r4_raw;
        signals.push({ type: 'R4', value: r4_raw, ratio: r4_ratio, jump: r4_jump.toFixed(2), median: r4_median });
    }

    // --- Volume Signal (Jump Logic) ---
    // Replaces absolute threshold
    let vol_signal = false;
    let vol_jump = 0;
    let median14d = 0;
    let vol_skip_reason = null;

    const absVolThreshold = (config.volume?.threshold || 5000);

    if (config.vol_jump?.enabled && code) {
        const vjConfig = config.vol_jump;
        const roll = getCountryRollingMedian(code, vjConfig.window_days, 'event_count');
        median14d = roll.median;
        const historyDays = roll.historyDays;

        if (historyDays < vjConfig.min_history_days) {
            // STARTUP FIX: Fallback to absolute threshold if low history
            // Tuned: K=2 (10000 events) to avoid "noise sticking"
            vol_skip_reason = 'low_history';
            if (event_count >= absVolThreshold * 2) {
                vol_signal = true;
                vol_skip_reason = 'low_history_fallback_abs_k2';
            }
        } else if (median14d < vjConfig.min_median_floor) {
            // Fallback for low median as well
            vol_skip_reason = 'low_median';
            if (event_count >= absVolThreshold * 2) {
                vol_signal = true;
                vol_skip_reason = 'low_median_fallback_abs_k2';
            }
        } else {
            // Calculate Jump
            // volume_today = event_count
            vol_jump = event_count / (median14d || 1);
            if (vol_jump >= vjConfig.threshold) {
                vol_signal = true;
            }
        }
    } else if (!config.vol_jump?.enabled && config.volume?.threshold) {
        // ... (omitted unchanged parts)

        console.log(`[AUDIT-DEEP] Top 10 by Event Count Trace:`);
        const top10Vol = Object.entries(result.results)
            .sort((a, b) => (b[1].event_count || 0) - (a[1].event_count || 0))
            .slice(0, 10);

        top10Vol.forEach(([code, r]) => {
            const s = r.signals?.map(s => s.type).join(',') || 'none';
            const v = r.vol_jump_data || {};
            // Access historyDays via internal method or cached data if not exposed in result
            // Wait, result doesn't expose historyDays directly.
            // I need to patch scoreCountry to expose it or infer it.
            // For minimal diff, I will rely on v.skipped reason or just add exposing logic in scoreCountry if needed.
            // Actually, I can pass it out in vol_jump_data.
        });
        // Wait, I need to modify scoreCountry to return historyDays in vol_jump_data FIRST.

        // Fallback to absolute threshold if Jump disabled
        if (event_count > config.volume.threshold) {
            vol_signal = true;
        }
    }

    if (vol_signal) {
        bundles++;
        score += (event_count / 100); // Add volume contribution to score
        signals.push({ type: 'VOL', value: event_count, jump: vol_jump.toFixed(2), median: median14d });
    }

    // Tone modifier
    const toneModifier = avg_tone < config.tone.bad_threshold ? 1 :
        (avg_tone < config.tone.mild_threshold ? 0.5 : 0);
    score += toneModifier * 100;

    // Alert level determination (Standard Rules)
    let level = 'green';
    let reason = 'no_signals';

    const alertConfig = config.alert_levels;

    if (bundles >= alertConfig.red_bundles) {
        level = 'red';
        reason = `${bundles}b`;
    } else if (bundles >= alertConfig.orange_bundles) {
        level = 'orange';
        reason = `${bundles}b`;
    } else if (bundles >= alertConfig.yellow_min_bundles && toneModifier >= 0.5) {
        level = 'yellow';
        reason = `${bundles}b+tone`;
    }

    // AUDIT LOG START
    if (isTrace || code === 'IR' || code === 'US' || code === 'GB') {
        if (code === 'IR') {
            console.log(`[AUDIT-IR] Scoring Detail for ${code}:`);
            console.log(`  > Events: Total=${event_count}`);
            console.log(`  > R1 (Security): Raw=${r1_security}, Median=${r1_median}, Bundled=${r1_bundled}, Skip=${r1_skip_reason}`);
            console.log(`  > R2 (Living): Raw=${r2_raw}, Bundled=${r2_bundled}`);
            console.log(`  > R3 (Governance): Raw=${r3_governance}, Median=${r3_median}, Bundled=${r3_bundled}, Skip=${r3_skip_reason}`);
            console.log(`  > R4 (Fiscal): Raw=${r4_raw}, Bundled=${r4_bundled}`);
            console.log(`  > Volume: Raw=${event_count}, Median=${median14d}, Jump=${vol_jump}, Bundled=${vol_signal}, Skip=${vol_skip_reason}`);
            console.log(`  > Signals: ${JSON.stringify(signals)}`);
            console.log(`  > Bundles: ${bundles} (Thresholds: Red=${alertConfig.red_bundles}, Orange=${alertConfig.orange_bundles})`);
            console.log(`  > Final Level: ${level}`);
            console.log(`  > Decision Logic: Reason=${reason}`);
        } else if (isTrace) {
            console.log(`[AUDIT-TRACE] ${code} Result: Level=${level}, Bundles=${bundles}`);
        }
    }
    // AUDIT LOG END

    return {
        level,
        bundles,
        score: Math.round(score),
        tone: avg_tone,
        toneModifier,
        signals,
        reason,
        vol_jump_data: {
            jump: vol_jump,
            median: median14d,
            historyDays: code && config.vol_jump?.enabled ? getCountryRollingMedian(code, config.vol_jump.window_days, 'event_count').historyDays : 0,
            skipped: vol_skip_reason
        },
        r1_security: r1_security,
        r1_jump_data: { jump: r1_jump, median: r1_median, skipped: r1_skip_reason },
        r2_living_count: r2_raw,
        r2_jump_data: { jump: r2_jump, median: r2_median, skipped: r2_skip_reason },
        r3_governance: r3_governance,
        r3_jump_data: { jump: r3_jump, median: r3_median, skipped: r3_skip_reason },
        r4_fiscal_count: r4_raw,
        r4_jump_data: { jump: r4_jump, median: r4_median, skipped: r4_skip_reason },
        external_pressure_noise: externalPressureNoise,
        domestic_ratio: domestic_ratio ?? 1.0,


        // Validated Normalized Scores (0-10) for UI/Index - ADJUSTED (surge)
        r_scores_adj: {
            R1: Math.min(10, adjR1.adj * (5.0 / (config.r1_security?.absolute_threshold || 300))).toFixed(1),
            R2: Math.min(10, adjR2.adj * (5.0 / (config.r2_living?.absolute_threshold || 150))).toFixed(1),
            R3: Math.min(10, adjR3.adj * (5.0 / (config.r3_governance?.absolute_threshold || 150))).toFixed(1),
            R4: Math.min(10, adjR4.adj * (5.0 / (config.r4_fiscal?.absolute_threshold || 150))).toFixed(1)
        },

        // RAW Absolute Level Scores (0-10) - for RAW display mode
        // Uses raw counts normalized by absolute_threshold (not baseline-adjusted)
        r_scores_raw: {
            R1: Math.min(10, (r1_security / (config.r1_security?.absolute_threshold || 300)) * 10).toFixed(1),
            R2: Math.min(10, (r2_raw / (config.r2_living?.absolute_threshold || 180)) * 10).toFixed(1),
            R3: Math.min(10, (r3_governance / (config.r3_governance?.absolute_threshold || 150)) * 10).toFixed(1),
            R4: Math.min(10, (r4_raw / (config.r4_fiscal?.absolute_threshold || 200)) * 10).toFixed(1)
        },

        // RAW Absolute with sqrt-scale (prevents saturation for large countries)
        // absScore = clamp(10 * sqrt(rawCount / (abs_threshold * 16)), 0, 10)
        r_scores_raw_abs: {
            R1: Math.min(10, 10 * Math.sqrt(r1_security / ((config.r1_security?.absolute_threshold || 300) * 16))).toFixed(2),
            R2: Math.min(10, 10 * Math.sqrt(r2_raw / ((config.r2_living?.absolute_threshold || 180) * 16))).toFixed(2),
            R3: Math.min(10, 10 * Math.sqrt(r3_governance / ((config.r3_governance?.absolute_threshold || 150) * 16))).toFixed(2),
            R4: Math.min(10, 10 * Math.sqrt(r4_raw / ((config.r4_fiscal?.absolute_threshold || 200) * 16))).toFixed(2)
        },

        // RAW Ratio-based (intensity within country)
        // ratioScore = clamp(10 * (ratio / ratio_threshold), 0, 10)
        r_scores_raw_ratio: {
            R1: Math.min(10, 10 * (r1_ratio / (config.r1_security?.ratio_threshold || 0.05))).toFixed(2),
            R2: Math.min(10, 10 * (r2_ratio / (config.r2_living?.ratio_threshold || 0.03))).toFixed(2),
            R3: Math.min(10, 10 * (r3_ratio / (config.r3_governance?.ratio_threshold || 0.035))).toFixed(2),
            R4: Math.min(10, 10 * (r4_ratio / (config.r4_fiscal?.ratio_threshold || 0.03))).toFixed(2)
        },

        // Raw multipliers for UI/debug
        raw_multipliers: {
            R1_abs_mult: (r1_security / (config.r1_security?.absolute_threshold || 300)).toFixed(2),
            R1_ratio_mult: (r1_ratio / (config.r1_security?.ratio_threshold || 0.05)).toFixed(2),
            R2_abs_mult: (r2_raw / (config.r2_living?.absolute_threshold || 180)).toFixed(2),
            R2_ratio_mult: (r2_ratio / (config.r2_living?.ratio_threshold || 0.03)).toFixed(2),
            R3_abs_mult: (r3_governance / (config.r3_governance?.absolute_threshold || 150)).toFixed(2),
            R3_ratio_mult: (r3_ratio / (config.r3_governance?.ratio_threshold || 0.035)).toFixed(2),
            R4_abs_mult: (r4_raw / (config.r4_fiscal?.absolute_threshold || 200)).toFixed(2),
            R4_ratio_mult: (r4_ratio / (config.r4_fiscal?.ratio_threshold || 0.03)).toFixed(2)
        },

        // Baseline & Adjusted values for display/debug
        adj_values: {
            event_count: adjEvent.adj,
            r1: adjR1.adj,
            r2: adjR2.adj,
            r3: adjR3.adj,
            r4: adjR4.adj
        },
        debug: {
            baseline_weight: weight,
            mode: adjCfg.mode,
            k: adjCfg.k,
            floor: adjCfg.floor,
            epsilon: adjCfg.epsilon,
            ratios: {
                event: adjEvent.ratio.toFixed(2),
                r1: adjR1.ratio.toFixed(2),
                r3: adjR3.ratio.toFixed(2),
                r4: adjR4.ratio.toFixed(2)
            }
        }
    };
}

// ============ BATCH SCORING ============
export function scoreAllCountries(countryDataMap, options = {}) {
    const results = {};
    const distribution = { red: [], orange: [], yellow: [], green: 0, skipped: 0 };
    const volJumpCountries = [];
    const volJumpSkipped = [];

    for (const [code, data] of Object.entries(countryDataMap)) {
        const baselineData = options.baselines?.[code] || null;
        const result = scoreCountry({ ...data, code, baselineData });
        result.event_count = data.event_count; // Pass-through for logging
        results[code] = result;

        if (result.level === 'red') distribution.red.push(code);
        else if (result.level === 'orange') distribution.orange.push(code);
        else if (result.level === 'yellow') distribution.yellow.push(code);
        else if (result.reason === 'low_volume') distribution.skipped++;
        else distribution.green++;

        // Track stats
        const vj = result.vol_jump_data;
        if (vj && !vj.skipped && vj.jump > 0) {
            volJumpCountries.push({ code, jump: vj.jump, median: vj.median, current: data.event_count });
        }
        if (vj && vj.skipped) {
            volJumpSkipped.push({ code, reason: vj.skipped });
        }
    }

    // Rank by score
    const yellowPlus = [...distribution.red, ...distribution.orange, ...distribution.yellow];
    const ranked = yellowPlus
        .map(code => ({ code, ...results[code] }))
        .sort((a, b) => b.score - a.score);

    ranked.forEach((item, idx) => {
        results[item.code].rank = idx + 1;
    });

    // Bundle breakdown
    const bundleBreakdown = { r1: 0, r3: 0, vol: 0 };
    for (const code of yellowPlus) {
        for (const signal of results[code].signals || []) {
            if (signal.type === 'R1') bundleBreakdown.r1++;
            if (signal.type === 'R2') bundleBreakdown.r2++;
            if (signal.type === 'R3') bundleBreakdown.r3++;
            if (signal.type === 'R4') bundleBreakdown.r4++;
            if (signal.type === 'VOL') bundleBreakdown.vol++;
        }
    }

    // Tone-driven Yellow count
    const toneDrivenYellow = distribution.yellow.filter(code =>
        results[code].bundles === 1 && results[code].reason.includes('tone')
    ).length;

    return {
        results,
        distribution: {
            red: distribution.red.length,
            orange: distribution.orange.length,
            yellow: distribution.yellow.length,
            green: distribution.green,
            skipped: distribution.skipped,
            total_yellow_plus: yellowPlus.length
        },
        yellowPlusTop: ranked.slice(0, 20),
        bundleBreakdown,
        toneDrivenYellow,
        toneDrivenYellowPct: distribution.yellow.length > 0
            ? Math.round((toneDrivenYellow / distribution.yellow.length) * 100)
            : 0,
        volJumpStats: {
            top10: volJumpCountries.sort((a, b) => b.jump - a.jump).slice(0, 10),
            skippedCount: volJumpSkipped.length,
            us_gb: ['US', 'GB'].map(c => ({ code: c, ...results[c]?.vol_jump_data, current: results[c]?.signals?.find(s => s.type === 'VOL')?.value }))
        },
        config: {
            version: config.version,
            vol_jump_threshold: config.vol_jump?.threshold
        }
    };
}

// ============ LOGGING ============
export function logScoringResult(result, date = new Date().toISOString().split('T')[0]) {
    console.log(`\n[SCORING] ${date} (${config.version})`);
    console.log(`  Distribution: Red=${result.distribution.red}, Orange=${result.distribution.orange}, Yellow=${result.distribution.yellow}, Green=${result.distribution.green}`);
    console.log(`  Yellow+ Total: ${result.distribution.total_yellow_plus}`);

    // AUDIT LOG START - Deep Dive
    const total = Object.keys(result.results).length;
    const floorDrop = result.distribution.skipped;
    // Calculate bundle0 (Passed floor but had 0 bundles)
    const passedFloor = Object.values(result.results).filter(r => r.reason !== 'low_volume');
    const bundle0 = passedFloor.filter(r => r.bundles === 0).length;
    // Vol low history count
    const volLowHist = Object.values(result.results).filter(r => r.vol_jump_data?.skipped === 'low_history').length;

    console.log(`[AUDIT-DEEP] Stats: Total=${total}, FloorDrop=${floorDrop}, Bundle0=${bundle0}, VolLowHistory=${volLowHist}`);

    console.log(`[AUDIT-DEEP] Top 10 by Event Count Trace:`);
    const top10Vol = Object.entries(result.results)
        .sort((a, b) => (b[1].event_count || 0) - (a[1].event_count || 0))
        .slice(0, 10);

    top10Vol.forEach(([code, r]) => {
        const s = r.signals?.map(s => s.type).join(',') || 'none';
        const v = r.vol_jump_data || {};
        const vStatus = v.skipped ? `Skip(${v.skipped})` : `Jump=${v.jump?.toFixed(2)}`;
        console.log(`  > ${code}: Evt=${r.event_count}, Lvl=${r.level}, B=${r.bundles}(${s}), VOL[En:${!!config.vol_jump?.enabled}, ${vStatus}, Med=${v.median}, Hist=${v.historyDays}]`);
    });
    // AUDIT LOG END

}

export function getHistoricalData() {
    return historicalData;
}

// ============ EXPORTS ============
export { config };
export default {
    scoreCountry,
    scoreAllCountries,
    loadHistoricalData,
    getHistoricalData,
    addDailySnapshot,
    logScoringResult,
    config
};
