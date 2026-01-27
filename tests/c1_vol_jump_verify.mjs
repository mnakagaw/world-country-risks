/**
 * c1_vol_jump_verify.mjs - Phase C1: Volume Jump Verification
 * 
 * Purpose: Verify Volume Jump logic using live BigQuery data
 * 
 * Goals:
 * 1. Fetch 14 days of history
 * 2. Calculate rolling median
 * 3. Verify US/GB jump < 1.5 (Suppressed)
 * 4. Verify IR/VE behavior
 */

import 'dotenv/config';
import { BigQuery } from '@google-cloud/bigquery';
import path from 'path';
import { fileURLToPath } from 'url';
import { aggregateToIso2 } from '../scripts/fips_to_iso2.js';
import { scoreAllCountries, addDailySnapshot, loadHistoricalData } from '../scripts/scoring.mjs';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.resolve(__dirname, '../credentials/gcp-service-account.json');

const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'countryrisks-prod';

const bigquery = new BigQuery({
    projectId: BQ_PROJECT_ID,
    keyFilename: keyPath
});

// ============ UTILS ============
function dateToInt(dateStr) {
    return parseInt(dateStr.replace(/-/g, '') + '000000');
}

function addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

// ============ FETCH ============
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

    const { data } = aggregateToIso2(rawData);
    return data;
}

// ============ MAIN ============
async function main() {
    const targetDate = process.argv[2] || new Date().toISOString().split('T')[0];
    console.log('='.repeat(60));
    console.log('C1 VERIFICATION: Volume Jump Logic');
    console.log('='.repeat(60));
    console.log(`Target date: ${targetDate}`);

    // Fetch 14 days history (from targetDate - 13 days to targetDate)
    console.log('\nFetching 14 days history...');

    const historyStart = addDays(targetDate, -13);
    const historyDays = [];
    for (let i = 0; i < 14; i++) {
        historyDays.push(addDays(historyStart, i));
    }

    for (const date of historyDays) {
        process.stdout.write(`.`);
        const data = await fetchEventsForDate(date);
        addDailySnapshot(date, data); // Populate scoring engine history
    }
    console.log(' Done.');

    // Fetch Target Date Data (already fetched as last day of history, but let's grab it for scoring input)
    // Actually addDailySnapshot keeps data in memory, so we can just grab it?
    // No, scoreAllCountries needs the input map.
    // fetch again or store it.
    // Let's refetch or cache. Cache is cleaner but lazy refetch is safer.
    const targetData = await fetchEventsForDate(targetDate);

    // Run Scoring
    console.log('\nRunning Scoring...');
    const result = scoreAllCountries(targetData);

    // Output Results
    console.log('\n' + '='.repeat(60));
    console.log('RESULTS');
    console.log('='.repeat(60));

    const us = result.results.US;
    const gb = result.results.GB;
    const ir = result.results.IR;
    const ve = result.results.VE;

    function printCountry(code, r) {
        if (!r) { console.log(`  ${code}: No data`); return; }
        const vj = r.vol_jump_data || {};
        const volSignal = r.signals.find(s => s.type === 'VOL');
        console.log(`  ${code}:`);
        console.log(`    Events: ${r.signals.find(s => s.type === 'VOL')?.value || 'N/A'} (Tone: ${r.tone.toFixed(2)})`);
        console.log(`    Median(14d): ${vj.median}`);
        console.log(`    Jump Ratio: ${vj.jump?.toFixed(2)}`);
        console.log(`    Signals: ${r.signals.map(s => s.type).join(', ')}`);
        console.log(`    Level: ${r.level} (${r.reason})`);
        console.log(`    VOL Bundle: ${volSignal ? 'YES' : 'NO'}`);
    }

    printCountry('US', us);
    printCountry('GB', gb);
    printCountry('IR', ir);
    printCountry('VE', ve);

    console.log('\nTop 5 Jumpers:');
    result.volJumpStats.top10.slice(0, 5).forEach(c => {
        console.log(`  ${c.code}: Jump ${c.jump.toFixed(2)} (Events: ${c.current}, Median: ${c.median})`);
    });

}

main().catch(console.error);
