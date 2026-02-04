import 'dotenv/config';
import { BigQuery } from '@google-cloud/bigquery';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.resolve(__dirname, '../credentials/gcp-service-account.json');
const bigquery = new BigQuery({
    projectId: process.env.BQ_PROJECT_ID || 'countryrisks-prod',
    keyFilename: keyPath
});

async function dryRun(query, label) {
    try {
        const [job] = await bigquery.createQueryJob({ query, location: 'US', dryRun: true });
        const bytes = parseInt(job.metadata.statistics.totalBytesProcessed);
        const gb = (bytes / (1024 ** 3)).toFixed(4);
        console.log(`[${label}] Scanned: ${gb} GB`);
        return bytes;
    } catch (err) {
        console.log(`[${label}] Failed: ${err.message.split('\n')[0]}`);
        return null;
    }
}

async function runBenchmarks() {
    console.log("--- BigQuery Partition Pruning Benchmark ---");

    const baseCols = "ActionGeo_CountryCode, COUNT(*) as cnt";

    // 1. Current Approach (SQLDATE filter on standard table)
    // Note: SQLDATE is an integer YYYYMMDD
    const q1 = `
        SELECT ${baseCols} 
        FROM \`gdelt-bq.gdeltv2.events\` 
        WHERE DATEADDED > 20260201000000 
        AND SQLDATE >= 20260201
        GROUP BY 1 LIMIT 1
    `;
    await dryRun(q1, "Standard Table + SQLDATE");

    // 2. Standard Table + _PARTITIONDATE
    // _PARTITIONDATE is a DATE type
    const q2 = `
        SELECT ${baseCols} 
        FROM \`gdelt-bq.gdeltv2.events\` 
        WHERE _PARTITIONDATE >= DATE('2026-02-01')
        GROUP BY 1 LIMIT 1
    `;
    await dryRun(q2, "Standard Table + _PARTITIONDATE");

    // 3. Partitioned Table (if exists) + SQLDATE
    const q3 = `
        SELECT ${baseCols} 
        FROM \`gdelt-bq.gdeltv2.events_partitioned\` 
        WHERE SQLDATE >= 20260201
        GROUP BY 1 LIMIT 1
    `;
    await dryRun(q3, "Events_Partitioned + SQLDATE");

    // 4. Partitioned Table + _PARTITIONDATE
    const q4 = `
        SELECT ${baseCols} 
        FROM \`gdelt-bq.gdeltv2.events_partitioned\` 
        WHERE _PARTITIONDATE >= DATE('2026-02-01')
        GROUP BY 1 LIMIT 1
    `;
    await dryRun(q4, "Events_Partitioned + _PARTITIONDATE");

    // 5. GKG Partition Check (Bonus)
    const q5 = `
        SELECT iso2, COUNT(*) 
        FROM \`gdelt-bq.gdeltv2.gkg_partitioned\`
        CROSS JOIN UNNEST(SPLIT(V2Locations, ';')) AS location_str
        CROSS JOIN UNNEST([REGEXP_EXTRACT(location_str, r'#([A-Z]{2})#')]) AS iso2
        WHERE _PARTITIONDATE >= DATE('2026-02-01')
        GROUP BY 1 LIMIT 1
    `;
    await dryRun(q5, "GKG_Partitioned + _PARTITIONDATE");
}

runBenchmarks();
