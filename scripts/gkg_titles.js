/**
 * GKG Titles Fetch - BigQuery GDELT GKG
 * Phase A Cost Optimization:
 * - 24h window (was 48h)
 * - Media Basket Domain Filter (35 domains)
 * - Dry Run Cost Guard (< 50GB)
 */

import 'dotenv/config';
import { BigQuery } from '@google-cloud/bigquery';
import path from 'path';
import { fileURLToPath } from 'url';
import { fipsToIso2, iso2ToFips } from './fips_to_iso2.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.resolve(__dirname, '../credentials/gcp-service-account.json');

const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'countryrisks-prod';

const bigquery = new BigQuery({
    projectId: BQ_PROJECT_ID,
    keyFilename: keyPath
});

// Media Basket (Top 35 Global News Domains)
const MEDIA_BASKET = [
    'reuters.com', 'apnews.com', 'bloomberg.com', 'bbc.com', 'cnn.com',
    'nytimes.com', 'washingtonpost.com', 'wsj.com', 'ft.com', 'cnbc.com',
    'theguardian.com', 'france24.com', 'dw.com', 'aljazeera.com', 'rt.com',
    'sputniknews.com', 'xinhuanet.com', 'scmp.com', 'japantimes.co.jp',
    'kyodonews.net', 'yonhapnews.co.kr', 'straitstimes.com', 'indiatimes.com',
    'abc.net.au', 'cbc.ca', 'thetimes.co.uk', 'telegraph.co.uk', 'independent.co.uk',
    'usatoday.com', 'latimes.com', 'npr.org', 'pbs.org', 'foxnews.com',
    'nbcnews.com', 'cbsnews.com'
];

/**
 * Fetch top news titles from GKG for given countries
 * @param {string[]} countryCodes - ISO2 country codes to fetch titles for
 * @param {number} limit - Max titles per country (default 5)
 * @returns {Object} Map of countryCode -> [{url, title}]
 */
export async function fetchGkgTitles(countryCodes, limit = 5) {
    if (!countryCodes || countryCodes.length === 0) {
        return {};
    }

    // 1. Determine Target Date & Range
    const targetDateStr = process.env.TARGET_DATE || new Date().toISOString().split('T')[0];
    const targetDate = new Date(targetDateStr);

    // Start: YYYYMMDD000000
    const startInt = parseInt(targetDate.toISOString().replace(/[-:T.]/g, '').slice(0, 8) + '000000');
    // End: YYYYMMDD235959
    const endInt = parseInt(targetDate.toISOString().replace(/[-:T.]/g, '').slice(0, 8) + '235959');

    // 2. Build filters
    // MAP INPUT ISO -> FIPS for Query
    const countryList = countryCodes
        .map(c => {
            const fips = iso2ToFips(c);
            return fips ? `'${fips}'` : null;
        })
        .filter(c => c !== null)
        .join(',');

    // Domain filter removed as per previous fix, but keeping basket ref if needed later
    // const domainList = MEDIA_BASKET.map(d => `'${d}'`).join(',');

    // 3. Helper: Parse GDELT Date (YYYYMMDDHHMMSS -> ISO)
    // Note: BigQuery returns DATE as integer YYYYMMDDHHMMSS
    const parseGdelt14 = `
        PARSE_TIMESTAMP('%Y%m%d%H%M%S', CAST(DATE AS STRING))
    `;

    const query = `
        WITH ranked AS (
            SELECT 
                V2Locations,
                DocumentIdentifier AS url,
                SPLIT(DocumentIdentifier, '/')[SAFE_OFFSET(2)] AS domain,
                DATE AS gkg_date_int,
                ROW_NUMBER() OVER (
                    PARTITION BY REGEXP_EXTRACT(V2Locations, r'#([A-Z]{2})#')
                    ORDER BY DATE DESC
                ) as rn
            FROM \`gdelt-bq.gdeltv2.gkg_partitioned\`
            WHERE _PARTITIONDATE BETWEEN DATE_SUB(DATE('${targetDateStr}'), INTERVAL 2 DAY) 
                                     AND DATE_ADD(DATE('${targetDateStr}'), INTERVAL 1 DAY)
            AND DATE >= ${startInt} AND DATE <= ${endInt}
            AND REGEXP_EXTRACT(V2Locations, r'#([A-Z]{2})#') IN (${countryList})
            -- AND SPLIT(DocumentIdentifier, '/')[SAFE_OFFSET(2)] IN (\${domainList})
            AND DocumentIdentifier IS NOT NULL
            AND DocumentIdentifier != ''
        )
        SELECT 
            REGEXP_EXTRACT(V2Locations, r'#([A-Z]{2})#') AS iso2,
            url,
            domain,
            gkg_date_int
        FROM ranked
        WHERE rn <= ${limit}
    `;

    console.log(`[DEBUG] GKG Query Range: ${startInt} - ${endInt} (Target: ${targetDateStr})`);

    const options = {
        query: query,
        location: 'US',
    };

    /**
     * Parse GDELT 14-digit integer to ISO string
     */
    function parseGdeltDate(dateInt) {
        if (!dateInt) return null;
        const s = String(dateInt);
        if (s.length !== 14) return null;
        // YYYY MM DD HH MM SS
        const y = s.substring(0, 4);
        const m = s.substring(4, 6);
        const d = s.substring(6, 8);
        const H = s.substring(8, 10);
        const M = s.substring(10, 12);
        const S = s.substring(12, 14);
        return `${y}-${m}-${d}T${H}:${M}:${S}Z`;
    }

    try {
        console.log(`[GKG] Target: ${countryCodes.length} countries. Date: ${targetDateStr}`);

        // 3. Dry Run Cost Guard
        const [dryRunJob] = await bigquery.createQueryJob({ ...options, dryRun: true });
        const bytesEstimated = parseInt(dryRunJob.metadata.statistics.totalBytesProcessed || 0);
        const gbEstimated = bytesEstimated / (1024 ** 3);

        console.log(`[GKG] Dry Run Estimate: ${gbEstimated.toFixed(2)} GB`);

        if (gbEstimated > 50) {
            console.error(`[GKG] SKIP: Scan estimate ${gbEstimated.toFixed(2)}GB exceeds limit (50GB).`);
            return {};
        }

        // 4. Execute Real Query
        const [job] = await bigquery.createQueryJob(options);
        const [rows] = await job.getQueryResults();

        // Log actual cost
        const [metadata] = await job.getMetadata();
        const bytesProcessed = parseInt(metadata.statistics?.totalBytesProcessed || 0);
        const costUsd = (bytesProcessed / (1024 ** 4) * 5).toFixed(6);
        console.log(`[GKG] Executed: ${(bytesProcessed / (1024 ** 3)).toFixed(2)} GB, ~$${costUsd} USD. Rows: ${rows.length}`);

        // 5. Map Results
        const result = {};
        rows.forEach(row => {
            // Convert Result FIPS (row.iso2) -> ISO
            const { iso2: isoKey } = fipsToIso2(row.iso2);

            if (!isoKey) return;
            if (!result[isoKey]) result[isoKey] = [];

            result[isoKey].push({
                url: row.url,
                title: decodeURIComponent(row.url.split('/').pop() || row.domain),
                source: row.domain,
                pubDate: parseGdeltDate(row.gkg_date_int) // Pass formatted date
            });
        });

        // [LOG] Country-level breakdown (P0 Request)
        if (process.env.TARGET_DATE) { // Only log verbose in backfill mode? Or always? User said "backfill time only"
            Object.keys(result).forEach(iso => {
                const count = result[iso].length;
                const firstUrl = count > 0 ? result[iso][0].url : 'N/A';
                // iso2, targetDate, startInt/endInt, rows, firstURL
                console.log(`[GKG-LOG] ${iso}, ${targetDateStr}, ${startInt}/${endInt}, ${count}, ${firstUrl.substring(0, 50)}...`);
            });
        }

        return result;

    } catch (err) {
        console.error("GKG Titles Fetch Error:", err.message);
        return {};
    }
}
