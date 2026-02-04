import { BigQuery } from '@google-cloud/bigquery';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { fipsToIso2, iso2ToFips } from './fips_to_iso2.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.resolve(__dirname, '../credentials/gcp-service-account.json');

const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'countryrisks-prod';

const bigquery = new BigQuery({
    projectId: BQ_PROJECT_ID,
    keyFilename: keyPath
});

// ============ R DEFINITIONS (External Config) ============
const rDefsPath = path.resolve(__dirname, '../config/r_definitions.json');
let rDefs;
try {
    rDefs = JSON.parse(fs.readFileSync(rDefsPath, 'utf-8'));
    console.log(`[R-DEFS] Loaded ${rDefsPath} (version: ${rDefs.version})`);
} catch (err) {
    throw new Error(`[R-DEFS] FATAL: Could not load ${rDefsPath}: ${err.message}`);
}

/**
 * Generate COUNTIF SQL condition from R definition
 * @param {Object} def - { rootCodes: [], eventCodes: [], eventCodePrefixes: [] }
 * @returns {string} - SQL condition for COUNTIF
 */
function buildRCondition(def) {
    const parts = [];
    if (def.rootCodes && def.rootCodes.length > 0) {
        const quoted = def.rootCodes.map(c => `'${c}'`).join(', ');
        parts.push(`EventRootCode IN (${quoted})`);
    }
    if (def.eventCodes && def.eventCodes.length > 0) {
        const quoted = def.eventCodes.map(c => `'${c}'`).join(', ');
        parts.push(`EventCode IN (${quoted})`);
    }
    // Support for eventCodePrefixes with CAST for type safety
    if (def.eventCodePrefixes && def.eventCodePrefixes.length > 0) {
        const prefixConditions = def.eventCodePrefixes.map(p => `STARTS_WITH(CAST(EventCode AS STRING), '${p}')`);
        parts.push(`(${prefixConditions.join(' OR ')})`);
    }
    if (parts.length === 0) {
        return 'FALSE'; // No conditions → no matches
    }
    return parts.join(' OR ');
}

export async function fetchGkgThemeCounts() {
    // R2/R4 Signal Extraction via GKG Themes
    const date = new Date();
    date.setHours(date.getHours() - 24); // Last 24h is enough for "Daily" check
    const dateInt = parseInt(date.toISOString().replace(/[-:T.]/g, '').slice(0, 14));

    const R2_THEMES = [
        'FOOD_SECURITY', 'FOOD_PRICE', 'HUNGER', 'FAMINE', 'SHORTAGE',
        'BLACKOUT', 'POWER_OUTAGE', 'WATER_SHORTAGE', 'REFUGEE', 'EPIDEMIC', 'DISEASE',
        'HUMAN_RIGHTS_ABUSES'
    ];
    const R4_THEMES = [
        'INFLATION', 'CURRENCY_CRISIS', 'EXCHANGE_RATE', 'DEBT', 'DEFAULT',
        'IMF', 'RESERVES', 'BANK_RUN', 'CAPITAL_CONTROLS', 'BOND_YIELD',
        'ECON_INFLATION', 'ECON_DEBT', 'ECON_CURRENCY_EXCHANGE'
    ];

    // Construct regex for efficiency
    const r2Regex = R2_THEMES.join('|');
    const r4Regex = R4_THEMES.join('|');

    const query = `
        SELECT
            iso2,
            COUNTIF(REGEXP_CONTAINS(V2Themes, r'${r2Regex}')) AS r2_living_count,
            COUNTIF(REGEXP_CONTAINS(V2Themes, r'${r4Regex}')) AS r4_fiscal_count
        FROM \`gdelt-bq.gdeltv2.gkg_partitioned\`,
        UNNEST(SPLIT(V2Locations, ';')) AS location_str,
        UNNEST([REGEXP_EXTRACT(location_str, r'#([A-Z]{2})#')]) AS iso2_raw,
        UNNEST([IF(iso2_raw = 'UK', 'GB', iso2_raw)]) AS iso2
        WHERE _PARTITIONDATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 3 DAY)
        -- DATE column in gkg_partitioned is INT64 (YYYYMMDDHHMMSS), not TIMESTAMP
        AND DATE >= CAST(FORMAT_TIMESTAMP('%Y%m%d%H%M%S', TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 48 HOUR)) AS INT64)
        AND iso2 IS NOT NULL
        AND LENGTH(iso2) = 2
        GROUP BY 1
        HAVING (r2_living_count > 0 OR r4_fiscal_count > 0)
        ORDER BY r2_living_count DESC
    `;

    const options = {
        query: query,
        location: 'US',
    };

    try {
        console.log("Executing GKG Theme Query (R2/R4)...");
        const [job] = await bigquery.createQueryJob(options);
        console.log(`Job ${job.id} started.`);
        const [rows] = await job.getQueryResults();

        // Cost logging
        const [metadata] = await job.getMetadata();
        const bytes = parseInt(metadata.statistics?.totalBytesProcessed || 0);
        const cost = (bytes / (1024 ** 4) * 5).toFixed(6);
        console.log(`[COST] GKG Query: ${(bytes / (1024 ** 3)).toFixed(4)} GB, ~$${cost} USD`);

        const summary = {};
        rows.forEach(row => {
            // Converts FIPS (row.iso2) -> ISO
            // row.iso2 comes from REGEXP_EXTRACT(V2Locations) which is FIPS
            const { iso2: isoKey } = fipsToIso2(row.iso2);
            if (isoKey) {
                summary[isoKey] = {
                    r2_living_count: row.r2_living_count,
                    r4_fiscal_count: row.r4_fiscal_count
                };
            }
        });
        return summary;
    } catch (err) {
        console.error("BigQuery GKG Fetch Error:", err);
        return {};
    }
}

export async function fetchHotCountries() {
    // Generate YYYYMMDDHHMMSS for 48h ago relative to TARGET_DATE
    const date = process.env.TARGET_DATE ? new Date(process.env.TARGET_DATE) : new Date();
    date.setHours(date.getHours() - 48);
    const dateInt = parseInt(date.toISOString().replace(/[-:T.]/g, '').slice(0, 14));

    const dateEnd = new Date(date);
    dateEnd.setHours(dateEnd.getHours() + 48); // Bound to 48h window from start
    const dateEndInt = parseInt(dateEnd.toISOString().replace(/[-:T.]/g, '').slice(0, 14));

    // SQLDATE (YYYYMMDD) for Partition Pruning (Fallback)
    const dateSql = parseInt(date.toISOString().slice(0, 10).replace(/-/g, ''));
    const dateEndSql = parseInt(dateEnd.toISOString().slice(0, 10).replace(/-/g, ''));

    // PARTITION DATE (YYYY-MM-DD) for Main Pruning
    // We scan [StartDate - 1 day] to [EndDate + 1 day] to be safe
    const pStart = new Date(date);
    pStart.setDate(pStart.getDate() - 1);
    const pEnd = new Date(dateEnd);
    pEnd.setDate(pEnd.getDate() + 1);
    const pStartStr = pStart.toISOString().split('T')[0];
    const pEndStr = pEnd.toISOString().split('T')[0];

    const query = `
        SELECT 
            ActionGeo_CountryCode AS iso2,
            COUNT(*) AS event_count,
            AVG(AvgTone) AS avg_tone,
            COUNTIF(${buildRCondition(rDefs.R1)}) AS r1_security,
            COUNTIF(${buildRCondition(rDefs.R3)}) AS r3_governance,
            COUNTIF(${buildRCondition(rDefs.R2)}) AS r2_living,
            COUNTIF(${buildRCondition(rDefs.R4)}) AS r4_fiscal,
            -- Domestic Event Count: events where Actor1Geo or Actor2Geo matches ActionGeo
            -- Using ActorGeo (location-based) instead of ActorCountryCode (affiliation-based)
            COUNTIF(
                (Actor1Geo_CountryCode IS NOT NULL AND Actor1Geo_CountryCode = ActionGeo_CountryCode) OR
                (Actor2Geo_CountryCode IS NOT NULL AND Actor2Geo_CountryCode = ActionGeo_CountryCode)
            ) AS domestic_event_count,
            -- Denominator: events where at least one ActorGeo is known
            COUNTIF(Actor1Geo_CountryCode IS NOT NULL OR Actor2Geo_CountryCode IS NOT NULL) AS denom_actor_geo,
            -- Domestic Ratio: fallback to 1.0 if denom < 50 (insufficient data)
            IF(
                COUNTIF(Actor1Geo_CountryCode IS NOT NULL OR Actor2Geo_CountryCode IS NOT NULL) >= 50,
                SAFE_DIVIDE(
                    COUNTIF(
                        (Actor1Geo_CountryCode IS NOT NULL AND Actor1Geo_CountryCode = ActionGeo_CountryCode) OR
                        (Actor2Geo_CountryCode IS NOT NULL AND Actor2Geo_CountryCode = ActionGeo_CountryCode)
                    ),
                    COUNTIF(Actor1Geo_CountryCode IS NOT NULL OR Actor2Geo_CountryCode IS NOT NULL)
                ),
                1.0
            ) AS domestic_ratio
        FROM \`gdelt-bq.gdeltv2.events_partitioned\`
        WHERE _PARTITIONDATE BETWEEN '${pStartStr}' AND '${pEndStr}'
        AND DATEADDED BETWEEN ${dateInt} AND ${dateEndInt}
        AND SQLDATE BETWEEN ${dateSql} AND ${dateEndSql} -- Extra safety
        AND ActionGeo_CountryCode IS NOT NULL
        -- [P0] SPORTS EXCLUSION (Common Filter) - Strict Path Boundary
        -- [P0] SPORTS EXCLUSION (Common Filter) - Strict Path/Subdomain Boundary
        AND NOT REGEXP_CONTAINS(LOWER(SOURCEURL), r'(\/|\.|^)(sport|sports|football|soccer|nba|nfl|mlb|nhl|f1|ufc)(\/|\.|$)')
        AND NOT REGEXP_CONTAINS(LOWER(SOURCEURL), r'espn\.|goal\.com|bleacherreport\.|skysports\.|marca\.com|sports\.yahoo\.')
        GROUP BY iso2
        HAVING event_count > 10
        ORDER BY event_count DESC
    `;

    const options = {
        query: query,
        location: 'US',
    };

    try {
        console.log("Executing GDELT Events Query (R1-R4) [Strict Filter]...");
        const [job] = await bigquery.createQueryJob(options);
        console.log(`Job ${job.id} started.`);
        const [rows] = await job.getQueryResults();

        // COST VISIBILITY
        const [metadata] = await job.getMetadata();
        const bytesProcessed = parseInt(metadata.statistics?.totalBytesProcessed || 0);
        const gbProcessed = (bytesProcessed / (1024 ** 3)).toFixed(4);
        const estimatedCostUsd = (bytesProcessed / (1024 ** 4) * 5).toFixed(6);
        console.log(`[COST] Events Query: ${gbProcessed} GB scanned, ~$${estimatedCostUsd} USD`);

        const summary = {};
        rows.forEach(row => {
            if (row.iso2 && row.iso2.length === 2) {
                summary[row.iso2] = {
                    event_count: row.event_count,
                    avg_tone: row.avg_tone,
                    r1_security: row.r1_security,
                    r2_living_count: row.r2_living,
                    r3_governance: row.r3_governance,
                    r4_fiscal_count: row.r4_fiscal,
                    domestic_event_count: row.domestic_event_count,
                    denom_actor_geo: row.denom_actor_geo,
                    domestic_ratio: row.domestic_ratio
                };
            }
        });
        return summary;
    } catch (err) {
        console.error("BigQuery GDELT Fetch Error:", err);
        return {};
    }
}

/**
 * Fetch top SourceURLs (Key Events) for specific countries from GDELT Events
 * Strictly selects events that contributed to R-counts (R1-R4) and excludes Sports.
 */
export async function fetchEventUrls(isoCodes) {
    if (!isoCodes || isoCodes.length === 0) return {};

    const date = process.env.TARGET_DATE ? new Date(process.env.TARGET_DATE) : new Date();
    date.setHours(date.getHours() - 48);
    const dateInt = parseInt(date.toISOString().replace(/[-:T.]/g, '').slice(0, 14));

    const dateEnd = new Date(date);
    dateEnd.setHours(dateEnd.getHours() + 96);
    const dateEndInt = parseInt(dateEnd.toISOString().replace(/[-:T.]/g, '').slice(0, 14));

    // SQLDATE (YYYYMMDD) for Partition Pruning
    const dateSql = parseInt(date.toISOString().slice(0, 10).replace(/-/g, ''));
    const dateEndSql = parseInt(dateEnd.toISOString().slice(0, 10).replace(/-/g, ''));

    // PARTITION DATE (YYYY-MM-DD)
    const pStart = new Date(date);
    pStart.setDate(pStart.getDate() - 1);
    const pEnd = new Date(dateEnd);
    pEnd.setDate(pEnd.getDate() + 1);
    const pStartStr = pStart.toISOString().split('T')[0];
    const pEndStr = pEnd.toISOString().split('T')[0];

    // Convert ISO2 -> FIPS 10-4 for GDELT Query
    const countryList = isoCodes
        .map(c => {
            const fips = iso2ToFips(c);
            return fips ? `'${fips}'` : null;
        })
        .filter(c => c !== null)
        .join(',');

    if (!countryList) return {}; // No valid codes

    // Construct Combined R-Condition for Key Events
    // Must match at least one R-def to be a "Key Event" for Risk
    const r1 = buildRCondition(rDefs.R1);
    const r2 = buildRCondition(rDefs.R2);
    const r3 = buildRCondition(rDefs.R3);
    const r4 = buildRCondition(rDefs.R4);
    const combinedR = `(${r1}) OR (${r2}) OR (${r3}) OR (${r4})`;

    const query = `
        SELECT iso2, SOURCEURL, date_added_int, num_mentions, is_r1, is_r2, is_r3, is_r4
        FROM (
            SELECT 
                ActionGeo_CountryCode AS iso2, 
                SOURCEURL, 
                DATEADDED AS date_added_int,
                NumMentions AS num_mentions,
                -- Flags for Prioritization
                IF(${r1}, 1, 0) as is_r1,
                IF(${r2}, 1, 0) as is_r2,
                IF(${r3}, 1, 0) as is_r3,
                IF(${r4}, 1, 0) as is_r4,
                -- Prioritize High Mention counts
                ROW_NUMBER() OVER(PARTITION BY ActionGeo_CountryCode ORDER BY NumMentions DESC) as rn
            FROM \`gdelt-bq.gdeltv2.events_partitioned\`
            WHERE _PARTITIONDATE BETWEEN '${pStartStr}' AND '${pEndStr}'
            AND DATEADDED BETWEEN ${dateInt} AND ${dateEndInt}
            AND SQLDATE BETWEEN ${dateSql} AND ${dateEndSql} -- Partition Pruning
            AND ActionGeo_CountryCode IN (${countryList})
            AND SOURCEURL IS NOT NULL
            -- [P0] STRICT FILTER: Must contribute to R-Score
            AND (${combinedR})
            -- [P0] SPORTS EXCLUSION - Strict Path Boundary (fixed regex)
            -- [P0] SPORTS EXCLUSION - Strict Path/Subdomain Boundary
            AND NOT REGEXP_CONTAINS(LOWER(SOURCEURL), r'(\/|\.|^)(sport|sports|football|soccer|nba|nfl|mlb|nhl|f1|ufc)(\/|\.|$)')
            AND NOT REGEXP_CONTAINS(LOWER(SOURCEURL), r'espn\.|goal\.com|bleacherreport\.|skysports\.|marca\.com|sports\.yahoo\.')
        )
        WHERE rn <= 10
    `;

    const options = { query, location: 'US' };

    try {
        console.log(`[GDELT-KEY-EVENTS] Fetching Top Risk URLs for ${isoCodes.length} countries (Input ISOs)...`);
        const [job] = await bigquery.createQueryJob(options);
        const [rows] = await job.getQueryResults();

        const [metadata] = await job.getMetadata();
        const bytes = parseInt(metadata.statistics?.totalBytesProcessed || 0);
        const cost = (bytes / (1024 ** 4) * 5).toFixed(6);
        console.log(`[GDELT-KEY-EVENTS] Cost: ~$${cost} USD`);

        const result = {};
        rows.forEach((row, index) => {
            // MAP BACK FIPS (row.iso2) -> ISO
            const { iso2: isoKey } = fipsToIso2(row.iso2);
            if (index === 0) {
                console.log("[DEBUG-BQ] Sample Row:", JSON.stringify(row));
                console.log(`[DEBUG-BQ] Conversion: FIPS '${row.iso2}' -> ISO '${isoKey}'`);
            }
            if (isoKey) {
                if (!result[isoKey]) result[isoKey] = [];
                // Basic dedupe check
                const exists = result[isoKey].find(r => r.url === row.SOURCEURL);
                if (!exists) {
                    const rTypes = [];
                    if (row.is_r1) rTypes.push("R1");
                    if (row.is_r2) rTypes.push("R2");
                    if (row.is_r3) rTypes.push("R3");
                    if (row.is_r4) rTypes.push("R4");

                    result[isoKey].push({
                        url: row.SOURCEURL,
                        title: '',
                        source: new URL(row.SOURCEURL).hostname.replace('www.', ''),
                        dateInt: row.date_added_int,
                        mentions: row.num_mentions,
                        r_types: rTypes,
                        flags: { r1: row.is_r1, r2: row.is_r2, r3: row.is_r3, r4: row.is_r4 }
                    });
                }
            }
        });
        return result;
    } catch (err) {
        console.error("GDELT Key Events Fetch Error:", err);
        return {};
    }
}
