/**
 * eval_backfill.mjs - Historical Evaluation Script (v4 Integrated)
 * Phase D1: Weekly Logic Alignment
 * Phase D2 Refined: R1/R3 Jump Tracking
 * 
 * Logic:
 * 1. continuous daily scoring series (with warmup) for the entire target period.
 * 2. Weekly results are AGGREGATED from daily results (Max Level), not re-scored.
 * 3. Daily results for detailed charts are extracted from the same series.
 * 
 * Outputs:
 * - eval_weekly.json (Aggregated)
 * - eval_daily_ir.json
 * - eval_daily_ve.json
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { BigQuery } from '@google-cloud/bigquery';
import { aggregateToIso2 } from './fips_to_iso2.js';
import { scoreAllCountries, addDailySnapshot, config as scoringConfig } from './scoring.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.resolve(__dirname, '../credentials/gcp-service-account.json');
const OUTPUT_DIR = path.resolve(__dirname, '../public/data/eval');

const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'countryrisks-prod';

const bigquery = new BigQuery({
    projectId: BQ_PROJECT_ID,
    keyFilename: keyPath
});

// ============ CONFIG ============
const ANCHORS = {
    IR: { code: 'IR', date: '2025-12-28', name: 'Iran' },
    VE: { code: 'VE', date: '2026-01-03', name: 'Venezuela' }
};

const FOCUS_COUNTRIES = ['IR', 'VE'];

// ============ METRICS ============
let totalCost = { events: 0, gkg: 0 };

// ============ DATE HELPERS ============
function getWeekStart(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

function addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

function addWeeks(dateStr, weeks) {
    return addDays(dateStr, weeks * 7);
}

function dateToInt(dateStr) {
    return parseInt(dateStr.replace(/-/g, '') + '000000');
}

function getLevelValue(level) {
    switch (level) {
        case 'red': return 3;
        case 'orange': return 2;
        case 'yellow': return 1;
        default: return 0; // green/no_data
    }
}

function getValueLevel(val) {
    if (val >= 3) return 'red';
    if (val >= 2) return 'orange';
    if (val >= 1) return 'yellow';
    return 'green';
}

// ============ BIGQUERY ============
async function fetchEventsForDateRange(startDate, endDate) {
    const startInt = dateToInt(startDate);
    const endInt = dateToInt(addDays(endDate, 1)); // Inclusive

    const query = `
        SELECT 
            ActionGeo_CountryCode AS iso2,
            COUNT(*) AS event_count,
            AVG(AvgTone) AS avg_tone,
            COUNTIF(EventRootCode IN ('18','19','20')) AS r1_security,
            COUNTIF(EventRootCode = '14') AS r3_governance
        FROM \`gdelt-bq.gdeltv2.events\`
        WHERE DATEADDED >= ${startInt} AND DATEADDED < ${endInt}
        AND ActionGeo_CountryCode IS NOT NULL
        GROUP BY iso2
        HAVING event_count > 5
        ORDER BY event_count DESC
    `;

    const [job] = await bigquery.createQueryJob({ query, location: 'US' });
    const [rows] = await job.getQueryResults();

    const [metadata] = await job.getMetadata();
    const bytes = parseInt(metadata.statistics?.totalBytesProcessed || 0);
    const cost = bytes / (1024 ** 4) * 5;
    totalCost.events += cost;

    const rawData = {};
    rows.forEach(row => {
        if (row.iso2 && row.iso2.length === 2) {
            rawData[row.iso2] = {
                event_count: row.event_count,
                avg_tone: row.avg_tone,
                r1_security: row.r1_security,
                r3_governance: row.r3_governance
            };
        }
    });

    const { data } = aggregateToIso2(rawData);
    return { data };
}

// ============ CORE: CONTINUOUS DAILY SERIES ============
/**
 * Generates a continuous series of daily scoring results.
 * Handles warmup automatically.
 */
async function generateDailySeries(start, end) {
    console.log(`\nGenerating Daily Series: ${start} to ${end}`);
    const results = [];

    // Warmup: 14 days before start
    const warmupStart = addDays(start, -14);
    console.log(`  Warmup: ${warmupStart} to ${addDays(start, -1)}`);

    let currentDate = warmupStart;
    while (currentDate <= end) {
        // console.log(`  Processing ${currentDate}...`);
        if (currentDate === start) console.log(`  > Starting Target Period (${start})...`);

        const { data } = await fetchEventsForDateRange(currentDate, currentDate); // Daily fetch
        addDailySnapshot(currentDate, data);

        // Only store results if within target range
        if (currentDate >= start) {
            const scoreResult = scoreAllCountries(data);
            results.push({
                date: currentDate,
                scores: scoreResult,
                data: data // Store raw data for event counts
            });
            process.stdout.write('.');
        } else {
            process.stdout.write('w'); // w for warmup
        }

        currentDate = addDays(currentDate, 1);
    }
    console.log('\n  Series generation complete.');
    return results;
}

// ============ AGGREGATORS ============

/**
 * Aggregates daily results into a Weekly Analysis object.
 * Logic: Max Level dominance.
 */
function aggregateWeekly(dailySeries, anchorKey, anchorDate, weekOffset) {
    const anchorWeekStart = getWeekStart(anchorDate);
    const weekStart = addWeeks(anchorWeekStart, weekOffset);
    const weekEnd = addDays(weekStart, 6);

    // Filter days in this week
    const weekDays = dailySeries.filter(d => d.date >= weekStart && d.date <= weekEnd);

    if (weekDays.length === 0) return null; // Should not happen if range covers it

    // Aggregate Country Data
    const countryStats = {}; // code -> { maxLevelVal, maxScore, daysYellowPlus, topSignals }
    const yellowPlusSet = new Set();

    weekDays.forEach(day => {
        Object.entries(day.scores.results).forEach(([code, r]) => {
            if (!countryStats[code]) {
                countryStats[code] = {
                    maxLevelVal: 0,
                    maxScore: 0,
                    daysYellowPlus: 0,
                    signals: new Set(),
                    totalEvents: 0,
                    maxJump: 0,
                    maxR1Jump: 0,
                    maxR3Jump: 0
                };
            }
            const s = countryStats[code];
            const lvlVal = getLevelValue(r.level);

            if (lvlVal > s.maxLevelVal) s.maxLevelVal = lvlVal;
            if (r.score > s.maxScore) s.maxScore = r.score;
            if (lvlVal >= 1) s.daysYellowPlus++;

            r.signals.forEach(sig => {
                s.signals.add(sig.type);
                if (sig.type === 'VOL' && parseFloat(sig.jump) > s.maxJump) s.maxJump = parseFloat(sig.jump);
                if (sig.type === 'R1' && parseFloat(sig.jump) > s.maxR1Jump) s.maxR1Jump = parseFloat(sig.jump);
                if (sig.type === 'R3' && parseFloat(sig.jump) > s.maxR3Jump) s.maxR3Jump = parseFloat(sig.jump);
            });
            // Fallback for VOL if not signaled but tracked
            if (r.vol_jump_data && r.vol_jump_data.jump > s.maxJump) s.maxJump = parseFloat(r.vol_jump_data.jump);

            s.totalEvents += (day.data[code]?.event_count || 0);

            if (lvlVal >= 1) yellowPlusSet.add(code);
        });
    });

    // Build Distribution stats based on WEEKLY MAX level
    const dist = { red: 0, orange: 0, yellow: 0, green: 0, total_yellow_plus: 0 };
    Object.values(countryStats).forEach(s => {
        const lvl = getValueLevel(s.maxLevelVal);
        dist[lvl]++;
        if (s.maxLevelVal >= 1) dist.total_yellow_plus++; // Should match yellowPlusSet.size
    });

    // Format Focus Countries
    const focus = {};
    FOCUS_COUNTRIES.forEach(code => {
        const s = countryStats[code];
        if (s) {
            focus[code] = {
                level: getValueLevel(s.maxLevelVal),
                score: s.maxScore,
                event_count: s.totalEvents, // Weekly Sum
                signals: Array.from(s.signals).join(','),
                days_yellow_plus: s.daysYellowPlus,
                max_vol_jump: s.maxJump.toFixed(2),
                max_r1_jump: s.maxR1Jump.toFixed(2)
            };
        } else {
            focus[code] = { level: 'no_data' };
        }
    });

    // Top Yellow+ (Ranked by Max Score)
    const yellowPlusTop = Array.from(yellowPlusSet).map(code => ({
        code,
        level: getValueLevel(countryStats[code].maxLevelVal),
        score: countryStats[code].maxScore,
        days_yellow: countryStats[code].daysYellowPlus,
        signals: Array.from(countryStats[code].signals).join(','),
        max_vol_jump: countryStats[code].maxJump.toFixed(2),
        max_r1_jump: countryStats[code].maxR1Jump.toFixed(2),
        max_r3_jump: countryStats[code].maxR3Jump.toFixed(2)
    })).sort((a, b) => b.score - a.score).slice(0, 20);

    return {
        anchor: anchorKey,
        anchor_date: anchorDate,
        week_offset: weekOffset,
        week_start: weekStart,
        week_end: weekEnd,
        period: `${anchorKey}_week_${weekOffset}`,
        distribution: dist,
        focus,
        yellow_plus_top: yellowPlusTop
    };
}

// ============ MAIN ============
async function main() {
    console.log('='.repeat(60));
    console.log('HISTORICAL EVALUATION: D1 Weekly Alignment');
    console.log('='.repeat(60));

    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    // 1. Determine Global Date Range
    // IR: Dec 28. -3 weeks = Dec 7. +3 weeks = Jan 18.
    // VE: Jan 03. +3 weeks = Jan 24.
    // Safe range: 2025-12-01 to 2026-01-31
    const start = '2025-12-01';
    const end = '2026-01-31'; // Future dates ok? GDELT allows.

    // 2. Continuous Daily Series
    const dailySeries = await generateDailySeries(start, end);

    // 3. Generate Weekly Reports (Aggregation)
    console.log('\nAggregating Weekly Results...');
    const weeklyResults = [];

    for (const [key, anchor] of Object.entries(ANCHORS)) {
        for (let offset = -3; offset <= 3; offset++) {
            const result = aggregateWeekly(dailySeries, key, anchor.date, offset);
            if (result) {
                weeklyResults.push(result);
                console.log(`  ${result.period}: ${result.focus[key]?.level}`);
            }
        }
    }

    // 4. Extract Daily Reports (Slicing)
    console.log('\nExtracting Daily Reports...');

    function extractDaily(code, start, end) {
        return dailySeries
            .filter(d => d.date >= start && d.date <= end)
            .map(d => {
                const r = d.scores.results[code];
                return {
                    date: d.date,
                    focus: {
                        [code]: {
                            level: r?.level || 'no_data',
                            score: r?.score || 0,
                            signals: r?.signals?.map(s => s.type).join(','),
                            jumps: {
                                vol: r?.vol_jump_data?.jump?.toFixed(2),
                                r1: r?.r1_jump_data?.jump?.toFixed(2),
                                r3: r?.r3_jump_data?.jump?.toFixed(2)
                            }
                        }
                    },
                    // Minimal structure for summary helper
                };
            });
    }

    const dailyIR = extractDaily('IR', '2025-12-21', '2026-01-04');
    const dailyVE = extractDaily('VE', '2025-12-27', '2026-01-10');

    // 5. Generate Summary
    // Helper function reused/adapted from before
    const summary = {
        IR: {}, VE: {}, volume_check: {}
    };

    // Check Daily Alert First Occurrence
    ['IR', 'VE'].forEach(code => {
        const days = code === 'IR' ? dailyIR : dailyVE;
        const target = summary[code];
        target.first_yellow = days.find(d => {
            const l = d.focus[code].level;
            return l === 'yellow' || l === 'orange' || l === 'red';
        })?.date;

        // Lead time
        const anchor = new Date(ANCHORS[code].date);
        if (target.first_yellow) {
            const f = new Date(target.first_yellow);
            target.lead_time = Math.round((anchor - f) / (1000 * 3600 * 24));
        }
    });

    // Check Volume (US/GB) based on WEEKLY Results

    const usWeeks = weeklyResults.filter(w => w.yellow_plus_top.some(c => c.code === 'US')).length;
    const gbWeeks = weeklyResults.filter(w => w.yellow_plus_top.some(c => c.code === 'GB')).length;

    summary.volume_check = {
        us_weeks_yellow: usWeeks,
        gb_weeks_yellow: gbWeeks,
        total_weeks: weeklyResults.length
    };

    // 6. Output Files
    const costData = {
        events_usd: parseFloat(totalCost.events.toFixed(4)),
        total_usd: parseFloat(totalCost.events.toFixed(4))
    };

    await fs.writeFile(path.join(OUTPUT_DIR, 'eval_weekly.json'), JSON.stringify({
        generated_at: new Date().toISOString(),
        cost: costData,
        results: weeklyResults,
        summary
    }, null, 2));

    await fs.writeFile(path.join(OUTPUT_DIR, 'eval_daily_ir.json'), JSON.stringify({
        generated_at: new Date().toISOString(),
        results: dailyIR
    }, null, 2));

    await fs.writeFile(path.join(OUTPUT_DIR, 'eval_daily_ve.json'), JSON.stringify({
        generated_at: new Date().toISOString(),
        results: dailyVE
    }, null, 2));

    console.log('\nDONE.');
    console.log(`US Yellow+ Weeks: ${usWeeks}/${weeklyResults.length}`);
    console.log(`GB Yellow+ Weeks: ${gbWeeks}/${weeklyResults.length}`);
    console.log(`IR Lead Time: ${summary.IR.lead_time} days`);
    console.log(`VE Lead Time: ${summary.VE.lead_time} days`);
}

main().catch(console.error);
