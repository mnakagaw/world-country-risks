import 'dotenv/config';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import scoring, { scoreAllCountries, logScoringResult, addDailySnapshot, getHistoricalData, config as scoringConfig } from './scoring.mjs';
import { aggregateToIso2, logConversionStats, loadCountryNameMap } from './fips_to_iso2.js';
import { fetchHotCountries, fetchGkgThemeCounts, fetchEventUrls } from './gdelt_bigquery.js';
import { fetchGkgTitles } from './gkg_titles.js';
import { fetchGoogleTrends, classifyTrendsGemini } from './googletrends.mjs';
import { fetchPolymarketTop10 as fetchPolymarketEvents, mapPolymarketToCountry } from './polymarket.mjs';
import Parser from 'rss-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(__dirname, '../public/data/latest_v4.json');
const HISTORY_PATH = path.resolve(__dirname, '../public/data/v4_history_30d.json');

// SCORING_ENGINE toggle: v4 (default) or legacy
const SCORING_ENGINE = process.env.SCORING_ENGINE || 'v4';
console.log(`[CONFIG] SCORING_ENGINE=${SCORING_ENGINE}`);

const parser = new Parser();

// Always include
const ALWAYS_INCLUDE = ['JP', 'UA', 'RU', 'IL', 'PS', 'US', 'CN', 'TW'];
const TARGET_DATE_STR = process.env.TARGET_DATE || new Date().toISOString().split('T')[0];
const TARGET_DATE_OBJ = new Date(TARGET_DATE_STR);
const IS_HISTORICAL = (new Date() - TARGET_DATE_OBJ) > (48 * 60 * 60 * 1000); // 48h buffer
const ENABLE_GOOGLE_TRENDS = process.env.DISABLE_GEMINI !== '1' && !IS_HISTORICAL;
const ENABLE_POLYMARKET = process.env.DISABLE_GEMINI !== '1' && !IS_HISTORICAL;
const DISABLE_GKG = process.env.DISABLE_GKG === '1';
const DISABLE_GEMINI = process.env.DISABLE_GEMINI === '1';

if (IS_HISTORICAL) {
    console.log(`[CONFIG] Historical Mode Detected (${TARGET_DATE_STR}). Disabling Live RSS/GT/PM.`);
}

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const CRISIS_KEYWORDS_QUERY = '(protest OR crackdown OR coup OR strike OR clashes OR sanctions OR inflation OR blackout OR currency OR election OR violence OR unrest OR crisis OR failure OR emergency)';
const RELAXED_KEYWORDS_QUERY = '(economy OR politics OR election OR inflation OR reform OR debate OR policy OR trade OR diplomat OR minister OR government OR parliament OR unrest OR tension OR crisis)';
const BLACKLIST_KEYWORDS = ['travel', 'tourism', 'hotel', 'flight', 'grand prix', 'race', 'football', 'soccer', 'nba', 'nfl', 'mlb', 'nhl', 'f1', 'ufc', 'sport', 'sports', 'recipe', 'restaurant', 'casino', 'resort', 'vacation', 'holiday', 'league', 'cup', 'match', 'score', 'game', 'highlight'];

// Task C: Country Aliases for Title Check
const COUNTRY_ALIASES = {
    'US': ['United States', 'USA', 'U.S.', 'America', 'Biden', 'Trump', 'White House'],
    'GB': ['United Kingdom', 'UK', 'Britain', 'British', 'London', 'Sunak', 'Starmer'],
    'RU': ['Russia', 'Russian', 'Putin', 'Moscow', 'Kremlin'],
    'UA': ['Ukraine', 'Ukrainian', 'Kyiv', 'Zelensky'],
    'IL': ['Israel', 'Israeli', 'Tel Aviv', 'Netanyahu', 'IDF'],
    'PS': ['Palestine', 'Palestinian', 'Gaza', 'Hamas', 'West Bank'],
    'CN': ['China', 'Chinese', 'Beijing', 'Xi Jinping'],
    'FR': ['France', 'French', 'Paris', 'Macron'],
    'DE': ['Germany', 'German', 'Berlin', 'Scholz'],
    'KR': ['South Korea', 'Korea', 'Seoul', 'Yoon'],
    'JP': ['Japan', 'Japanese', 'Tokyo', 'Kishida'],
    'IR': ['Iran', 'Iranian', 'Tehran'],
    'TR': ['Turkey', 'Türkiye', 'Turkish', 'Erdogan', 'Istanbul', 'Ankara']
};

// Helper for Rate Limit Handling (429)
async function callGeminiWithRetry(model, prompt, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            return await model.generateContent(prompt);
        } catch (err) {
            const msg = err.message || '';
            const isQuota = msg.includes('429') || msg.includes('Quota') || msg.includes('Resource has been exhausted');

            // [Fix] Fail fast if Limit is 0 (Permanent exhaustion)
            if (msg.includes('limit: 0') || msg.includes('limit:0')) {
                console.warn(`[GEMINI] Permanent Quota Exhausted (Limit 0). Disabling Gemini for this run.`);
                process.env.DISABLE_GEMINI = '1';
                throw new Error("GEMINI_LIMIT_0");
            }

            if (isQuota && i < retries - 1) {
                // Exponential backoff: 10s, 20s, 40s, 80s, ...
                const delay = Math.pow(2, i) * 5000 + 5000 + (Math.random() * 2000);
                console.warn(`[GEMINI] Quota hit. Retrying in ${(delay / 1000).toFixed(1)}s... (Attempt ${i + 1}/${retries})`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw err;
        }
    }
}

// [NEW] CLI Args
const args = {};
process.argv.slice(2).forEach((val, index, array) => {
    if (val.startsWith('--')) {
        const key = val.slice(2);
        const nextVal = array[index + 1];
        args[key] = (nextVal && !nextVal.startsWith('--')) ? nextVal : true;
    }
});
const argIso2 = args.iso2 ? args.iso2.split(',').map(s => s.trim().toUpperCase()) : null;
if (argIso2) console.log(`[CONFIG] Filtered to ISO2: ${argIso2.join(', ')}`);

async function fetchNews(countryCode, countryName, isRelaxed = false) {
    // [P0] Historical Skip: Do not fetch live RSS for past dates (avoids future leak)
    if (IS_HISTORICAL) return [];

    // [P0 Fix] Construct expanded query with aliases
    // Format: ("Name" OR "Alias1" OR "Alias2") (Crisis1 OR Crisis2...)
    const terms = [countryName];
    if (COUNTRY_ALIASES[countryCode]) {
        terms.push(...COUNTRY_ALIASES[countryCode]);
    }
    // Remove duplicates and quote each term
    const uniqueTerms = Array.from(new Set(terms));
    const queryName = `(${uniqueTerms.map(t => `"${t}"`).join(' OR ')})`;

    // Task A: Refine Query
    // We keep the query relatively broad to ensure we get *some* results to filter.
    // [P0 Fix] In Relaxed mode, we drop specific topic keywords and rely on JS Blacklist to maximize recall.
    const queryBase = isRelaxed ? '' : CRISIS_KEYWORDS_QUERY; // Empty string for max recall
    const q = `${queryName} ${queryBase} when:1d`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

    try {
        const feed = await parser.parseURL(url);

        // Define valid title terms for local Filtering (same as query scope)
        const validTerms = uniqueTerms;

        const filtered = feed.items.filter(item => {
            const title = item.title;
            const text = (title + ' ' + (item.contentSnippet || '')).toLowerCase();

            // 1. Blacklist Check
            if (BLACKLIST_KEYWORDS.some(bad => text.includes(bad))) return false;

            // [P0] STRICT SPORTS FILTER (URL/Source Check)
            // Filters out subdomains like sports.yahoo.com or paths /sports/
            if (item.link && /[\/.\:]sports?[\/.\:]/i.test(item.link)) return false;
            // Filters out explicit sports sources in Title (Google News format: "Title - Source")
            if (/(Yahoo Sports|ESPN|Bleacher Report|Sky Sports|Marca|Goal\.com)/i.test(title)) return false;

            // 2. Relevance Check (Title match)
            const titleLower = title.toLowerCase();
            const hasRelevance = validTerms.some(term => titleLower.includes(term.toLowerCase()));

            if (countryCode === 'ES' && isRelaxed && !hasRelevance) {
                // console.log(`[DEBUG-ES] Rejected (No Relevance): ${title}`);
            }

            return hasRelevance;
        });

        if (countryCode === 'ES' && isRelaxed) {
            console.log(`[DEBUG-ES] Filtered Items: ${filtered.length}`);
        }

        return filtered.slice(0, 5).map(item => ({
            title: item.title,
            url: item.link,
            sourceorg: item.source || 'Google News',
            pubDate: item.pubDate
        }));
    } catch (err) {
        if (countryCode === 'ES') console.warn(`[DEBUG-ES] FETCH ERROR: ${err.message}`);
        // console.warn(`RSS failed for ${countryName}`);
        return [];
    }
}

/* ============ ANALYSIS LOGIC ============ */

async function analyzeCountry(countryCode, countryName, articles, v4Score, signalStatus = []) {
    // Task B: Skip Gemini for Green countries (save quota/time) unless Yellow+ or specific reason
    if (!v4Score || (v4Score.level === 'green' && !process.env.FORCE_GEMINI_ALL)) {
        return analyzeWithHeuristics(countryCode, countryName, articles, v4Score, signalStatus);
    }

    if (!articles || articles.length === 0) {
        return analyzeWithHeuristics(countryCode, countryName, [], v4Score, signalStatus);
    }

    const prompt = `
    Analyze the following recent news for ${countryName} (${countryCode}).
    Risk Level: ${v4Score?.level || 'Unknown'} (Do not change this level)
    Signals: ${JSON.stringify(v4Score?.signals || [])}
    News Titles & Source URLs:
    ${articles.slice(0, 15).map(a => `- ${a.title} (${a.sourceorg}) | URL: ${a.url}`).join('\n')}

    Output strictly valid JSON (no markdown) with this schema:
    {
      "headline": "Short punchy 1-liner (max 90 chars)",
      "what_happened": "Objective summary of the events driving the risk (max 220 chars)",
      "bundles": ["${(v4Score?.signals || []).map(s => s.type).slice(0, 2).join('","')}"], 
      "watch_48h": "What to watch in next 48h (max 120 chars)",
      "sources": ["Full URL 1", "Full URL 2"],
      "confidence": "low" | "med" | "high",
      "notes": "Internal logic"
    }
    Rules:
    1. Do NOT change the risk level. 
    2. Focus on WHY the signals (Volume, Security, etc) triggered.
    3. **SOURCES**: You must return a list of 1-3 URLs from the input that verify the event.
    4. **CONFIDENCE RUBRIC**:
       - "high": 2+ distinct URLs confirm the specific risk event.
       - "med": 1 URL confirms the event OR multiple weak sources.
       - "low": 0 URLs found OR news is unrelated to risk signals (e.g. sports, celebrity).
    `;

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const result = await callGeminiWithRetry(model, prompt);
        const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const json = JSON.parse(text);

        // [P0 Fix] Safety Post-Processing
        // 1. Ensure sources is an array
        if (!Array.isArray(json.sources)) json.sources = [];

        // 2. Validate Confidence vs Sources (Don't allow High/Med with 0 sources)
        // However, allow Low even if sources exist (if irrelevant)
        if (json.sources.length === 0) {
            json.confidence = 'low';
        }

        // 3. Safety Net for "Unverified" & Sources Fallback
        // [P0] If Gemini failed to return sources but we have articles, use them.
        if (json.sources.length === 0 && articles && articles.length > 0) {
            json.sources = articles.slice(0, 2).map(a => a.url).filter(Boolean);
        }

        // 4. Confidence correction
        if (json.sources.length === 0) {
            json.confidence = 'low';
        } else if (!['low', 'med', 'high'].includes(json.confidence)) {
            json.confidence = 'med'; // Default to med if invalid
        } else if (v4Score.level !== 'green' && json.confidence === 'low') {
            // Safety: If Risk is active (Red/Orange/Yellow) but confidence is Low,
            // force Med to prevent "Unverified" dismissal if we actually have sources.
            json.confidence = 'med';
        }

        // [P0] Rehydrate Sources to Objects (Preserve Metadata like r_types)
        if (json.sources && json.sources.length > 0) {
            const hydrated = json.sources.map(urlStr => {
                // Fuzzy match URL or find exact
                const match = articles.find(a => a.url === urlStr || (a.url && urlStr && a.url.includes(urlStr)));
                if (match) return match;
                // Fallback if Gemini hallucinated a URL or modified it, reconstruct basic obj
                return { url: urlStr, title: 'Source', sourceorg: new URL(urlStr).hostname || 'News' };
            });
            json.sources = hydrated;
        }

        return {
            ...json,
            alert_level: v4Score?.level || 'green',
            summary_en: json.what_happened,
            summary_ja: json.what_happened,
            brief: json
        };
    } catch (err) {
        console.error(`Gemini failed for ${countryCode}:`, err.message);
        return analyzeWithHeuristics(countryCode, countryName, articles, v4Score, signalStatus);
    }
}

function analyzeWithHeuristics(code, name, articles, v4Score, signalStatus = []) {
    // Legacy Heuristics
    const keywords = {
        red: ['war', 'invasion', 'coup', 'conflict', 'dead'],
        orange: ['protest', 'riot', 'crisis', 'tension', 'arrest'],
        yellow: ['concern', 'warning', 'inflation', 'scandal']
    };
    let score = 0;
    const allText = articles ? articles.map(a => a.title.toLowerCase()).join(' ') : '';

    if (keywords.red.some(w => allText.includes(w))) score += 3;
    if (keywords.orange.some(w => allText.includes(w))) score += 2;
    if (keywords.yellow.some(w => allText.includes(w))) score += 1;

    let level = 'green';
    if (score >= 3) level = 'red';
    else if (score >= 2) level = 'orange';
    else if (score >= 1) level = 'yellow';

    // Dynamic Fallback Content
    const topArticle = articles && articles[0] ? articles[0].title : "No news data";
    const secondArticle = articles && articles[1] ? articles[1].title : "";

    let noSignalReason = "Automated Scan: No signals";
    if (!articles || articles.length === 0) {
        if (signalStatus.length > 0) {
            noSignalReason += ` (${signalStatus.join(', ')})`;
        }
    }

    const dynamicHeadline = articles && articles.length > 0 ? `Alert: ${topArticle.substring(0, 60)}...` : noSignalReason;
    const dynamicBody = articles && articles.length > 0 ?
        `Key events: ${topArticle}. ${secondArticle ? 'Also: ' + secondArticle : ''}` :
        "No specific keywords triggered. Routine monitoring active.";

    const hasArticles = articles && articles.length > 0;
    const validSources = hasArticles ? articles.slice(0, 2).map(a => a.url).filter(Boolean) : [];

    return {
        alert_level: level,
        composite_score: 5.0,
        summary_en: `Heuristic analysis: ${level} level keywords detected.`,
        summary_ja: `(自動判定) ${level} レベルのキーワードを検出。`,
        summary_es: `(Auto) ${level} detectado.`,
        headline: dynamicHeadline,
        what_happened: dynamicBody.substring(0, 220),
        bundles: { r1: 5, r2: 5, r3: 5, r4: 5 },
        sources: articles ? articles.slice(0, 3) : [],
        brief: {
            headline: dynamicHeadline,
            what_happened: dynamicBody.substring(0, 220),
            confidence: hasArticles ? "med" : "low",
            sources: validSources
        }
    };
}

/* ============ REGIONAL DIVERSITY ============ */
const REGION_MAP = {
    JP: 'ASIA', CN: 'ASIA', KR: 'ASIA', IN: 'ASIA', PK: 'ASIA', ID: 'ASIA',
    SA: 'MENA', IR: 'MENA', SY: 'MENA', IL: 'MENA', PS: 'MENA',
    NG: 'AFRICA', ZA: 'AFRICA', SD: 'AFRICA',
    BR: 'LATAM', MX: 'LATAM', AR: 'LATAM', VE: 'LATAM',
    UA: 'EUROPE', RU: 'EUROPE', GB: 'EUROPE', FR: 'EUROPE', DE: 'EUROPE',
    US: 'NAMERICA', CA: 'NAMERICA'
};

function applyRegionalDiversity(hotCountries, minPerRegion = 2) {
    const regionCounts = {};
    const selected = new Set();
    const sorted = Object.entries(hotCountries).sort((a, b) => b[1].event_count - a[1].event_count);

    for (const [code] of sorted) {
        const region = REGION_MAP[code] || 'OTHER';
        if ((regionCounts[region] || 0) < minPerRegion) {
            selected.add(code);
            regionCounts[region] = (regionCounts[region] || 0) + 1;
        }
    }
    for (const [code] of sorted) {
        if (selected.size >= 50) break;
        selected.add(code);
    }
    return selected;
}

/* ============ POLITICAL CLASSIFICATION ============ */
function classifyTermsDictionary(terms) {
    return terms.map(t => {
        const hits = POLITICAL_KEYWORDS.filter(kw => {
            // JavaScript's \b only works for ASCII word characters.
            // For non-ASCII (RU/JP/IL), we use simple includes or spacing checks.
            const isAscii = /^[\x00-\x7F]*$/.test(kw);
            if (isAscii) {
                const regex = new RegExp(`\\b${kw}\\b`, 'i');
                return regex.test(t.term);
            } else {
                return t.term.toLowerCase().includes(kw.toLowerCase());
            }
        });
        return {
            term: t.term,
            rank: t.rank,
            is_political: hits.length > 0
        };
    });
}

async function classifyGenericBatchGemini(model, type, itemsPool) {
    // itemsPool: [{ key, terms: [{term, rank}] }]
    if (itemsPool.length === 0) return {};

    const prompt = `Classify these ${type} search trend terms for multiple countries/regions as political/social-risk related or not.
Strictly return a JSON object where keys are the ISO2 or country name and values are arrays of objects: {"US": [{"term": "...", "is_political": true/false, "labels": ["election", ...]}, ...], "Global": [...]}.
A term is political if it relates to: 
- Government, elections, and policy changes.
- Social movements, protests, strikes, and institutional crises.
- Economy, inflation, tax, pension, subsidies, and major budget news.
- International relations, security, war, and defense.
- **Important**: Any news agency names (like "חדשות 12"), institutional names, or politicians' names should be marked as is_political: true.
Labels should be specific keywords like "election", "protest", "economy", "pension", etc. No reasoning or summaries.
Translate non-English terms mentally before classifying if necessary.

Data:
${itemsPool.map(c => `[${c.key}]\n${c.terms.map(t => `${t.term}${t.description ? ` (Context: ${t.description})` : ''}`).join('\n')}`).join('\n\n')}

Output JSON only.`;

    try {
        const result = await callGeminiWithRetry(model, prompt);
        let text = result.response.text();

        // [Fix] Attempt to extract from markdown block first
        const mdMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (mdMatch) {
            text = mdMatch[1];
        }

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn(`[${type}] No JSON found in Gemini output.`);
            // console.warn("Raw:", text.substring(0, 200) + "..."); 
            throw new Error("No JSON object found");
        }
        let classification;
        try {
            classification = JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.warn(`[${type}] JSON syntax error in batch. Falling back to dictionary.`);
            return null; // Trigger fallback
        }

        const output = {};
        for (const c of itemsPool) {
            const matches = classification[c.key] || [];
            output[c.key] = c.terms.map(t => {
                const cleanOrig = t.term.toLowerCase().trim().replace(/[#\-_]/g, ' ');

                // Find match with fuzzy/normalized check
                const match = matches.find(m => {
                    if (!m || !m.term) return false;
                    const cleanMatch = m.term.toLowerCase().trim().replace(/[#\-_]/g, ' ');
                    return cleanMatch === cleanOrig || cleanOrig.includes(cleanMatch) || cleanMatch.includes(cleanOrig);
                });

                let finalTerm = t.term;
                // If match term contains parentheses and the original term, use the match term
                if (match && match.term && match.term.includes('(') && match.term.toLowerCase().includes(t.term.toLowerCase())) {
                    finalTerm = match.term;
                }

                return {
                    ...t,
                    term: finalTerm,
                    is_political: match ? !!match.is_political : false,
                    labels: (match && match.labels) ? match.labels : []
                };
            });
        }
        return output;
    } catch (err) {
        console.warn(`[${type}] Batch Gemini classification failed: ${err.message}`);
        return null;
    }
}

async function transliterateNonLatin(model, terms) {
    const nonLatin = Array.from(new Set(terms.filter(t => /[^\x00-\x7F]/.test(t))));
    if (nonLatin.length === 0) return {};

    const prompt = `Provide the English alphabet/romaji transliteration for these non-Latin terms.
Return exactly a JSON object where keys are the original terms and values are their transliterations.
Example: {"пенсия": "pension", "Путина": "Putina"}.
No reasoning, no extra fields.

Data:
${nonLatin.join('\n')}

Output JSON only.`;

    try {
        console.log(`[Translit] Requesting for ${nonLatin.length} terms: ${nonLatin.slice(0, 3).join(', ')}...`);
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        // console.log("[Translit] Raw response:", text.substring(0, 200)); 
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn("[Translit] No JSON matched in response.");
            return {};
        }
        const data = JSON.parse(jsonMatch[0]);
        console.log(`[Translit] Parsed keys: ${Object.keys(data).join(', ')}`);
        return data;
    } catch (err) {
        console.warn("[Translit] Failed:", err.message);
        return {};
    }
}

// [P0] HISTORY LOADER FOR 4-WEEK TREND
async function loadGlobalHistory(targetDateStr, daysBack = 28) {
    console.log(`[HISTORY] Loading last ${daysBack} days of global R-stats...`);
    const history = {}; // date -> { iso: { r1, r2, r3, r4 } }

    // Calculate dates
    const target = new Date(targetDateStr);
    for (let i = 1; i <= daysBack; i++) {
        const d = new Date(target);
        d.setDate(target.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];

        try {
            const filePath = path.resolve(__dirname, `../public/data/${dateStr}.json`);
            if (fsSync.existsSync(filePath)) {
                const content = fsSync.readFileSync(filePath, 'utf-8');
                const json = JSON.parse(content);
                history[dateStr] = {};

                if (json.countries) {
                    Object.entries(json.countries).forEach(([iso, c]) => {
                        // Extract R-counts
                        // Check structure: is it flat or inside v4_scoring?
                        // Usually in json.countries[iso].gdelt or root?
                        // In 2026-01-19.json: c.gdelt.r1_security ...
                        const r1 = c.gdelt?.r1_security || c.r1_security || 0;
                        const r2 = c.gdelt?.r2_living_count || c.r2_living_count || 0;
                        const r3 = c.gdelt?.r3_governance || c.r3_governance || 0;
                        const r4 = c.gdelt?.r4_fiscal_count || c.r4_fiscal_count || 0;

                        history[dateStr][iso] = { r1, r2, r3, r4 };
                    });
                }
            }
        } catch (e) {
            // ignore missing days
        }
    }
    console.log(`[HISTORY] Loaded history from ${Object.keys(history).length} files.`);
    return history;
}

function getPastDate(baseDateStr, daysAgo) {
    const d = new Date(baseDateStr);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().split('T')[0];
}

// [P0-FIX] Load Weekly JSON Cache for a country (ISO weeks + 5y baseline)
// Returns the last 4 weeks of pre-computed weekly data from weekly/countries/{iso2}.json
function loadWeeklyCountryCache(iso2) {
    try {
        const filePath = path.resolve(__dirname, `../public/data/weekly/countries/${iso2}.json`);
        if (!fsSync.existsSync(filePath)) {
            return null;
        }
        const content = fsSync.readFileSync(filePath, 'utf-8');
        const json = JSON.parse(content);
        if (!json.history || !Array.isArray(json.history)) {
            return null;
        }
        // Return last 4 weeks (most recent at the end of the array)
        const historyLen = json.history.length;
        return json.history.slice(Math.max(0, historyLen - 4));
    } catch (e) {
        console.warn(`[WEEKLY_CACHE] Failed to load ${iso2}: ${e.message}`);
        return null;
    }
}


async function classifyTrendsBatchDictionary(itemsPool) {
    const output = {};
    for (const c of itemsPool) {
        output[c.key] = c.terms.map(t => {
            const hits = POLITICAL_KEYWORDS.filter(kw => {
                const isAscii = /^[\x00-\x7F]*$/.test(kw);
                if (isAscii) {
                    const regex = new RegExp(`\\b${kw}\\b`, 'i');
                    return regex.test(t.term);
                } else {
                    return t.term.toLowerCase().includes(kw.toLowerCase());
                }
            });
            return {
                ...t,
                is_political: hits.length > 0,
                labels: hits
            };
        });
    }
    return output;
}


const POLITICAL_KEYWORDS = [
    'protest', 'strike', 'riot', 'clashes', 'violence', 'unrest', 'crisis',
    'sanctions', 'inflation', 'currency', 'default', 'debt', 'economy', 'economic',
    'government', 'policy', 'minister', 'president', 'election', 'vote', 'corruption',
    'crackdown', 'arrest', 'human rights', 'regime', 'collapse', 'martial', 'emergency',
    'military', 'soldier', 'police', 'security', 'conflict', 'war', 'coup', 'activist',
    'reform', 'parliament', 'cabinet', 'senate', 'legislation', 'treaty', 'sanction',
    'refugee', 'migration', 'protester', 'activism', 'court', 'nuclear', 'missile',
    'energy', 'labor', 'union', 'subsidy', 'oil', 'gas', 'border', 'summit', 'assembly',
    'budget', 'senator', 'governor', 'political', 'commission', 'peace', 'pension',
    'law', 'bill', 'summit', 'diplomatic', 'trade', 'tax', 'labor', 'strike',
    // Multilingual Fallbacks
    'пенсия', 'выборы', 'протест', 'война', 'санкции', 'путин', 'зеленский', // RU/UA
    '首相', '内閣', '選挙', 'デモ', '増税', '政治', '自民党', '岸田', // JP
    'בחירות', 'מלחמה', 'הפגנה', 'ממשלה', 'נתניהו', 'חמאס' // IL
];

function classifyTrendsDictionary(trends) {
    return trends.map(t => ({
        ...t,
        is_political: POLITICAL_KEYWORDS.some(kw => t.title.toLowerCase().includes(kw))
    }));
}




async function getHistoricalPS(iso2, currentToday) {
    const dates = [];
    const cur = new Date(currentToday);
    for (let i = 1; i <= 14; i++) {
        const d = new Date(cur);
        d.setDate(cur.getDate() - i);
        dates.push(d.toISOString().split('T')[0]);
    }

    const psValues = [];
    for (const d of dates) {
        if (psValues.length >= 7) break;
        const filePath = path.resolve(__dirname, `../public/data/${d}.json`);
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);
            const ps = data.air?.countries?.[iso2]?.ps_today;
            if (ps !== undefined) psValues.push(ps);
        } catch (err) {
            // Ignore missing files
        }
    }

    if (psValues.length === 0) return null;
    const avg = psValues.reduce((a, b) => a + b, 0) / psValues.length;
    return avg;
}

/* ============ MAIN ============ */
async function main() {
    console.log("Starting Daily Update...");
    const today = process.env.TARGET_DATE || new Date().toISOString().split('T')[0];

    // 0. Load Baselines
    let baselines = {};
    const baselineEngine = process.env.BASELINE_ENGINE === 'calmest3y' ? 'calmest3y' : 'recent5y';
    console.log(`[CONFIG] BASELINE_ENGINE: ${baselineEngine}`);

    try {
        const filename = baselineEngine === 'calmest3y' ? 'gdelt_calmest3y_baselines.json' : 'gdelt_r_baselines_5y.json';
        const baselinePath = path.resolve(__dirname, `../public/data/baselines/${filename}`);
        const content = await fs.readFile(baselinePath, 'utf-8');
        const baselineJson = JSON.parse(content);
        baselines = baselineJson.baselines || baselineJson.countries || {};
        console.log(`[BASELINES] Loaded stats for ${Object.keys(baselines).length} countries (${filename}).`);
    } catch (err) {
        console.warn(`[BASELINES] No baseline file found for ${baselineEngine}. Skipping adjustment.`);
    }

    // 0.1 Load R-Baselines (prefer 5y, fallback to test3d) for SurgeR calculation
    let rBaselines = {};

    if (baselineEngine === 'calmest3y') {
        // Construct R-Baselines from the main baseline file (which includes median_r1 etc)
        console.log('[R-BASELINES] Using embedded R-metrics from calmest3y baseline.');
        Object.entries(baselines).forEach(([iso, data]) => {
            const b = data.gdelt?.baseline;
            if (b) {
                rBaselines[iso] = {
                    R1: { median: b.median_r1 },
                    R2: { median: b.median_r2 },
                    R3: { median: b.median_r3 },
                    R4: { median: b.median_r4 }
                };
            }
        });
        console.log(`[R-BASELINES] Mapped metrics for ${Object.keys(rBaselines).length} countries.`);
    } else {
        // Legacy: Load separate file
        const rBaseline5yPath = path.resolve(__dirname, '../public/data/baselines/gdelt_r_baselines_5y.json');
        const rBaseline3dPath = path.resolve(__dirname, '../public/data/baselines/gdelt_r_baselines_test3d.json');

        let activeRPath = '';
        try {
            if (fsSync.existsSync(rBaseline5yPath)) {
                activeRPath = rBaseline5yPath;
            } else if (fsSync.existsSync(rBaseline3dPath)) {
                activeRPath = rBaseline3dPath;
            }

            if (activeRPath) {
                const content = await fs.readFile(activeRPath, 'utf-8');
                const rBaselineJson = JSON.parse(content);
                rBaselines = rBaselineJson.baselines || rBaselineJson.countries || {};
                const type = rBaselineJson.meta?.baseline_type || (activeRPath.includes('3d') ? 'test3d' : 'unknown');
                console.log(`[R-BASELINES] Loaded separate R1-R4 baselines for ${Object.keys(rBaselines).length} countries (${type}).`);
            } else {
                console.warn(`[R-BASELINES] No R-baseline file found (checked 5y and test3d). SurgeR will use fallback.`);
            }
        } catch (err) {
            console.warn(`[R-BASELINES] Error loading R-baseline: ${err.message}`);
        }
    }

    // 1. Fetch Events
    console.log("Fetching global GDELT events...");
    const gdeltData = await fetchHotCountries();

    // AUDIT LOG START
    const totalEvents = Object.values(gdeltData).reduce((sum, c) => sum + (c.event_count || 0), 0);
    const uniqueCountries = Object.keys(gdeltData).length;
    const top5 = Object.entries(gdeltData)
        .sort((a, b) => (b[1].event_count || 0) - (a[1].event_count || 0))
        .slice(0, 5)
        .map(([code, d]) => `${code}:${d.event_count}`);
    console.log(`[AUDIT] GDELT Fetch: TotalEvents=${totalEvents}, UniqueCountries=${uniqueCountries}, Top5=${top5.join(',')}`);
    // AUDIT LOG END

    const diverseHotCodes = applyRegionalDiversity(gdeltData);

    // 2. V4 Scoring
    let v4ScoringResult = null;
    let v4YellowPlus = new Set();
    let iso2DataRaw = {};

    // [P0] Load Global History for 28-day trends
    const globalHistory = await loadGlobalHistory(today);

    if (SCORING_ENGINE === 'v4') {
        console.log('[V4] Running unified scoring...');
        const { data: iso2Data, stats } = aggregateToIso2(gdeltData);
        iso2DataRaw = iso2Data;
        logConversionStats(stats);

        // [P0] Load History for Vol Jump / Jump Gate
        try {
            if (fsSync.existsSync(HISTORY_PATH)) {
                const hist = JSON.parse(fsSync.readFileSync(HISTORY_PATH, 'utf-8'));
                scoring.loadHistoricalData(hist);
                console.log(`[HISTORY] Loaded history from ${HISTORY_PATH} (${Object.keys(hist).length} days)`);
            }
        } catch (e) {
            console.warn(`[HISTORY] Failed to load history: ${e.message}`);
        }

        addDailySnapshot(today, iso2Data);

        // [P0] Save Updated History (30d)
        try {
            const updatedHist = getHistoricalData(); // Requires export in scoring.mjs
            fsSync.writeFileSync(HISTORY_PATH, JSON.stringify(updatedHist, null, 2));
            console.log(`[HISTORY] Saved updated history to ${HISTORY_PATH}`);
        } catch (e) {
            console.warn(`[HISTORY] Failed to save history: ${e.message}`);
        }

        v4ScoringResult = scoreAllCountries(iso2Data, { baselines });
        logScoringResult(v4ScoringResult, today);

        // Identify Yellow+ for GKG Targeting
        Object.entries(v4ScoringResult.results).forEach(([code, res]) => {
            if (res.level !== 'green' && res.reason !== 'low_volume') {
                v4YellowPlus.add(code);
            }
        });
        console.log(`[V4] Yellow+ Candidates: ${v4YellowPlus.size}`);
    }

    // 3. Load Name Map from Helper (Consolidated source)
    const iso2NameMap = loadCountryNameMap();

    // Map for list of objects (processed below)
    const countriesList = Object.entries(iso2NameMap).map(([code, name]) => ({ code, name }));

    // [P0] PRE-CALCULATE R-INDEX FOR GKG SELECTION & RSS RELAXATION
    const rIndexScoresMap = {};
    const minBaselineForSurgeSel = scoringConfig.surge_r?.min_baseline_median_for_surge || 3;

    Object.entries(v4ScoringResult.results).forEach(([iso, val]) => {
        const counts = { R1: val.r1_security, R2: val.r2_living_count, R3: val.r3_governance, R4: val.r4_fiscal_count };
        let maxRat = 0;

        // Helper to get baseline (inline simplified)
        const getB = (t) => {
            const ce = rBaselines[iso];
            if (!ce) return 0;
            if (ce[t]) return ce[t].median ?? ce[t].avg ?? 0;
            const n = ce.gdelt_r?.baseline?.[t];
            return n?.median ?? n?.avg ?? 0;
        };

        for (const t of ['R1', 'R2', 'R3', 'R4']) {
            const b = getB(t);
            const r = counts[t] / Math.max(1, b);
            // Active check
            let th = 1.75;
            if (val.flags?.external_pressure_noise && (t === 'R1' || t === 'R3')) th = 2.75;
            if (b >= minBaselineForSurgeSel && r >= th) {
                if (r > maxRat) maxRat = r;
            }
        }
        if (maxRat > 0) rIndexScoresMap[iso] = maxRat;
    });

    const rIndexList = Object.keys(rIndexScoresMap).sort((a, b) => rIndexScoresMap[b] - rIndexScoresMap[a]);
    const rIndexTop40 = rIndexList.slice(0, 40);

    // 4. RSS Fetching (Pass 1) & Identify GKG Candidates
    console.log("Fetching RSS feeds...");
    const countryData = []; // { code, name, rssArticles }

    // Determine process list (Hot + Important + R-Index Surge)
    // [P0 Fix] Must include R-Index candidates, otherwise countries like Spain (Green Raw, High Surge) are skipped!
    let processList = countriesList.filter(c =>
        diverseHotCodes.has(c.code) ||
        ALWAYS_INCLUDE.includes(c.code) ||
        v4YellowPlus.has(c.code) ||
        rIndexTop40.includes(c.code)
    );
    if (argIso2) {
        processList = processList.filter(c => argIso2.includes(c.code));
    }
    console.log(`Processing ${processList.length} countries (Hot/Important/Yellow+)...`);

    for (const c of processList) {
        // Serial fetch to respect rate limits
        let articles = await fetchNews(c.code, c.name, false);

        // [P0] Relaxed Fallback for R-Index High Priority OR Active Risk
        // Fix: Always fetch relaxed for Risk/Surge countries and MERGE results.
        // This prevents "Sports Crisis" (Strict) hiding "Election" (Relaxed).
        const hasSurge = rIndexScoresMap[c.code] > 0;
        const isRisk = v4YellowPlus.has(c.code);

        if (hasSurge || isRisk) {
            // console.log(`[RSS-RELAXED] Merging relaxed fetch for ${c.code}...`);
            const relaxedArticles = await fetchNews(c.code, c.name, true); // true = Relaxed (Broad)
            if (relaxedArticles.length > 0) {
                const existingUrls = new Set(articles.map(a => a.url));
                for (const ra of relaxedArticles) {
                    if (!existingUrls.has(ra.url)) {
                        articles.push({ ...ra, relaxed: true });
                        existingUrls.add(ra.url);
                    }
                }
            }
        }

        if (c.code === 'ES') {
            // console.log(`[RSS-CHECK] ES Final Articles: ${articles.length} (Surge/Risk: ${hasSurge || isRisk})`);
        }

        // [P0] SAFETY FILTER: Re-apply Strict Filter to ensure no sports leaked
        articles = articles.filter(a => {
            const t = (a.title + ' ' + a.url).toLowerCase();
            const hit = BLACKLIST_KEYWORDS.some(bad => t.includes(bad));
            const regexHit = /[\/.\:]sports?[\/.\:]/i.test(a.url) || /(Yahoo Sports|ESPN|Bleacher Report|Sky Sports|Marca|Goal\.com)/i.test(a.title);
            if (hit || regexHit) {
                // console.log(`[SAFETY-FILTER] Dropped ${c.code}: ${a.title}`);
                return false;
            }
            return true;
        });

        countryData.push({ ...c, articles });
        if (countryData.length % 10 === 0) process.stdout.write('.');

        // Rate Limit Protection (Reduce to 200ms for production speed)
        await new Promise(r => setTimeout(r, 200));
    }
    console.log("\nRSS Fetch complete.");

    // [P0] GKG SELECTION LOGIC (Consolidated Union + Cap)
    const rssMissing = [];
    countryData.forEach(c => { if (c.articles.length === 0) rssMissing.push(c.code); });

    const rawYellowPlusList = Array.from(v4YellowPlus);

    // [P0] Union Sets
    // 1. Raw Yellow+ (Risk exists)
    // 2. R-Index Top 30 (Potential surge)
    // 3. RSS Missing (Need context)
    // 4. Always Include
    const rIndexTop30 = rIndexList.slice(0, 30);

    // Union
    const gkgSet = new Set([
        ...rawYellowPlusList,
        ...rIndexTop30,
        ...rssMissing,
        ...ALWAYS_INCLUDE
    ]);
    let gkgTargetArray = Array.from(gkgSet);

    // [P0] Cap at 70 with Strict Priority
    const MAX_GKG = 70;

    if (gkgTargetArray.length > MAX_GKG) {
        gkgTargetArray.sort((a, b) => {
            // Priority 1: High Risk (Red/Orange) - Must Keep
            const getLvl = c => v4ScoringResult.results[c]?.level;
            const pA = (getLvl(a) === 'red' || getLvl(a) === 'orange') ? 20 : 0;
            const pB = (getLvl(b) === 'red' || getLvl(b) === 'orange') ? 20 : 0;
            if (pA !== pB) return pB - pA; // Higher is better

            // Priority 2: RSS Missing (Need context to fill gap)
            const mA = rssMissing.includes(a) ? 15 : 0;
            const mB = rssMissing.includes(b) ? 15 : 0;
            if (mA !== mB) return mB - mA;

            // Priority 3: R-Index Top 30 (Early Warning)
            const rA_Top = rIndexTop30.includes(a) ? 10 : 0;
            const rB_Top = rIndexTop30.includes(b) ? 10 : 0;
            if (rA_Top !== rB_Top) return rB_Top - rA_Top;

            // Priority 4: Event Count (Volume)
            const eA = gdeltData[a]?.event_count || 0;
            const eB = gdeltData[b]?.event_count || 0;
            if (eA !== eB) return eB - eA;

            // Priority 5: Iso Asc
            return a.localeCompare(b);
        });
        gkgTargetArray = gkgTargetArray.slice(0, MAX_GKG);
    }
    console.log(`[GKG] Target Count: ${gkgTargetArray.length} (Cap ${MAX_GKG})`);
    console.log(`[GKG] Breakdown: RAW+=${rawYellowPlusList.length}, R-INDEX+=${rIndexTop30.length}, RSS-Miss=${rssMissing.length}, Final=${gkgTargetArray.length}`);
    console.log(`[GKG] Targeting ${gkgTargetArray.length} countries for fallback/supplement...`);

    // 5. Fetch GKG (Pass 2) - Batch
    let gkgResults = {};
    if (DISABLE_GKG) {
        console.log(`[GKG] Skipped (DISABLE_GKG=1)`);
    } else {
        gkgResults = await fetchGkgTitles(gkgTargetArray, 5);
    }

    // 5b. Fetch GetDayTrends (Phase E4 - SNS Political Surge)
    const ENABLE_GETDAYTRENDS = (process.env.ENABLE_GETDAYTRENDS ?? 'true') === 'true';
    let airData = {
        provider: "getdaytrends",
        window_days: 7,
        classifier: "dictionary", // Initial default
        countries: {},
        sns_top10: []
    };

    if (ENABLE_GETDAYTRENDS && !DISABLE_GEMINI) {
        // [Phase E4] targeting ONLY Yellow+
        const getDayTrendsTargets = Array.from(v4YellowPlus);
        console.log(`[AIR] Yellow+ targets: count=${getDayTrendsTargets.length}`);

        if (getDayTrendsTargets.length > 0) {
            const startAir = Date.now();
            console.log(`[AIR] Fetching GetDayTrends for targets...`);

            try {
                const { fetchGetDayTrends } = await import('./getdaytrends.mjs');
                const airResult = await fetchGetDayTrends({ iso2List: getDayTrendsTargets, nTerms: 20 });
                airData.fetched_at = airResult.fetched_at;

                // Batch classification (Process in chunks of 15 countries)
                const pool = Object.entries(airResult.countries)
                    .filter(([iso2, res]) => res.ok && res.terms && res.terms.length > 0)
                    .map(([iso2, res]) => ({ iso2, terms: res.terms }));

                console.log(`[AIR] Classifying ${pool.length} countries in batches...`);
                const allClassifications = {};
                const modelClassification = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

                for (let i = 0; i < pool.length; i += 8) {
                    const chunk = pool.slice(i, i + 8);
                    const batchResult = await classifyGenericBatchGemini(modelClassification, "SNS", chunk.map(c => ({ key: c.iso2, terms: c.terms })));
                    if (batchResult) {
                        Object.assign(allClassifications, batchResult);
                    } else {
                        // Fallback to dictionary
                        const fallbacks = await classifyTrendsBatchDictionary(chunk.map(c => ({ key: c.iso2, terms: c.terms })));
                        Object.assign(allClassifications, fallbacks);
                    }
                    if (i + 8 < pool.length) process.stdout.write(':');
                }
                console.log("\n[AIR] Batch classification complete.");

                const rankedCountries = [];
                for (const c of pool) {
                    const iso2 = c.iso2;
                    const termsWithClassification = allClassifications[iso2];
                    if (!termsWithClassification) continue;

                    // 2. Post-process transliteration
                    const rawPoliticalTerms = termsWithClassification.filter(t => t.is_political).map(t => t.term);
                    const translitMapRaw = await transliterateNonLatin(modelClassification, rawPoliticalTerms);
                    const translitMap = {};
                    for (const [k, v] of Object.entries(translitMapRaw)) translitMap[k.toLowerCase().trim()] = v;

                    const processedTermsWithClassification = termsWithClassification.map(t => {
                        const cleanT = t.term.toLowerCase().trim();
                        if (t.is_political && translitMap[cleanT]) {
                            return { ...t, term: `${t.term} (${translitMap[cleanT]})` };
                        }
                        return t;
                    });

                    const politicalTerms = processedTermsWithClassification.filter(t => t.is_political).map(t => t.term);
                    const ps_today = parseFloat((politicalTerms.length / 20).toFixed(2));

                    // 3. Historical Baseline
                    const ps_base = await getHistoricalPS(iso2, today);
                    const surge = ps_base === null ? 0 : parseFloat((ps_today - ps_base).toFixed(2));

                    // 4. Store per country (Always store for baseline, even if 0)
                    airData.countries[iso2] = {
                        ps_today,
                        political_terms: politicalTerms.slice(0, 5),
                        top20_terms: processedTermsWithClassification
                    };

                    const is_active = ps_today > 0 && politicalTerms.length > 0;
                    if (is_active) {
                        const name = iso2NameMap[iso2] || iso2;
                        rankedCountries.push({
                            iso2,
                            name_en: name,
                            ps_today,
                            ps_base: ps_base === null ? 0 : parseFloat(ps_base.toFixed(2)),
                            surge,
                            political_terms: politicalTerms.slice(0, 5),
                            is_new: ps_base === null
                        });
                    }
                }

                // 5. SNS Ranking (by Surge)
                airData.sns_top10 = rankedCountries
                    .sort((a, b) => b.surge - a.surge)
                    .slice(0, 10)
                    .map((item, idx) => ({
                        ...item,
                        rank: idx + 1,
                        id: `SNS${String(idx + 1).padStart(2, '0')}`
                    }));

                const elapsed = Date.now() - startAir;
                console.log(`[AIR] sns_top10 generated. ok=${rankedCountries.length} elapsed=${elapsed}ms`);

            } catch (err) {
                console.error("[AIR] Process failed:", err.message);
            }
        }
    } else {
        console.log("[AIR] Skipped");
    }

    // 6. Analysis (Pass 3)
    console.log("Analyzing countries...");
    const output = {
        date: today,
        generated_at: new Date().toISOString(),
        countries: {},
        google_trends: [],
        polymarket: [],
        air: airData,
        daily_briefing_en: "", daily_briefing_ja: "", daily_briefing_es: ""
    };

    const ENABLE_GOOGLE_TRENDS = true;
    const ENABLE_POLYMARKET = true;
    const briefings = [];

    // 7a. Google Trends
    if (ENABLE_GOOGLE_TRENDS) {
        try {
            console.log("[GT] Fetching trends...");
            const rawGTItems = await fetchGoogleTrends({
                geos: ["US", "GB", "IN", "BR", "JP", "RU", "UA", "IL", "DE", "FR", "TR", "KR"],
                limitPerGeo: 30,
                outLimit: 360
            });
            console.log(`[GT] Raw items fetched: ${rawGTItems?.length}`);

            const gtData = {
                provider: "googletrends_rss",
                fetched_at: new Date().toISOString(),
                items: rawGTItems
            };

            const modelGT = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            const classifiedGT = await classifyTrendsGemini(modelGT, gtData.items);
            if (classifiedGT) {
                // Filter only political
                const politicalGT = classifiedGT.filter(t => t.is_political);
                console.log(`[GT] Classified: ${classifiedGT.length}, Political: ${politicalGT.length}`);
                output.google_trends = politicalGT.slice(0, 10);
            } else {
                console.warn("[GT] Classification returned null/empty");
            }
        } catch (e) { console.warn("[GT] Main flow failed", e); }
    }

    // 7b. Polymarket
    if (ENABLE_POLYMARKET) {
        try {
            console.log("[PM] Fetching events...");
            const pmEvents = await fetchPolymarketEvents({ limit: 40 });
            console.log(`[PM] Raw events: ${pmEvents?.length}`);

            // Map to ISO2
            const modelPM = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            console.log(`[PM] Consolidating ${pmEvents.length} events logic...`);

            const pmWithIso = [];
            for (const ev of pmEvents) {
                const mappedIso = await mapPolymarketToCountry(modelPM, ev.title);
                if (mappedIso) {
                    pmWithIso.push({ ...ev, country: mappedIso });
                }
                // Throttle to 15 RPM (1 req every 4s) to avoid 429s on Free Tier
                await new Promise(resolve => setTimeout(resolve, 4000));
            }
            console.log(`[PM] Mapped with ISO: ${pmWithIso.length}`);
            output.polymarket = pmWithIso.slice(0, 10);
        } catch (e) { console.warn("[PM] Main flow failed", e); }
    }


    // 8. Final Assembly Loop - ENSURING ALL BASELINE COUNTRIES
    const allIso2s = new Set([
        ...Object.keys(baselines),
        ...Object.keys(v4ScoringResult.results)
    ]);


    // Helper: Parse GDELT Date (YYYYMMDDHHMMSS -> ISO)
    const parseGdeltDate = (dateInt) => {
        if (!dateInt) return null;
        const s = String(dateInt);
        if (s.length !== 14) return null;
        const y = s.substring(0, 4);
        const m = s.substring(4, 6);
        const d = s.substring(6, 8);
        const H = s.substring(8, 10);
        const M = s.substring(10, 12);
        const S = s.substring(12, 14);
        return `${y}-${m}-${d}T${H}:${M}:${S}Z`;
    };

    console.log(`[ASSEMBLY] Validating coverage for ${allIso2s.size} ISO2 codes...`);

    // INDEX distribution tracking
    const indexScoresForLog = [];

    // [P0] Batch Fetch Fallback source URLs for countries with no GKG/RSS
    const missingDataIsos = [];
    for (const iso2 of allIso2s) {
        const cBase = countryData.find(c => c.code === iso2);
        const hasRSS = cBase && cBase.articles && cBase.articles.length > 0;
        const hasGKG = gkgResults[iso2] && gkgResults[iso2].length > 0;
        if (!hasRSS && !hasGKG) {
            missingDataIsos.push(iso2);
        }
    }

    let eventFallbackData = {};
    if (missingDataIsos.length > 0) {
        console.log(`[ASSEMBLY] Fetching GDELT Event Fallbacks for ${missingDataIsos.length} countries...`);
        eventFallbackData = await fetchEventUrls(missingDataIsos);
    }

    // Calculate indexScores for all countries
    for (const iso2 of allIso2s) {
        const cBase = countryData.find(c => c.code === iso2); // From RSS fetch data
        let articles = cBase ? cBase.articles : [];

        // Track data source status for "No signals" reason
        let signalStatus = [];

        // Check if we have GKG Titles fallback
        // Check if we have GKG/Event Fallback
        if (!articles || articles.length === 0) {
            signalStatus.push("RSS:0");
            const rawEvents = gkgResults[iso2] || []; // These are now Key Events from fetchEventUrls

            if (rawEvents.length > 0) {
                // [P0] DRIVER PRIORITIZATION LOGIC
                // We need to know WHICH R-type is driving the surge to pick relevant events.
                // Re-calculate basic ratios here (simplified from main logic)
                let v4s = v4ScoringResult.results[iso2];
                if (!v4s) v4s = { r1_security: 0, r2_living_count: 0, r3_governance: 0, r4_fiscal_count: 0 };

                // Get baselines
                const getB = (t) => {
                    const ce = rBaselines[iso2];
                    if (!ce) return 0;
                    if (ce[t]) return ce[t].median ?? ce[t].avg ?? 0;
                    const n = ce.gdelt_r?.baseline?.[t];
                    return n?.median ?? n?.avg ?? 0;
                };

                const ratios = [
                    { type: 'R1', val: (v4s.r1_security || 0) / Math.max(1, getB('R1')) },
                    { type: 'R2', val: (v4s.r2_living_count || 0) / Math.max(1, getB('R2')) },
                    { type: 'R3', val: (v4s.r3_governance || 0) / Math.max(1, getB('R3')) },
                    { type: 'R4', val: (v4s.r4_fiscal_count || 0) / Math.max(1, getB('R4')) }
                ];
                // Sort by ratio desc
                ratios.sort((a, b) => b.val - a.val);
                const driver = ratios[0].type; // e.g. 'R3'
                const secondary = ratios[1].type;

                // Selection Strategy
                const selected = [];
                const usedUrls = new Set();

                const pick = (rType) => {
                    // Match event that has the driver R-type in its r_types array
                    const match = rawEvents.find(e => e.r_types && e.r_types.includes(rType) && !usedUrls.has(e.url));
                    if (match) {
                        usedUrls.add(match.url);
                        selected.push(match);
                    }
                };

                // 1. Pick Driver
                pick(driver);
                // 2. Pick Secondary
                pick(secondary);
                // 3. Fill remainder
                for (const e of rawEvents) {
                    if (selected.length >= 5) break;
                    if (!usedUrls.has(e.url)) {
                        usedUrls.add(e.url);
                        selected.push(e);
                    }
                }

                selected.forEach(evt => {
                    let domain = 'GDELT Event';
                    try { domain = new URL(evt.url).hostname.replace('www.', ''); } catch (e) { }
                    articles.push({
                        title: `(${domain}) Coverage related to ${driver}/${secondary}`, // Generic title
                        sourceorg: domain,
                        url: evt.url,
                        pubDate: parseGdeltDate(evt.dateInt) || new Date().toISOString(),
                        r_types: evt.r_types || []
                    });
                });
            } else {
                signalStatus.push("EVT:0"); // No Events available
            }
        }

        // V4 Score or Fallback for Zero-Filling
        let v4Score = v4ScoringResult.results[iso2];

        // ZERO-FILLING LOGIC
        if (!v4Score) {
            v4Score = {
                level: 'green',
                bundles: 0,
                score: 0,
                tone: 0,
                toneModifier: 0,
                signals: [],
                reason: 'no_data',
                vol_jump_data: { jump: 0, median: 0, historyDays: 0, skipped: 'no_data' },
                r1_security: 0,
                r1_jump_data: { jump: 0, median: 0, skipped: 'no_data' },
                r2_living_count: 0,
                r3_governance: 0, // FIXED mismatch (was r3_governance)
                r3_jump_data: { jump: 0, median: 0, skipped: 'no_data' },
                r4_fiscal_count: 0,
                event_count: 0
            };
        }

        let cName = iso2NameMap[iso2] || iso2;
        let isAliased = false;
        // [P0] Use canonical name from aliases (Fixes US -> United States)
        if (COUNTRY_ALIASES[iso2] && COUNTRY_ALIASES[iso2].length > 0) {
            cName = COUNTRY_ALIASES[iso2][0];
            isAliased = true;
        }

        // Perform analysis (Gemini or Heuristics)
        // Pass signalStatus for "No signals" reasoning
        const ana = await analyzeCountry(iso2, cName, articles, v4Score, signalStatus);

        // INDEX CALCULATION + SURGE FIX
        const B = v4Score.bundles || 0;
        const rawScore = Math.min(10, B * 2.5);

        const rScoresSafe = {
            R1: "0.0", R2: "0.0", R3: "0.0", R4: "0.0"
        };

        // Helper to safely extract float (0 if invalid)
        const safeNum = (n) => {
            const v = parseFloat(n);
            return (Number.isFinite(v) && !isNaN(v)) ? v : 0;
        };

        // Helper to check if object has ANY finite R-score
        const hasAnyFiniteR = (obj) => {
            if (!obj) return false;
            return Number.isFinite(parseFloat(obj.R1 || obj.r1)) ||
                Number.isFinite(parseFloat(obj.R2 || obj.r2)) ||
                Number.isFinite(parseFloat(obj.R3 || obj.r3)) ||
                Number.isFinite(parseFloat(obj.R4 || obj.r4));
        };

        // Strict Priority Spec: 
        // 1. Adjusted (r_scores_adj or adj_values)
        // 2. Raw (r_scores)
        // 3. 0
        const adjObj = v4Score.r_scores_adj || null;
        const rawObj = v4Score.r_scores || null;
        const hasAdj = hasAnyFiniteR(adjObj);

        // Select Source strictly based on priority
        const srcObj = hasAdj ? adjObj : (rawObj || {});

        // Helper to get max R-score from an object
        const maxRScore = (obj) => {
            if (!obj) return 0;
            return Math.max(
                safeNum(obj.R1 || obj.r1),
                safeNum(obj.R2 || obj.r2),
                safeNum(obj.R3 || obj.r3),
                safeNum(obj.R4 || obj.r4)
            );
        };

        // Populate display values from the SELECTED source (Alignment) - NO SCALING
        rScoresSafe.R1 = safeNum(srcObj.R1 || srcObj.r1).toFixed(1);
        rScoresSafe.R2 = safeNum(srcObj.R2 || srcObj.r2).toFixed(1);
        rScoresSafe.R3 = safeNum(srcObj.R3 || srcObj.r3).toFixed(1);
        rScoresSafe.R4 = safeNum(srcObj.R4 || srcObj.r4).toFixed(1);

        // Surge Score Overall: max of ALL types (strict priority, no scaling)
        const surgeScoreOverall = Math.min(10, maxRScore(srcObj)); // Clamp to 10

        // ====== ACTIVE SIGNALS (R1-R4 only, VOL excluded) ======
        // These are signals that passed bundle determination (after jump gate + external pressure suppression)
        const signalsArr = v4Score.signals || [];

        // Active signals = R1-R4 only (VOL excluded from INDEX logic)
        const activeSignals = signalsArr.filter(s => ['R1', 'R2', 'R3', 'R4'].includes(s.type));
        const activeTypes = activeSignals.map(s => s.type);

        // ====== SURGING: Use surgeScore_active for color/level (external pressure filter) ======
        // surgeScore_active = max surge from ACTIVE types only (filtered by bundle suppression)
        // This prevents external pressure noise (Greenland/Denmark) from showing as red in SURGING
        let surgeScoreActive = 0;
        for (const t of activeTypes) {
            const val = safeNum(srcObj[t] || srcObj[t.toLowerCase()]);
            if (val > surgeScoreActive) surgeScoreActive = val;
        }
        surgeScoreActive = Math.min(10, surgeScoreActive);

        // SURGING level is determined by surgeScore_active (not overall)
        // r_scores values remain unchanged (strict priority adj>raw>0)
        let surgeLevel = 'Green';
        if (surgeScoreActive >= 7) surgeLevel = 'Red';
        else if (surgeScoreActive >= 4) surgeLevel = 'Orange';
        else if (surgeScoreActive >= 2) surgeLevel = 'Yellow';

        // ====== INDEX CALCULATION (Surge-Biased with Ratio Floor) ======
        // VOL is excluded from INDEX (R1-R4 only)

        // External Pressure Noise Detection (Greenland/etc)
        const domesticRatio = v4Score.domestic_ratio ?? 1.0; // Default to 1.0 if missing
        const denomActorGeo = v4Score.denom_actor_geo ?? 0;
        const externalPressureNoise = domesticRatio <= 0.20;

        // Get r_scores_raw_ratio from scoring (ratio-based floor, prevents saturation)
        const rawFloor = {
            R1: parseFloat(v4Score.r_scores_raw_ratio?.R1 || 0),
            R2: parseFloat(v4Score.r_scores_raw_ratio?.R2 || 0),
            R3: parseFloat(v4Score.r_scores_raw_ratio?.R3 || 0),
            R4: parseFloat(v4Score.r_scores_raw_ratio?.R4 || 0)
        };

        // Get r_scores_raw_abs from scoring (sqrt-scaled absolute)
        const rawAbs = {
            R1: parseFloat(v4Score.r_scores_raw_abs?.R1 || 0),
            R2: parseFloat(v4Score.r_scores_raw_abs?.R2 || 0),
            R3: parseFloat(v4Score.r_scores_raw_abs?.R3 || 0),
            R4: parseFloat(v4Score.r_scores_raw_abs?.R4 || 0)
        };

        // Surge per type (strict priority adj>raw>0) - R1-R4 only
        const surgePerType = {
            R1: safeNum(srcObj.R1 || srcObj.r1),
            R2: safeNum(srcObj.R2 || srcObj.r2),
            R3: safeNum(srcObj.R3 || srcObj.r3),
            R4: safeNum(srcObj.R4 || srcObj.r4)
        };

        // Surge-biased typeScore with ratio floor:
        // typeScore = max(0.45*rawFloor + 0.55*surge, 0.35*rawFloor)
        // "Surging寄り" but chronic vulnerability (ratio) floor is preserved
        const typeScore = {};
        for (const t of ['R1', 'R2', 'R3', 'R4']) {
            const surging = 0.45 * rawFloor[t] + 0.55 * surgePerType[t];
            const floor = 0.35 * rawFloor[t];
            typeScore[t] = Math.max(surging, floor);
        }

        // RMS with weights (downweight R1/R3 if external_pressure_noise)
        const weights = {
            R1: externalPressureNoise ? 0.35 : 1.0,
            R2: 1.0,
            R3: externalPressureNoise ? 0.35 : 1.0,
            R4: 1.0
        };

        let sumSq = 0;
        let sumW = 0;
        for (const t of ['R1', 'R2', 'R3', 'R4']) {
            sumSq += weights[t] * typeScore[t] * typeScore[t];
            sumW += weights[t];
        }
        const indexScore = Math.sqrt(sumSq / (sumW > 0 ? sumW : 1));

        // Fixed thresholds (no percentile)
        let indexLevel = 'Green';
        if (indexScore >= 7.5) indexLevel = 'Red';
        else if (indexScore >= 5.5) indexLevel = 'Orange';
        else if (indexScore >= 3.5) indexLevel = 'Yellow';

        // Align alert_level with v4_scoring.level (v4 bundle determination is primary)
        const alignedAlertLevel = v4Score.level || ana.alert_level || 'green';

        // r_scores_raw: Use ABSOLUTE RAW (0-10) for meaningful RAW display [P2 Fix]
        const rScoresRawSafe = {
            R1: v4Score.r_scores_raw?.R1 ?? "0.0",
            R2: v4Score.r_scores_raw?.R2 ?? "0.0",
            R3: v4Score.r_scores_raw?.R3 ?? "0.0",
            R4: v4Score.r_scores_raw?.R4 ?? "0.0"
        };

        // r_scores_raw_abs: sqrt-scaled absolute for comparison
        const rScoresRawAbsSafe = {
            R1: v4Score.r_scores_raw_abs?.R1 ?? "0.0",
            R2: v4Score.r_scores_raw_abs?.R2 ?? "0.0",
            R3: v4Score.r_scores_raw_abs?.R3 ?? "0.0",
            R4: v4Score.r_scores_raw_abs?.R4 ?? "0.0"
        };

        // Calculate max values for debug
        const rawFloorMax = Math.max(rawFloor.R1, rawFloor.R2, rawFloor.R3, rawFloor.R4);
        const surgeMax = Math.max(surgePerType.R1, surgePerType.R2, surgePerType.R3, surgePerType.R4);
        const typeScoreMax = Math.max(typeScore.R1, typeScore.R2, typeScore.R3, typeScore.R4);

        // ====== SURGER1-4 and SURGER CALCULATION (test3d baseline) ======
        // Get today's R counts from v4Score
        const rTodayCounts = {
            R1: v4Score.r1_security || 0,
            R2: v4Score.r2_living_count || 0,
            R3: v4Score.r3_governance || 0,
            R4: v4Score.r4_fiscal_count || 0
        };

        // Get baseline median (or avg, or 0) from rBaselines
        // Handles both test3d (nested) and 5y (flat) formats
        const getBaseVal = (iso, type) => {
            const countryEntry = rBaselines[iso];
            if (!countryEntry) return 0;

            // Try flat format (5y): { R1: { median: X } }
            if (countryEntry[type]) {
                return countryEntry[type].median ?? countryEntry[type].avg ?? 0;
            }

            // Try nested format (test3d): { gdelt_r: { baseline: { R1: { median: X } } } }
            const nested = countryEntry.gdelt_r?.baseline?.[type];
            return nested?.median ?? nested?.avg ?? 0;
        };

        const rBaselineMedian = {
            R1: getBaseVal(iso2, 'R1'),
            R2: getBaseVal(iso2, 'R2'),
            R3: getBaseVal(iso2, 'R3'),
            R4: getBaseVal(iso2, 'R4')
        };

        // ====== SURGE_R CALCULATION (test3d baseline comparison) ======
        // surge_ratio = (today + k) / (max(1, baseline_median) + k) [smoothed]
        // + abs/share gates from v4 scoring to prevent high-volume false positives
        const surgeRByType = {};
        const surgeRActiveTypes = [];
        let maxRatioActive = 0;
        const minBaselineForSurge = scoringConfig.surge_r?.min_baseline_median_for_surge || 3;
        const smoothingK = scoringConfig.surge_r?.smoothing_k ?? 5;
        const highVolFloor = scoringConfig.surge_r?.high_volume_floor ?? scoringConfig.volume?.threshold ?? 5000;
        const surgeRThresholds = scoringConfig.surge_r?.thresholds || { yellow: 1.75, orange: 2.75, red: 3.75 };

        // Event count for share calculation
        const eventCount = v4Score.event_count || 0;
        const highVol = eventCount >= highVolFloor;

        // R-type config map for abs/share gates
        const rTypeConfigs = {
            R1: scoringConfig.r1_security || { absolute_threshold: 300, ratio_threshold: 0.06 },
            R2: scoringConfig.r2_living || { absolute_threshold: 180, ratio_threshold: 0.035 },
            R3: scoringConfig.r3_governance || { absolute_threshold: 150, ratio_threshold: 0.045 },
            R4: scoringConfig.r4_fiscal || { absolute_threshold: 200, ratio_threshold: 0.04 }
        };

        for (const t of ['R1', 'R2', 'R3', 'R4']) {
            const today = rTodayCounts[t];
            const baseMed = rBaselineMedian[t];

            // (a) Smoothed ratio calculation
            const ratio = (today + smoothingK) / (Math.max(1, baseMed) + smoothingK);

            // (b) Abs/Share Gates (v4-style)
            const rConf = rTypeConfigs[t];
            const absThreshold = rConf.absolute_threshold || 0;
            const ratioThreshold = rConf.ratio_threshold || 0;
            const share = today / Math.max(1, eventCount);

            const absHit = today >= absThreshold;
            const shareHit = share >= ratioThreshold;
            // High-volume countries: absHit alone not enough (prevents DK/ES false positives)
            const triggered = shareHit || (absHit && !highVol);

            // (c) Per-type Active Threshold: yellow default, orange for R1/R3 if external_pressure_noise
            let activeThreshold = surgeRThresholds.yellow;
            if (externalPressureNoise && (t === 'R1' || t === 'R3')) {
                activeThreshold = surgeRThresholds.orange;
            }

            // Stability Rule: baseline_median must be >= min to be active
            const isStableInput = baseMed >= minBaselineForSurge;
            const isActive = triggered && isStableInput && (ratio >= activeThreshold);

            if (isActive) {
                surgeRActiveTypes.push(t);
                if (ratio > maxRatioActive) maxRatioActive = ratio;
            }

            // (d) Audit metadata for debugging
            surgeRByType[t] = {
                today: today,
                baseline_median: baseMed,
                ratio: parseFloat(ratio.toFixed(3)),
                is_active: isActive,
                is_stable_input: isStableInput,
                threshold: activeThreshold,
                // Audit fields
                share: parseFloat(share.toFixed(4)),
                abs_hit: absHit,
                share_hit: shareHit,
                triggered: triggered,
                high_vol: highVol,
                smoothing_k: smoothingK
            };
        }

        // (Old bundle logic removed)
        const surgeRBundleCount = surgeRActiveTypes.length;

        // (e) Level based on max_ratio_active (thresholds from config)
        let surgeRLevel = 'Green';
        if (maxRatioActive >= surgeRThresholds.red) surgeRLevel = 'Red';
        else if (maxRatioActive >= surgeRThresholds.orange) surgeRLevel = 'Orange';
        else if (maxRatioActive >= surgeRThresholds.yellow) surgeRLevel = 'Yellow';

        // Ranking score
        const surgeRRankScore = maxRatioActive;











        // Build country object
        const countryObj = {
            ...ana,
            composite_score: v4Score.score || 0, // [P1 Fix] Ensure valid number
            alert_level: alignedAlertLevel, // v4_scoring.level is primary (no override)
            r_scores: rScoresSafe,           // SURGING display values (strict priority, unchanged)
            r_scores_raw: rScoresRawSafe,    // RAW mode display (absolute P2 fix)
            r_scores_raw_abs: rScoresRawAbsSafe, // RAW absolute (sqrt-scaled) for comparison
            v4_scoring: v4Score,
            gdelt: {
                event_count: v4Score.event_count || 0,
                avg_tone: v4Score.tone || 0,
                r1_security: v4Score.r1_security || 0,
                r2_living_count: v4Score.r2_living_count || 0,
                r3_governance: v4Score.r3_governance || 0,
                r4_fiscal_count: v4Score.r4_fiscal_count || 0,
                domestic_ratio: domesticRatio,
                denom_actor_geo: denomActorGeo
            },
            flags: {
                external_pressure_noise: externalPressureNoise
            },
            source_type: 'rss',
            name_en: cName,
            name_ja: (isAliased || !iso2NameMap[iso2]) ? cName : iso2NameMap[iso2],
            name_es: (isAliased || !iso2NameMap[iso2]) ? cName : iso2NameMap[iso2],
            // SURGING data (uses surgeScore_active for level, r_scores unchanged)
            surge: {
                score: parseFloat(surgeScoreActive.toFixed(1)),
                level: surgeLevel,
                debug: {
                    active_types: activeTypes,
                    surgeScore_active: parseFloat(surgeScoreActive.toFixed(2)),
                    surgeScore_overall: parseFloat(surgeScoreOverall.toFixed(2)),
                    note: "SURGING uses active R1-R4 only; r_scores values unchanged"
                }
            },
            // INDEX data (surge-biased with ratio floor)
            index: {
                score: parseFloat(indexScore.toFixed(1)),
                level: indexLevel,
                debug: {
                    ext_noise: externalPressureNoise,
                    domestic_ratio: domesticRatio,
                    weights: weights,
                    rawFloor_max: parseFloat(rawFloorMax.toFixed(2)),
                    surge_max: parseFloat(surgeMax.toFixed(2)),
                    typeScore_max: parseFloat(typeScoreMax.toFixed(2)),
                    typeScores: {
                        R1: parseFloat(typeScore.R1.toFixed(2)),
                        R2: parseFloat(typeScore.R2.toFixed(2)),
                        R3: parseFloat(typeScore.R3.toFixed(2)),
                        R4: parseFloat(typeScore.R4.toFixed(2))
                    },
                    rawFloors: {
                        R1: parseFloat(rawFloor.R1.toFixed(2)),
                        R2: parseFloat(rawFloor.R2.toFixed(2)),
                        R3: parseFloat(rawFloor.R3.toFixed(2)),
                        R4: parseFloat(rawFloor.R4.toFixed(2))
                    },
                    note: "INDEX uses R1-R4 only (VOL excluded); surge-biased with ratio floor"
                }
            },
            // SurgeR data (test3d baseline comparison)
            surge_r: {
                max_ratio_active: parseFloat(maxRatioActive.toFixed(3)),
                level: surgeRLevel,
                active_types: surgeRActiveTypes,
                bundle_count: surgeRBundleCount,
                thresholds: {
                    yellow: surgeRThresholds.yellow,
                    orange: surgeRThresholds.orange,
                    red: surgeRThresholds.red,
                    min_baseline_median_for_surge: minBaselineForSurge,
                    smoothing_k: smoothingK,
                    high_volume_floor: highVolFloor
                }
            },
            surge_r_by_type: surgeRByType,
            surge_r_score_by_type: (() => {
                const scores = {};
                // Helper for piecewise linear mapping (0-10)
                // <1: 0
                // 1.0-1.75: 0-3
                // 1.75-2.75: 3-7
                // 2.75-3.75: 7-10
                // >=3.75: 10
                const mapRatioToScore = (r) => {
                    if (r < 1.0) return 0;
                    if (r < 1.75) return 3 * (r - 1.0) / 0.75;
                    if (r < 2.75) return 3 + 4 * (r - 1.75); // / 1.0
                    if (r < 3.75) return 7 + 3 * (r - 2.75); // / 1.0
                    return 10;
                };

                ['R1', 'R2', 'R3', 'R4'].forEach(type => {
                    const data = surgeRByType[type];
                    if (!data) {
                        scores[type] = 0;
                        return;
                    }
                    const ratio = data.ratio;
                    // Guard: NaN, Infinity, <=0
                    if (!Number.isFinite(ratio) || ratio <= 0) {
                        scores[type] = 0;
                        return;
                    }
                    // Guard: Unstable input (if flag exists and is false)
                    if (data.is_stable_input === false) {
                        scores[type] = 0;
                        return;
                    }

                    const rawScore = mapRatioToScore(ratio);
                    scores[type] = parseFloat(rawScore.toFixed(1));
                });
                return scores;
            })()
        };

        // [P0] 4-WEEK TREND CALCULATION
        // [P0] 4-WEEK TREND CALCULATION (Aligned with ISO Weeks + 5y Baseline from Weekly Cache)
        const weeklyCache = loadWeeklyCountryCache(iso2);
        const weeklyHistory = {
            weeks: [],
            pattern: { r1: 'stable', r2: 'stable', r3: 'stable', r4: 'stable', overall: 'stable' }
        };

        if (weeklyCache && weeklyCache.length > 0) {
            // Map Weekly JSON history to UI expected structure for the last 4 ISO weeks
            weeklyHistory.weeks = weeklyCache.map((w, idx) => {
                const labelMap = ['W-3', 'W-2', 'W-1', 'W0'];
                // weeklyCache is slice(-4), so last element is latest
                const label = labelMap[4 - weeklyCache.length + idx];

                const weekData = {
                    label: label,
                    week_code: w.week, // ISO week code (e.g. 2026-W03)
                    event_count: w.event_count || 0,
                    active_bundles: w.weekly_surge_r?.active_types || []
                };

                ['r1', 'r2', 'r3', 'r4'].forEach(rKey => {
                    const rType = rKey.toUpperCase();
                    const wData = w.weekly_surge_r_by_type?.[rType] || {};
                    const th = w.weekly_surge_r?.thresholds || scoringConfig.surge_r?.thresholds || { yellow: 1.75, orange: 2.75, red: 3.75 };

                    // Instructions: "ratio は weekly の ratio7 を表示"
                    const r7 = wData.ratio7 || 0;

                    // Instructions: "色は Gate後（is_active / weekly_surge_r.level）に合わせる"
                    const active = wData.is_active || false;
                    let displayLevel = 'none';
                    let gatedLevel = 'gated';

                    if (active) {
                        displayLevel = (r7 >= th.red) ? 'red' : (r7 >= th.orange ? 'orange' : 'yellow');
                        gatedLevel = displayLevel;
                    } else {
                        displayLevel = 'none';
                        gatedLevel = (r7 >= th.yellow) ? 'gated' : 'none';
                    }

                    weekData[rKey] = {
                        count: wData.today7 || 0,
                        ratio: r7, // Use smoothed ratio as requested
                        ratio7: r7,
                        share7: wData.share7 || 0,
                        level: displayLevel,
                        level_gated: gatedLevel,
                        is_active: active,
                        triggered: wData.triggered || false,
                        high_vol: wData.high_vol || false,
                        reason: wData.reason || 'none'
                    };
                });
                return weekData;
            });
        }

        countryObj.surge_r.weekly_history = weeklyHistory;

        output.countries[iso2] = countryObj;

        // Track INDEX distribution for logging
        indexScoresForLog.push({ iso2, indexScore, indexLevel });

        if (ana.alert_level === 'red') briefings.push(`${iso2}: ${ana.headline}`);
    }

    // Log INDEX distribution statistics
    const redCount = indexScoresForLog.filter(x => x.indexLevel === 'Red').length;
    const orangeCount = indexScoresForLog.filter(x => x.indexLevel === 'Orange').length;
    const yellowCount = indexScoresForLog.filter(x => x.indexLevel === 'Yellow').length;
    const greenCount = indexScoresForLog.filter(x => x.indexLevel === 'Green').length;
    const allScores = indexScoresForLog.map(x => x.indexScore).sort((a, b) => a - b);
    const minScore = allScores.length > 0 ? allScores[0] : 0;
    const maxScore = allScores.length > 0 ? allScores[allScores.length - 1] : 0;
    const medianScore = allScores.length > 0 ? allScores[Math.floor(allScores.length / 2)] : 0;
    console.log(`[INDEX] Distribution: Red=${redCount}, Orange=${orangeCount}, Yellow=${yellowCount}, Green=${greenCount}`);
    console.log(`[INDEX] Scores: min=${minScore.toFixed(2)}, median=${medianScore.toFixed(2)}, max=${maxScore.toFixed(2)}`);
    console.log(`[INDEX] Thresholds: Red>=7.5, Orange>=5.5, Yellow>=3.5 (fixed)`);

    // Log SurgeR distribution
    const surgeRData = Object.entries(output.countries).map(([iso2, c]) => ({
        iso2,
        score: c.surge_r?.max_ratio_active || 0,
        level: c.surge_r?.level || 'Green',
        active_types: c.surge_r?.active_types || [],
        bundle_count: c.surge_r?.bundle_count || 0
    }));
    const surgeRRed = surgeRData.filter(x => x.level === 'Red').length;
    const surgeROrange = surgeRData.filter(x => x.level === 'Orange').length;
    const surgeRYellow = surgeRData.filter(x => x.level === 'Yellow').length;
    const surgeRGreen = surgeRData.filter(x => x.level === 'Green').length;
    console.log(`[SURGER] Distribution: Red=${surgeRRed}, Orange=${surgeROrange}, Yellow=${surgeRYellow}, Green=${surgeRGreen}`);

    // [P0] BRIEFING SELECTION LOGIC (Dual Mode + Capsules)
    const allIso2Briefing = Object.keys(output.countries);

    // 1. Raw Yellow+ (Local scope for Briefing)
    const rawYellowPlusBriefing = allIso2Briefing.filter(iso => {
        const level = output.countries[iso].alert_level;
        return level === 'Yellow' || level === 'Orange' || level === 'Red';
    });

    // 2. R-INDEX Candidates
    const rIndexCandidatesBriefing = allIso2Briefing
        .filter(iso => output.countries[iso].surge_r?.max_ratio_active !== undefined)
        .sort((a, b) => (output.countries[b].surge_r?.max_ratio_active || 0) - (output.countries[a].surge_r?.max_ratio_active || 0));

    // [OPS CANDIDATES] (Primary: Top 12 R-INDEX)
    let candidatesOpsISO = rIndexCandidatesBriefing.slice(0, 12);
    if (candidatesOpsISO.length < 12) {
        const used = new Set(candidatesOpsISO);
        const fillCandidates = rawYellowPlusBriefing
            .filter(iso => !used.has(iso))
            .sort((a, b) => (output.countries[b].gdelt.event_count || 0) - (output.countries[a].gdelt.event_count || 0) || a.localeCompare(b));
        candidatesOpsISO = [...candidatesOpsISO, ...fillCandidates.slice(0, 12 - candidatesOpsISO.length)];
    }

    // [TRENDING CANDIDATES] (Surge Score Top 12 - Matches UI)
    let candidatesTrendingISO = allIso2Briefing
        .filter(iso => (output.countries[iso].surge?.score || 0) > 0)
        .sort((a, b) => (output.countries[b].surge?.score || 0) - (output.countries[a].surge?.score || 0));

    // Log the top 10 for verification
    console.log(`[BRIEFING] Top 10 Trending Candidates (Surge Score): ${candidatesTrendingISO.slice(0, 10).join(', ')}`);

    candidatesTrendingISO = candidatesTrendingISO.slice(0, 12);

    // Fill to 12 if needed (Fallback to Raw Yellow+)
    if (candidatesTrendingISO.length < 12) {
        const used = new Set(candidatesTrendingISO);
        const fill = rawYellowPlusBriefing
            .filter(iso => !used.has(iso))
            .sort((a, b) => (output.countries[b].gdelt.event_count || 0) - (output.countries[a].gdelt.event_count || 0));
        candidatesTrendingISO = [...candidatesTrendingISO, ...fill.slice(0, 12 - candidatesTrendingISO.length)];
    }

    // Helper to format candidate object with CAPSULE
    const formatCandidate = (iso, mode) => {
        const c = output.countries[iso];
        // Generate Capsules
        const capsuleEn = generateSignalCapsule(iso, c, 'en');
        const capsuleJa = generateSignalCapsule(iso, c, 'ja');
        const capsuleEs = generateSignalCapsule(iso, c, 'es');

        // Generate Headlines (Top 3)
        let newsHeadlines = (c.sources || []).slice(0, 3).map(s => s.title);
        // Fallback to brief headline if sources empty (rare but possible)
        if (newsHeadlines.length === 0 && c.brief?.headline) {
            newsHeadlines.push(c.brief.headline);
        }

        return {
            iso2: iso,
            name: c.name_en,
            iso2: iso,
            name: c.name_en,
            level: c.alert_level || 'green', // [FIX] Fact is primary (from GDELT/Heuristic)
            surge_level: c.surge_r?.level?.toLowerCase() || 'green', // [NEW] UI can visualize this separately
            r_index_score: parseFloat((c.surge_r?.max_ratio_active || 0).toFixed(2)),
            top_bundles: c.surge_r?.active_types?.slice(0, 2) || [],
            event_count: c.gdelt?.event_count || 0,
            avg_tone: parseFloat((c.gdelt?.avg_tone || 0).toFixed(2)),
            sources: (c.sources || []).slice(0, 2).map(s => s.sourceorg || 'News'), // Keep for Ops
            news_headlines: newsHeadlines.slice(0, 3), // [P0] Add Headlines for Trending
            // Capsules
            signal_capsule: { en: capsuleEn, ja: capsuleJa, es: capsuleEs }
        };
    };

    const candidatesOps = candidatesOpsISO.map(iso => formatCandidate(iso, 'ops'));
    const candidatesTrending = candidatesTrendingISO.map(iso => formatCandidate(iso, 'trending'));

    console.log(`[BRIEFING] Generating Dual Briefings: Trending (${candidatesTrending.length}), Ops (${candidatesOps.length})`);

    // Generate Trending
    let briefingTrending = null;
    if (!DISABLE_GEMINI) {
        briefingTrending = await generateDailyBriefingTrending(genAI.getGenerativeModel({ model: "gemini-2.0-flash" }), candidatesTrending);
    }
    if (!briefingTrending) {
        if (!DISABLE_GEMINI) console.warn("[BRIEFING] Trending Fallback triggered");
        briefingTrending = getFallbackBriefingTrending(candidatesTrending);
    }

    // Generate Ops
    let briefingOps = null;
    if (!DISABLE_GEMINI) {
        briefingOps = await generateDailyBriefingOps(genAI.getGenerativeModel({ model: "gemini-2.0-flash" }), candidatesOps);
    }
    if (!briefingOps) {
        if (!DISABLE_GEMINI) console.warn("[BRIEFING] Ops Fallback triggered");
        briefingOps = getFallbackBriefingOps(candidatesOps);
    }

    output.daily_briefing_trending = briefingTrending;
    output.daily_briefing_ops = briefingOps;

    // Legacy support (points to Ops by default if strictly needed, or just left blank/Ops)
    // We populate these for safety, but UI should switch to new keys.
    output.daily_briefing = briefingOps;
    output.daily_briefing_en = briefingOps.en;
    output.daily_briefing_ja = briefingOps.ja;
    output.daily_briefing_es = briefingOps.es;

    console.log("[BRIEFING] Dual Generation Completed.");

    // AUDIT LOG

    // 7a. Google Trends
    if (ENABLE_GOOGLE_TRENDS) {
        try {
            console.log("[GT] Fetching trends...");
            const rawGTItems = await fetchGoogleTrends({
                geos: ["US", "GB", "IN", "BR", "JP", "RU", "UA", "IL", "DE", "FR", "TR", "KR"],
                limitPerGeo: 30,
                outLimit: 360
            });
            console.log(`[GT] Raw items fetched: ${rawGTItems?.length}`);

            const gtData = {
                provider: "googletrends_rss",
                fetched_at: new Date().toISOString(),
                items: rawGTItems
            };

            const modelGT = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            const classifiedGT = await classifyTrendsGemini(modelGT, gtData.items);
            if (classifiedGT) {
                // Filter only political
                let politicalGT = classifiedGT.filter(t => t.is_political);
                console.log(`[GT] Classified: ${classifiedGT.length}, Political: ${politicalGT.length}`);

                if (politicalGT.length === 0 && classifiedGT.length > 0) {
                    console.log("[GT] No political trends found. Falling back to top 5 raw trends.");
                    politicalGT = classifiedGT.slice(0, 5);
                }

                output.google_trends = politicalGT.slice(0, 10);
            } else {
                console.warn("[GT] Classification returned null/empty");
            }
        } catch (e) { console.warn("[GT] Main flow failed", e); }
    }

    // 7b. Polymarket
    if (ENABLE_POLYMARKET) {
        try {
            console.log("[PM] Fetching events...");
            const pmEvents = await fetchPolymarketEvents({ limit: 40 });
            console.log(`[PM] Raw events: ${pmEvents?.length}`);

            // Map to ISO2
            const modelPM = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            console.log(`[PM] Consolidating ${pmEvents.length} events logic...`);

            const pmWithIso = [];
            for (const ev of pmEvents) {
                const mappedIso = await mapPolymarketToCountry(modelPM, ev.title);
                if (mappedIso) {
                    pmWithIso.push({ ...ev, country: mappedIso, iso2: mappedIso });
                }
            }
            console.log(`[PM] Mapped with ISO: ${pmWithIso.length}`);
            output.polymarket = pmWithIso.slice(0, 10);
        } catch (e) { console.warn("[PM] Main flow failed", e); }
    }

    // AUDIT LOG
    const outCount = Object.keys(output.countries).length;
    const baselineCount = Object.keys(baselines).length;
    console.log(`[AUDIT] Output Generation: Validating Counts...`);
    console.log(`[AUDIT] Baseline Count: ${baselineCount}`);
    console.log(`[AUDIT] Output Count: ${outCount}`);
    console.log(`[AUDIT] AI Signals: GT=${output.google_trends?.length || 0}, PM=${output.polymarket?.length || 0}`);

    // Surge Score Distribution Audit
    const surgeScores = Object.values(output.countries).map(c => c.surge_r?.max_ratio_active || 0).sort((a, b) => a - b);
    const surgeMax = surgeScores.length > 0 ? surgeScores[surgeScores.length - 1] : 0;
    const surgeMed = surgeScores.length > 0 ? surgeScores[Math.floor(surgeScores.length / 2)] : 0;
    console.log(`[AUDIT] Surge Score Stats: Max=${surgeMax.toFixed(1)}, Median=${surgeMed.toFixed(1)}`);

    // SAFETY CHECK
    if (outCount < 200 && !argIso2) {
        console.error(`[CRITICAL] Output country count (${outCount}) is below safety threshold (200). Aborting update.`);
        // Save Debug File
        const debugPath = path.resolve(__dirname, `../public/data/${today}_FAILED.json`);
        await fs.writeFile(debugPath, JSON.stringify(output, null, 2));
        console.error(`[CRITICAL] FAILED JSON saved to ${debugPath} for inspection.`);
        process.exit(1);
    }

    // [P0] FINAL SANITIZATION (Nuclear Option)
    console.log("[AUDIT] Running Final Sanitization on Output...");
    Object.keys(output.countries).forEach(iso => {
        const c = output.countries[iso];
        if (c.sources && Array.isArray(c.sources)) {
            const initialLen = c.sources.length;
            c.sources = c.sources.filter(s => {
                const t = ((s.title || '') + ' ' + (s.url || '') + ' ' + (s.sourceorg || '')).toLowerCase();
                const hit = BLACKLIST_KEYWORDS.some(bad => t.includes(bad));
                const regexHit = /[\/.\:]sports?[\/.\:]/i.test(s.url || '') || /(Yahoo Sports|ESPN|Bleacher Report|Sky Sports|Marca|Goal\.com)/i.test(s.title || '');
                return !(hit || regexHit);
            });
            if (c.sources.length < initialLen) {
                console.log(`[SANITIZE] Removed ${initialLen - c.sources.length} sports sources from ${iso}`);
            }
        }
    });

    // Write Files
    // 1. Daily Archive
    const dailyPath = path.resolve(__dirname, `../public/data/${today}.json`);
    await fs.writeFile(dailyPath, JSON.stringify(output, null, 2));
    console.log(`Daily data saved to ${dailyPath}`);

    // 2. Latest Update
    await fs.writeFile(OUT_FILE, JSON.stringify(output, null, 2));
    console.log(`Latest data updated at ${OUT_FILE}`);

    // 3. Update Date Manifest (available_dates.json)
    try {
        const manifestPath = path.resolve(__dirname, '../public/data/available_dates.json');
        let dates = [];
        try {
            const content = await fs.readFile(manifestPath, 'utf-8');
            dates = JSON.parse(content);
        } catch (err) {
            console.warn("[WARN] Could not read available_dates.json, creating new.");
        }

        if (!dates.includes(today)) {
            dates.unshift(today); // Add new date to top
            dates.sort((a, b) => b.localeCompare(a)); // Ensure desc sort
            await fs.writeFile(manifestPath, JSON.stringify(dates, null, 2));
            console.log(`[MANIFEST] Updated available_dates.json with ${today}`);
        } else {
            console.log(`[MANIFEST] ${today} already exists in manifest.`);
        }
    } catch (err) {
        console.warn("[WARN] Failed to update date manifest:", err);
    }
}

/* ============ BRIEFING GENERATION ============ */
/* ============ BRIEFING GENERATION (DUAL + CAPSULES) ============ */

// [P0] CAPSULE GENERATION (Determinisitic)
function generateWatchHint(activeBundles) {
    if (!activeBundles || activeBundles.length === 0) return "General stability watch"; // Fallback

    // Map R1-R4 to specific hints
    const hints = activeBundles.map(b => {
        if (b === 'R1') return { en: "clashes/arrests/protests follow-ups", ja: "衝突/拘束/デモの続報", es: "choques/detenciones/protestas" };
        if (b === 'R2') return { en: "prices/supply/power-water updates", ja: "物価/供給/停電・水の続報", es: "precios/abasto/cortes" };
        if (b === 'R3') return { en: "official moves/policy/legal-corruption updates", ja: "政府発表/制度変更/司法・汚職の続報", es: "anuncios/medidas/justicia-corrupción" };
        if (b === 'R4') return { en: "FX/rates/CPI/capital controls updates", ja: "為替/金利/CPI/資本規制の続報", es: "tipo de cambio/tasas/CPI/controles" };
        return { en: "risk updates", ja: "リスク続報", es: "actualizaciones de riesgo" };
    });

    // Combine top 2
    const top2 = hints.slice(0, 2);
    return {
        en: top2.map(h => h.en).join(' / '),
        ja: top2.map(h => h.ja).join('・'),
        es: top2.map(h => h.es).join(' / ')
    };
}

function generateSignalCapsule(iso2, c, lang) {
    const name = lang === 'ja' ? (c.name_ja || c.name_en) : c.name_en; // Use simple names

    // [FIX] Constitution Compliance: Fact (alert_level) is absolute for 'level'.
    // Surge is an annotation only.
    const surgeRLevel = c.surge_r?.level?.toLowerCase() || null;
    const alertLevel = c.alert_level?.toLowerCase() || 'gray';

    // STRICT: Displayed level is ALWAYS the Fact (Active Risk Signal)
    const level = alertLevel;

    // Debug log for first 5 countries (only in non-production)
    if (iso2 === 'GT' || iso2 === 'VE' || iso2 === 'SY' || iso2 === 'IR' || iso2 === 'UA') {
        console.log(`[CAPSULE_DEBUG] ${iso2}: surge_r.level=${surgeRLevel}, alert_level=${alertLevel}, displayed_level=${level}`);
    }

    const bundles = c.surge_r?.active_types || [];
    const bStr = bundles.slice(0, 2).join('/') || 'General';

    const evt = c.gdelt?.event_count || 0;
    const rIndex = parseFloat((c.surge_r?.max_ratio_active || 0).toFixed(1));
    const tone = parseFloat((c.gdelt?.avg_tone || 0).toFixed(1));
    const toneStr = tone > 0 ? `+${tone}` : `${tone}`;

    const hintObj = generateWatchHint(bundles);
    const hint = hintObj[lang] || hintObj['en'];

    if (lang === 'ja') {
        const rStr = rIndex > 0 ? `R-INDEX${rIndex}` : '';
        return `${name}(${iso2}) ${level}: ${bStr}。件数${evt}${rStr ? '、' + rStr : ''}、トーン${toneStr}。48h:${hint}。`;
    } else if (lang === 'es') {
        const rStr = rIndex > 0 ? `, R-INDEX=${rIndex}` : '';
        return `${name}(${iso2}) ${level}: ${bStr}. Eventos=${evt}${rStr}, Tono=${toneStr}. Vigilar48h: ${hint}.`;
    } else {
        const rStr = rIndex > 0 ? `, R-INDEX=${rIndex}` : '';
        return `${name} (${iso2}) ${level}: ${bStr}. Events=${evt}${rStr}, Tone=${toneStr}. Watch48h: ${hint}.`;
    }
}


// [P0] DUAL GENERATORS

async function generateDailyBriefingTrending(model, candidates) {
    if (!candidates || candidates.length === 0) return null;

    const headlinesData = candidates.map(c => ({
        country: c.name,
        iso: c.iso2,
        surge_level: c.surge_level || 'green',
        headlines: c.news_headlines,
        capsule: c.signal_capsule.en // Provide context
    }));
    const inputText = JSON.stringify(headlinesData, null, 2);

    const prompt = `
    Input: Global Trending News HEADLINES & Context.
    ${inputText}

    Task: Write a Global News Summary (Trending). 
    
    CRITICAL:
    - DISCARD any introductory sentences like "Global news agencies are focusing on..." or "Here is the summary...".
    - START directly with the first region/country.
    - The output summary MUST be exactly 3-5 major paragraphs.

    Constraints:
    1. Output Strict JSON: { "en": ["Paragraph1", "Paragraph2", ...], "ja": ["段落1", "段落2", ...], "es": ["Párrafo1", ...] }
    2. Style: Strictly professional News Agency / Wire Service (通信社仕様).
    3. Tone:
       - No greetings (挨拶禁止: "こんばんは"等).
       - No introductory filler (冒頭の導入文・一般論禁止).
       - No closing remarks (締め禁止: "最後に"等).
       - Use "常体/体言止め" for Japanese (です・ます調禁止).
       - Use phrases like "～と報じられている", "～とされる", "可能性".
    4. Structure:
       - MUST group by Region: Europe, Middle East, Americas, Asia, Africa.
       - Use one paragraph per major region or category.
       - Include this mandatory disclaimer ONLY as the LAST item of each language array:
         (JA): "本稿は報道量の急増（注目度）を整理したもので、事実認定ではない。"
         (EN): "This report summarizes the surge in media coverage and does not constitute official fact certification."
         (ES): "Este informe resume el aumento de la cobertura mediática y no constituye una certificación oficial de hechos."
    5. Content:
       - Length: 600-900 characters per language in total.
       - Do not invent facts or numbers not in the input.
       - Mention at least 3-5 major countries by name.
       - If no URL/Source for a country, use "details unverified" or "information reported".
       - Do not use markdown (no bold, no bullets).
    `;

    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const json = JSON.parse(text);

        // Validation
        if (!json.en || !Array.isArray(json.en)) throw new Error("Invalid structure");

        return {
            en: json.en.slice(0, 10), ja: json.ja.slice(0, 10), es: json.es.slice(0, 10),
            meta: { basis: "trending", generator: "gemini", date: new Date().toISOString().split('T')[0], candidates_count: candidates.length, countries_used: candidates.map(c => c.iso2) }
        };
    } catch (e) {
        console.warn("Gemini Trending Briefing failed:", e.message);
        return null; // Trigger fallback
    }
}

async function generateDailyBriefingOps(model, candidates) {
    if (!candidates || candidates.length === 0) return null;

    const capsules = candidates.map(c => c.signal_capsule);
    const capsuleText = JSON.stringify(capsules, null, 2);

    const prompt = `
    Input: Surveillance SIGNAL CAPSULES (Fact strings).
    ${capsuleText}

    Task: Write an OPS/Surveillance Briefing.
    Constraints:
    1. Output Strict JSON: { "en": [...], "ja": [...], "es": [...] }
    2. 3-5 lines per language. Max 140 chars/line.
    3. Tone: Intelligence Analyst (Objective, Concise).
    4. Format: "Country: (RiskTypes) Summary. 48h: Watch item."
    5. MUST include numeric data from capsule (R-INDEX or Events).
    6. NO invented facts.
    `;

    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        const json = JSON.parse(text);

        // Validation
        if (!json.en || !Array.isArray(json.en)) throw new Error("Invalid structure");

        return {
            en: json.en.slice(0, 5), ja: json.ja.slice(0, 5), es: json.es.slice(0, 5),
            meta: { basis: "ops", generator: "gemini", date: new Date().toISOString().split('T')[0], candidates_count: candidates.length, countries_used: candidates.map(c => c.iso2) }
        };
    } catch (e) {
        console.warn("Gemini Ops Briefing failed:", e.message);
        return null; // Trigger fallback
    }
}

// [P0] FALLBACKS (Capsule-based, Concrete)

function getFallbackBriefingTrending(candidates) {
    // Select top 4 for specific fallback (Headline based)
    const top = candidates.slice(0, 4);

    // Helper to make a sentence from headlines
    const makeSentences = (lang) => {
        return top.map(c => {
            const headline = (c.news_headlines && c.news_headlines.length > 0) ? c.news_headlines[0] : (lang === 'ja' ? '詳細情報なし' : 'No specific details');
            const name = lang === 'ja' ? (c.name_ja || c.name) : c.name;
            // Clean headline (remove source suffix if present)
            const cleanHeadline = headline.split(' - ')[0];
            if (lang === 'ja') return `${name}: ${cleanHeadline}`;
            if (lang === 'es') return `${name}: ${cleanHeadline}`;
            return `${name}: ${cleanHeadline}`;
        });
    };

    const enLines = makeSentences('en');
    const jaLines = makeSentences('ja');
    const esLines = makeSentences('es');

    const en = [
        "Global Trending: Headlines from top surge regions.",
        ...enLines,
        "Monitoring detailed impact."
    ].slice(0, 5);

    const ja = [
        "世界的トレンド: 急上昇地域の主要ニュース。",
        ...jaLines,
        "詳細な影響を監視中。"
    ].slice(0, 5);

    const es = [
        "Tendencia Global: Titulares principales de regiones en alza.",
        ...esLines,
        "Monitoreando impacto detallado."
    ].slice(0, 5);

    return {
        en, ja, es,
        meta: { basis: "trending", generator: "fallback", date: new Date().toISOString().split('T')[0], candidates_count: candidates.length }
    };
}

function getFallbackBriefingOps(candidates) {
    // Select top 5
    const top = candidates.slice(0, 5);

    // Create direct fallback from capsules
    const en = top.map(c => c.signal_capsule.en.slice(0, 140));
    const ja = top.map(c => c.signal_capsule.ja.slice(0, 140));
    const es = top.map(c => c.signal_capsule.es.slice(0, 140));

    return {
        en, ja, es,
        meta: { basis: "ops", generator: "fallback", date: new Date().toISOString().split('T')[0], candidates_count: candidates.length }
    };
}

main().catch(console.error);
