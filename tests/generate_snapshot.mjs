/**
 * generate_snapshot.mjs - Create test fixture from current BigQuery data
 * 
 * Usage: node tests/generate_snapshot.mjs
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BigQuery } from '@google-cloud/bigquery';
import { aggregateToIso2 } from '../scripts/fips_to_iso2.js';
import { scoreAllCountries } from '../scripts/scoring.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.resolve(__dirname, '../credentials/gcp-service-account.json');

const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'countryrisks-prod';

const bigquery = new BigQuery({
    projectId: BQ_PROJECT_ID,
    keyFilename: keyPath
});

async function fetchEventsForDate(date) {
    const dateInt = parseInt(date.replace(/-/g, '') + '000000');
    const nextDateInt = parseInt(
        new Date(new Date(date).getTime() + 86400000).toISOString().split('T')[0].replace(/-/g, '') + '000000'
    );

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

    return aggregateToIso2(rawData);
}

async function main() {
    const date = process.argv[2] || new Date().toISOString().split('T')[0];
    console.log(`Generating snapshot for: ${date}`);

    // Fetch data
    const { data: gdeltData, stats } = await fetchEventsForDate(date);
    console.log(`Fetched ${Object.keys(gdeltData).length} countries`);

    // Run scoring
    const result = scoreAllCountries(gdeltData);

    // Create snapshot
    const snapshot = {
        date,
        generated_at: new Date().toISOString(),
        scoring_version: result.config.version,
        gdelt_data: gdeltData,
        expected: {
            distribution: result.distribution,
            yellowPlus: result.yellowPlusTop.map(c => c.code),
            focus: {
                IR: result.results.IR ? { level: result.results.IR.level, bundles: result.results.IR.bundles } : null,
                VE: result.results.VE ? { level: result.results.VE.level, bundles: result.results.VE.bundles } : null
            }
        }
    };

    // Save
    const outputPath = path.join(__dirname, 'fixtures', `snapshot_${date}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2));
    console.log(`Saved: ${outputPath}`);

    // Summary
    console.log('\nSnapshot Summary:');
    console.log(`  Distribution: Red=${result.distribution.red}, Orange=${result.distribution.orange}, Yellow=${result.distribution.yellow}`);
    console.log(`  Yellow+ Total: ${result.distribution.total_yellow_plus}`);
    console.log(`  IR: ${result.results.IR?.level || 'N/A'}`);
    console.log(`  VE: ${result.results.VE?.level || 'N/A'}`);
}

main().catch(console.error);
