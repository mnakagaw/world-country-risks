/**
 * c0_diagnostic.mjs - Phase C0: High-Volume Classification Diagnostic
 * 
 * Purpose: Visualize P95 and high_volume classification BEFORE implementing suppression
 * 
 * Output:
 * - p95_7d value
 * - high_volume countries (top 10 with event_count)
 * - Verify: US/GB in high_volume, IR/VE NOT in high_volume
 */

import 'dotenv/config';
import { BigQuery } from '@google-cloud/bigquery';
import path from 'path';
import { fileURLToPath } from 'url';
import { aggregateToIso2, logConversionStats } from '../scripts/fips_to_iso2.js';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.resolve(__dirname, '../credentials/gcp-service-account.json');

// Load config
const configPath = path.resolve(__dirname, '../config/scoring.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'countryrisks-prod';

const bigquery = new BigQuery({
    projectId: BQ_PROJECT_ID,
    keyFilename: keyPath
});

// ============ HELPERS ============
function percentile(arr, p) {
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

function dateToInt(dateStr) {
    return parseInt(dateStr.replace(/-/g, '') + '000000');
}

function addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

// ============ FETCH DATA ============
async function fetchEventsForDate(date) {
    const dateInt = dateToInt(date);
    const nextDateInt = dateToInt(addDays(date, 1));

    const query = `
        SELECT 
            ActionGeo_CountryCode AS iso2,
            COUNT(*) AS event_count,
            AVG(AvgTone) AS avg_tone,
            COUNTIF(EventRootCode IN ('18','19','20')) AS r1_security,
            COUNTIF(EventRootCode = '14') AS r3_governance
        FROM \`gdelt-bq.gdeltv2.events\`
        WHERE DATEADDED >= ${dateInt} AND DATEADDED < ${nextDateInt}
        AND ActionGeo_CountryCode IS NOT NULL
        GROUP BY iso2
        HAVING event_count > 5
        ORDER BY event_count DESC
    `;

    const [job] = await bigquery.createQueryJob({ query, location: 'US' });
    const [rows] = await job.getQueryResults();

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

    const { data, stats } = aggregateToIso2(rawData);
    return { data, stats };
}

// ============ MAIN ============
async function main() {
    const targetDate = process.argv[2] || new Date().toISOString().split('T')[0];
    const hvConfig = config.high_volume_suppression;

    console.log('='.repeat(60));
    console.log('C0 DIAGNOSTIC: High-Volume Classification');
    console.log('='.repeat(60));
    console.log(`Target date: ${targetDate}`);
    console.log(`P95 method: ${hvConfig.method}`);
    console.log(`P95 window: ${hvConfig.p95_window_days} days`);
    console.log(`P95 multiplier: ${hvConfig.p95_multiplier}`);
    console.log(`Fallback threshold: ${hvConfig.fallback_threshold}`);
    console.log();

    // Fetch data for 7 days (for rolling P95)
    console.log('Fetching 7 days of data for rolling P95...\n');
    const allCounts = [];
    const dailyData = {};

    for (let i = 6; i >= 0; i--) {
        const date = addDays(targetDate, -i);
        console.log(`  Fetching: ${date}`);
        const { data } = await fetchEventsForDate(date);
        dailyData[date] = data;

        for (const country of Object.values(data)) {
            if (country.event_count) allCounts.push(country.event_count);
        }
    }

    // Calculate P95
    const p95_7d = percentile(allCounts, 95);
    const threshold = p95_7d * hvConfig.p95_multiplier;

    console.log('\n' + '='.repeat(60));
    console.log('P95 CALCULATION');
    console.log('='.repeat(60));
    console.log(`Total data points: ${allCounts.length}`);
    console.log(`P95 (7-day): ${p95_7d.toLocaleString()}`);
    console.log(`Threshold (P95 × ${hvConfig.p95_multiplier}): ${threshold.toLocaleString()}`);

    // Get latest day data
    const latestData = dailyData[targetDate];

    // Classify high-volume countries
    const highVolumeCountries = Object.entries(latestData)
        .filter(([_, d]) => d.event_count > threshold)
        .sort((a, b) => b[1].event_count - a[1].event_count);

    console.log('\n' + '='.repeat(60));
    console.log(`HIGH-VOLUME COUNTRIES (event_count > ${threshold.toLocaleString()})`);
    console.log('='.repeat(60));
    console.log(`Total high-volume: ${highVolumeCountries.length}\n`);

    console.log('Top 10:');
    console.log('-'.repeat(40));
    highVolumeCountries.slice(0, 10).forEach(([code, data], idx) => {
        console.log(`  ${idx + 1}. ${code}: ${data.event_count.toLocaleString()} events (tone: ${data.avg_tone.toFixed(2)})`);
    });

    // Full list
    console.log('\nAll high-volume (ISO2):');
    console.log('  ' + highVolumeCountries.map(([c, _]) => c).join(', '));

    // Verification
    console.log('\n' + '='.repeat(60));
    console.log('VERIFICATION');
    console.log('='.repeat(60));

    const hvSet = new Set(highVolumeCountries.map(([c, _]) => c));
    const checks = [
        { code: 'US', expected: true, label: 'US is high-volume' },
        { code: 'GB', expected: true, label: 'GB is high-volume' },
        { code: 'IR', expected: false, label: 'IR is NOT high-volume' },
        { code: 'VE', expected: false, label: 'VE is NOT high-volume' }
    ];

    let allPass = true;
    for (const check of checks) {
        const actual = hvSet.has(check.code);
        const pass = actual === check.expected;
        const icon = pass ? '✅' : '❌';
        const evtCount = latestData[check.code]?.event_count || 0;
        console.log(`  ${icon} ${check.label}: ${actual} (events: ${evtCount.toLocaleString()})`);
        if (!pass) allPass = false;
    }

    // Control group check
    console.log('\nControl group (should NOT be high-volume):');
    const controlGroup = ['MX', 'PK', 'BD', 'NG'];
    for (const code of controlGroup) {
        const isHV = hvSet.has(code);
        const evtCount = latestData[code]?.event_count || 0;
        const icon = isHV ? '⚠️' : '✅';
        console.log(`  ${icon} ${code}: ${isHV ? 'high-volume' : 'normal'} (events: ${evtCount.toLocaleString()})`);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`RESULT: ${allPass ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`);
    console.log('='.repeat(60));

    // Recommendation
    if (!allPass) {
        console.log('\n⚠️ Threshold may need adjustment:');
        if (hvSet.has('IR')) console.log(`  - IR (${latestData.IR?.event_count}) above threshold - consider raising P95 multiplier`);
        if (hvSet.has('VE')) console.log(`  - VE (${latestData.VE?.event_count}) above threshold - consider raising P95 multiplier`);
        if (!hvSet.has('US')) console.log(`  - US (${latestData.US?.event_count}) below threshold - consider lowering P95 multiplier`);
        if (!hvSet.has('GB')) console.log(`  - GB (${latestData.GB?.event_count}) below threshold - consider lowering P95 multiplier`);
    }
}

main().catch(console.error);
