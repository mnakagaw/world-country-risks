/**
 * COST TEST: Global Coverage with Media Baskets
 * 
 * Purpose: Measure real costs for:
 * - Phase 1: All 258 countries evaluated via BigQuery Events
 * - Phase 2: Media basket per region (7 regions × 5 outlets × max 3 articles)
 * - Gemini: Only Yellow+ countries
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { BigQuery } from '@google-cloud/bigquery';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Parser from 'rss-parser';
import { aggregateToIso2, logConversionStats } from './fips_to_iso2.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.resolve(__dirname, '../credentials/gcp-service-account.json');

const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'countryrisks-prod';

const bigquery = new BigQuery({
    projectId: BQ_PROJECT_ID,
    keyFilename: keyPath
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
const parser = new Parser();

// ============ MEDIA BASKET CONFIG ============
// 7 regions × 5 outlets each = 35 total
const MEDIA_BASKET = {
    AFRICA: [
        { name: 'AllAfrica', rss: 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf' },
        { name: 'News24 SA', rss: 'https://feeds.news24.com/articles/news24/TopStories/rss' },
        { name: 'Daily Nation Kenya', domain: 'nation.africa' },
        { name: 'Punch Nigeria', domain: 'punchng.com' },
        { name: 'Egypt Independent', domain: 'egyptindependent.com' }
    ],
    MENA: [
        { name: 'Al Jazeera', rss: 'https://www.aljazeera.com/xml/rss/all.xml' },
        { name: 'Middle East Eye', domain: 'middleeasteye.net' },
        { name: 'Arab News', domain: 'arabnews.com' },
        { name: 'Haaretz', domain: 'haaretz.com' },
        { name: 'Tehran Times', domain: 'tehrantimes.com' }
    ],
    LATAM: [
        { name: 'El País América', domain: 'elpais.com' },
        { name: 'Folha de São Paulo', domain: 'folha.uol.com.br' },
        { name: 'La Nación Argentina', domain: 'lanacion.com.ar' },
        { name: 'El Universal Mexico', domain: 'eluniversal.com.mx' },
        { name: 'Caracol Colombia', domain: 'caracol.com.co' }
    ],
    EUROPE: [
        { name: 'Reuters', rss: 'https://www.reutersagency.com/feed/' },
        { name: 'BBC', rss: 'http://feeds.bbci.co.uk/news/world/rss.xml' },
        { name: 'DW', domain: 'dw.com' },
        { name: 'France24', domain: 'france24.com' },
        { name: 'The Guardian', domain: 'theguardian.com' }
    ],
    NAMERICA: [
        { name: 'AP News', rss: 'https://rsshub.app/apnews/topics/world-news' },
        { name: 'NYT', domain: 'nytimes.com' },
        { name: 'Washington Post', domain: 'washingtonpost.com' },
        { name: 'CBC Canada', domain: 'cbc.ca' },
        { name: 'NPR', domain: 'npr.org' }
    ],
    ASIA: [
        { name: 'SCMP', domain: 'scmp.com' },
        { name: 'Japan Times', domain: 'japantimes.co.jp' },
        { name: 'Times of India', domain: 'timesofindia.indiatimes.com' },
        { name: 'Straits Times', domain: 'straitstimes.com' },
        { name: 'Yonhap Korea', domain: 'en.yna.co.kr' }
    ],
    OCEANIA: [
        { name: 'ABC Australia', domain: 'abc.net.au' },
        { name: 'NZ Herald', domain: 'nzherald.co.nz' },
        { name: 'Sydney Morning Herald', domain: 'smh.com.au' },
        { name: 'Fiji Times', domain: 'fijitimes.com.fj' },
        { name: 'PNG Post-Courier', domain: 'postcourier.com.pg' }
    ]
};

// Country to region mapping (expanded)
const COUNTRY_REGION = {
    // Africa
    NG: 'AFRICA', ZA: 'AFRICA', KE: 'AFRICA', ET: 'AFRICA', EG: 'AFRICA',
    GH: 'AFRICA', TZ: 'AFRICA', UG: 'AFRICA', DZ: 'AFRICA', MA: 'AFRICA',
    SD: 'AFRICA', CD: 'AFRICA', AO: 'AFRICA', MZ: 'AFRICA', CM: 'AFRICA',
    // MENA
    SA: 'MENA', IR: 'MENA', IQ: 'MENA', SY: 'MENA', YE: 'MENA',
    IL: 'MENA', PS: 'MENA', LB: 'MENA', JO: 'MENA', AE: 'MENA',
    QA: 'MENA', KW: 'MENA', BH: 'MENA', OM: 'MENA', TR: 'MENA',
    // LatAm
    BR: 'LATAM', MX: 'LATAM', AR: 'LATAM', VE: 'LATAM', CO: 'LATAM',
    CL: 'LATAM', PE: 'LATAM', CU: 'LATAM', EC: 'LATAM', BO: 'LATAM',
    PY: 'LATAM', UY: 'LATAM', GT: 'LATAM', HN: 'LATAM', SV: 'LATAM',
    // Europe
    UA: 'EUROPE', RU: 'EUROPE', DE: 'EUROPE', FR: 'EUROPE', GB: 'EUROPE',
    PL: 'EUROPE', IT: 'EUROPE', ES: 'EUROPE', NL: 'EUROPE', BE: 'EUROPE',
    SE: 'EUROPE', NO: 'EUROPE', FI: 'EUROPE', DK: 'EUROPE', AT: 'EUROPE',
    CH: 'EUROPE', PT: 'EUROPE', GR: 'EUROPE', CZ: 'EUROPE', RO: 'EUROPE',
    // North America
    US: 'NAMERICA', CA: 'NAMERICA',
    // Asia
    JP: 'ASIA', CN: 'ASIA', KR: 'ASIA', IN: 'ASIA', PK: 'ASIA',
    ID: 'ASIA', PH: 'ASIA', TH: 'ASIA', VN: 'ASIA', TW: 'ASIA',
    MM: 'ASIA', MY: 'ASIA', SG: 'ASIA', BD: 'ASIA', NP: 'ASIA',
    LK: 'ASIA', KH: 'ASIA', LA: 'ASIA', AF: 'ASIA', KZ: 'ASIA',
    // Oceania
    AU: 'OCEANIA', NZ: 'OCEANIA', FJ: 'OCEANIA', PG: 'OCEANIA', WS: 'OCEANIA'
};

// ============ METRICS ============
const metrics = {
    startTime: Date.now(),
    bigquery: { events: { gb: 0, cost: 0 }, gkg: { gb: 0, cost: 0 } },
    gemini: { requests: 0, inputChars: 0, outputChars: 0 },
    countries: { total: 0, evaluated: 0, yellowPlus: 0 },
    fallbacks: { gkg: 0, rss: 0 }
};

// ============ PHASE 1: ALL COUNTRIES ============
async function fetchAllCountries() {
    const date = new Date();
    date.setHours(date.getHours() - 48);
    const dateInt = parseInt(date.toISOString().replace(/[-:T.]/g, '').slice(0, 14));

    // NO LIMIT - get all countries
    const query = `
        SELECT 
            ActionGeo_CountryCode AS iso2,
            COUNT(*) AS event_count,
            AVG(AvgTone) AS avg_tone,
            COUNTIF(EventRootCode = '14') AS r3_governance,
            COUNTIF(EventRootCode IN ('18','19','20')) AS r1_security
        FROM \`gdelt-bq.gdeltv2.events\`
        WHERE DATEADDED >= ${dateInt}
        AND ActionGeo_CountryCode IS NOT NULL
        GROUP BY iso2
        HAVING event_count > 5
        ORDER BY event_count DESC
    `;

    const [job] = await bigquery.createQueryJob({ query, location: 'US' });
    const [rows] = await job.getQueryResults();

    const [metadata] = await job.getMetadata();
    const bytes = parseInt(metadata.statistics?.totalBytesProcessed || 0);
    metrics.bigquery.events.gb = bytes / (1024 ** 3);
    metrics.bigquery.events.cost = bytes / (1024 ** 4) * 5;

    console.log(`[COST] Events (ALL): ${metrics.bigquery.events.gb.toFixed(4)} GB, ~$${metrics.bigquery.events.cost.toFixed(6)} USD`);
    console.log(`[INFO] Countries with events: ${rows.length}`);

    const rawSummary = {};
    rows.forEach(row => {
        if (row.iso2 && row.iso2.length === 2) {
            rawSummary[row.iso2] = {
                event_count: row.event_count,
                avg_tone: row.avg_tone,
                r1_security: row.r1_security,
                r3_governance: row.r3_governance
            };
        }
    });

    // Convert FIPS → ISO2 with validation
    const { data: summary, stats } = aggregateToIso2(rawSummary);
    logConversionStats(stats);
    console.log(`[INFO] After ISO2 conversion: ${Object.keys(summary).length} countries`);

    return summary;
}

// ============ PHASE 2: GKG WITH MEDIA BASKET ============
async function fetchGkgWithBasket(countryCodes) {
    const date = new Date();
    date.setHours(date.getHours() - 48);
    const dateInt = parseInt(date.toISOString().replace(/[-:T.]/g, '').slice(0, 14));

    // Build domain filter from all baskets
    const allDomains = Object.values(MEDIA_BASKET)
        .flat()
        .filter(m => m.domain)
        .map(m => `'${m.domain}'`)
        .join(',');

    const countryList = countryCodes.map(c => `'${c}'`).join(',');

    const query = `
        WITH ranked AS (
            SELECT 
                REGEXP_EXTRACT(V2Locations, r'#([A-Z]{2})#') AS iso2,
                DocumentIdentifier AS url,
                SPLIT(DocumentIdentifier, '/')[SAFE_OFFSET(2)] AS domain,
                DATE AS gkg_date,
                ROW_NUMBER() OVER (
                    PARTITION BY REGEXP_EXTRACT(V2Locations, r'#([A-Z]{2})#'), 
                                 SPLIT(DocumentIdentifier, '/')[SAFE_OFFSET(2)]
                    ORDER BY DATE DESC
                ) as rn
            FROM \`gdelt-bq.gdeltv2.gkg\`
            WHERE DATE >= ${dateInt}
            AND REGEXP_EXTRACT(V2Locations, r'#([A-Z]{2})#') IN (${countryList})
            AND (
                SPLIT(DocumentIdentifier, '/')[SAFE_OFFSET(2)] IN (${allDomains})
                OR DocumentIdentifier IS NOT NULL
            )
        )
        SELECT iso2, url, domain
        FROM ranked
        WHERE rn <= 3
    `;

    try {
        const [job] = await bigquery.createQueryJob({ query, location: 'US' });
        const [rows] = await job.getQueryResults();

        const [metadata] = await job.getMetadata();
        const bytes = parseInt(metadata.statistics?.totalBytesProcessed || 0);
        metrics.bigquery.gkg.gb = bytes / (1024 ** 3);
        metrics.bigquery.gkg.cost = bytes / (1024 ** 4) * 5;

        console.log(`[COST] GKG (Basket): ${metrics.bigquery.gkg.gb.toFixed(4)} GB, ~$${metrics.bigquery.gkg.cost.toFixed(6)} USD`);
        console.log(`[INFO] GKG rows: ${rows.length}`);

        const result = {};
        rows.forEach(row => {
            if (!row.iso2) return;
            if (!result[row.iso2]) result[row.iso2] = [];
            if (result[row.iso2].length < 10) { // Cap per country
                result[row.iso2].push({
                    url: row.url,
                    title: decodeURIComponent(row.url?.split('/').pop() || row.domain),
                    source: row.domain
                });
            }
        });
        return result;
    } catch (err) {
        console.error("GKG Query Error:", err.message);
        return {};
    }
}

// ============ SCORING (BALANCED v4 - Target: Yellow+ ≈ 40-50) ============
// Rules:
// 1. event_count floor: 100+ (original)
// 2. AvgTone is AUXILIARY only
// 3. Yellow: 2+ bundles OR (1 bundle + bad tone)
// 4. Higher absolute thresholds than v1

function scoreCountry(gdeltData, allData) {
    const { event_count, avg_tone, r1_security, r3_governance } = gdeltData;

    // EVENT FLOOR
    if (event_count < 100) {
        return { level: 'green', bundles: 0, reason: 'low_volume' };
    }

    let bundles = 0;
    const signals = [];

    // R1 Security: Raised absolute threshold
    const r1_ratio = r1_security / event_count;
    if (r1_security > 250 || r1_ratio > 0.05) {
        bundles++;
        signals.push(`R1:${r1_security}`);
    }

    // R3 Governance: Raised absolute threshold
    const r3_ratio = r3_governance / event_count;
    if (r3_governance > 120 || r3_ratio > 0.035) {
        bundles++;
        signals.push(`R3:${r3_governance}`);
    }

    // Volume-based signal
    if (event_count > 5000) {
        bundles++;
        signals.push(`VOL:${event_count}`);
    }

    // AvgTone as AUXILIARY
    const toneModifier = avg_tone < -3 ? 1 : (avg_tone < -1.5 ? 0.5 : 0);

    // ALERT LEVEL DETERMINATION
    // Red: 3+ bundles
    // Orange: 2+ bundles
    // Yellow: 2 bundles OR (1 bundle + bad tone >= 0.5)
    // Green: 0 bundles, or 1 bundle with good tone

    let level = 'green';

    if (bundles >= 3) {
        level = 'red';
    } else if (bundles >= 2) {
        level = 'orange';
    } else if (bundles >= 1 && toneModifier >= 0.5) {
        level = 'yellow';
    }

    return {
        level,
        bundles,
        signals: signals.join(','),
        tone: avg_tone.toFixed(2),
        reason: bundles === 0 ? 'no_signals' : `${bundles}b+tone${toneModifier}`
    };
}

// ============ GEMINI SUMMARY (Yellow+ only) ============
async function summarizeWithGemini(code, name, articles) {
    if (!articles || articles.length === 0) return null;

    const titles = articles.slice(0, 5).map(a => `- ${a.title}`).join('\n');
    const prompt = `Summarize risk for ${name} (${code}) in 1 sentence based on:\n${titles}\nOutput JSON: {"summary":"...","bundles":{"r1":0-10,"r2":0-10,"r3":0-10,"r4":0-10}}`;

    metrics.gemini.inputChars += prompt.length;
    metrics.gemini.requests++;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        metrics.gemini.outputChars += text.length;

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (err) {
        console.error(`Gemini error for ${code}:`, err.message);
        return null;
    }
}

// ============ MAIN ============
async function main() {
    console.log("=".repeat(60));
    console.log("COST TEST: Global Coverage with Media Baskets");
    console.log("=".repeat(60));

    // Phase 1: Get all countries
    console.log("\n[PHASE 1] Fetching ALL countries from BigQuery Events...");
    const gdeltData = await fetchAllCountries();
    metrics.countries.total = Object.keys(gdeltData).length;

    // Score all countries with STRICT thresholds
    const scored = {};
    const distribution = { red: [], orange: [], yellow: [], green: 0, skipped: 0 };

    for (const [code, data] of Object.entries(gdeltData)) {
        const result = scoreCountry(data, gdeltData);
        scored[code] = { ...data, ...result };

        if (result.level === 'red') {
            distribution.red.push(code);
        } else if (result.level === 'orange') {
            distribution.orange.push(code);
        } else if (result.level === 'yellow') {
            distribution.yellow.push(code);
        } else if (result.reason === 'low_volume') {
            distribution.skipped++;
        } else {
            distribution.green++;
        }
    }

    const yellowPlus = [...distribution.red, ...distribution.orange, ...distribution.yellow];
    metrics.countries.yellowPlus = yellowPlus.length;

    console.log(`\n[DISTRIBUTION]`);
    console.log(`  Red:     ${distribution.red.length} - ${distribution.red.join(', ')}`);
    console.log(`  Orange:  ${distribution.orange.length} - ${distribution.orange.join(', ')}`);
    console.log(`  Yellow:  ${distribution.yellow.length} - ${distribution.yellow.join(', ')}`);
    console.log(`  Green:   ${distribution.green}`);
    console.log(`  Skipped: ${distribution.skipped} (event_count < 100)`);
    console.log(`  TOTAL Yellow+: ${yellowPlus.length} (target: 20-70)`);

    // Phase 2: Get GKG titles for Yellow+ only (with basket)
    console.log("\n[PHASE 2] Fetching GKG titles for Yellow+ countries...");
    const gkgTitles = await fetchGkgWithBasket(yellowPlus);
    console.log(`[INFO] GKG titles fetched for ${Object.keys(gkgTitles).length} countries`);

    // Gemini: Only for Yellow+
    console.log("\n[PHASE 3] Gemini summarization for Yellow+ countries...");
    let geminiCount = 0;
    for (const code of yellowPlus.slice(0, 30)) { // Cap at 30 for test
        const articles = gkgTitles[code] || [];
        if (articles.length > 0) {
            await summarizeWithGemini(code, code, articles);
            geminiCount++;
            await new Promise(r => setTimeout(r, 200)); // Rate limit
        }
    }
    console.log(`[INFO] Gemini requests made: ${geminiCount}`);

    // Final metrics
    const endTime = Date.now();
    const duration = (endTime - metrics.startTime) / 1000;

    console.log("\n" + "=".repeat(60));
    console.log("COST TEST RESULTS");
    console.log("=".repeat(60));
    console.log("\n[BIGQUERY COSTS]");
    console.log(`  Events Query: ${metrics.bigquery.events.gb.toFixed(4)} GB, ~$${metrics.bigquery.events.cost.toFixed(6)} USD`);
    console.log(`  GKG Query:    ${metrics.bigquery.gkg.gb.toFixed(4)} GB, ~$${metrics.bigquery.gkg.cost.toFixed(6)} USD`);
    console.log(`  TOTAL BQ:     ${(metrics.bigquery.events.gb + metrics.bigquery.gkg.gb).toFixed(4)} GB, ~$${(metrics.bigquery.events.cost + metrics.bigquery.gkg.cost).toFixed(6)} USD`);

    console.log("\n[GEMINI COSTS]");
    console.log(`  Requests:     ${metrics.gemini.requests}`);
    console.log(`  Input chars:  ${metrics.gemini.inputChars.toLocaleString()}`);
    console.log(`  Output chars: ${metrics.gemini.outputChars.toLocaleString()}`);
    // Gemini 1.5 Flash: $0.075/1M input chars, $0.30/1M output chars
    const geminiCost = (metrics.gemini.inputChars / 1e6 * 0.075) + (metrics.gemini.outputChars / 1e6 * 0.30);
    console.log(`  Est. cost:    ~$${geminiCost.toFixed(6)} USD`);

    console.log("\n[EXECUTION]");
    console.log(`  Duration:     ${duration.toFixed(1)} seconds`);
    console.log(`  Countries:    ${metrics.countries.total} total, ${metrics.countries.yellowPlus} Yellow+`);

    console.log("\n[DAILY ESTIMATE]");
    const dailyBQ = metrics.bigquery.events.cost + metrics.bigquery.gkg.cost;
    const dailyGemini = geminiCost;
    const dailyTotal = dailyBQ + dailyGemini;
    console.log(`  BigQuery:     ~$${dailyBQ.toFixed(4)}/day (~$${(dailyBQ * 30).toFixed(2)}/month)`);
    console.log(`  Gemini:       ~$${dailyGemini.toFixed(4)}/day (~$${(dailyGemini * 30).toFixed(2)}/month)`);
    console.log(`  TOTAL:        ~$${dailyTotal.toFixed(4)}/day (~$${(dailyTotal * 30).toFixed(2)}/month)`);
    console.log("=".repeat(60));
}

main().catch(console.error);
