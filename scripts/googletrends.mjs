import fetch from 'node-fetch'; // Assuming node-fetch is available or using built-in fetch in newer Node

// Regex patterns for RSS parsing
const ITEM_REGEX = /<item>([\s\S]*?)<\/item>/g;
const TITLE_REGEX = /<title>(.*?)<\/title>/;
const LINK_REGEX = /<link>(.*?)<\/link>/;
const DESCRIPTION_REGEX = /<description>(.*?)<\/description>/;

// Fallback endpoints
const ENDPOINTS = [
    (geo) => `https://trends.google.com/trending/rss?geo=${geo}`,
    (geo) => `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`
];

/**
 * Fetch RSS text from a URL with timeout
 */
async function fetchText(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Extract items from RSS XML string
 */
function parseRssItems(xml, geo) {
    const items = [];
    let match;
    while ((match = ITEM_REGEX.exec(xml)) !== null) {
        const content = match[1];
        const titleMatch = TITLE_REGEX.exec(content);
        const linkMatch = LINK_REGEX.exec(content);
        const descMatch = DESCRIPTION_REGEX.exec(content);

        if (titleMatch && linkMatch) {
            const title = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim();
            const link = linkMatch[1].trim();
            const description = descMatch ? descMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '';

            items.push({
                title,
                link,
                description,
                geo,
                iso2: geo,
                source: 'google_trends_rss'
            });
        }
    }
    return items;
}

/**
 * Main Google Trends Fetcher
 */
export async function fetchGoogleTrends({
    geos = ["US", "GB", "IN", "BR", "JP"],
    limitPerGeo = 5,
    outLimit = 6
} = {}) {
    console.log(`[GT] Fetching for geos: ${geos.join(',')}`);
    const allItems = [];
    let okCount = 0;
    let failCount = 0;

    for (const geo of geos) {
        let success = false;
        for (const endpointGen of ENDPOINTS) {
            try {
                const url = endpointGen(geo);
                // console.log(`[GT] Requesting ${url}...`);
                const xml = await fetchText(url);
                const items = parseRssItems(xml, geo);

                if (items.length > 0) {
                    allItems.push(...items.slice(0, limitPerGeo));
                    success = true;
                    // console.log(`[GT] ${geo}: OK (${items.length} items)`);
                    break; // Stop trying endpoints for this geo
                }
            } catch (err) {
                // console.warn(`[GT] ${geo} endpoint failed: ${err.message}`);
                continue;
            }
        }

        if (success) okCount++;
        else {
            failCount++;
            console.warn(`[GT] ${geo}: FAIL (All endpoints)`);
        }
    }

    // Deduplicate by title (normalized)
    const uniqueMap = new Map();
    allItems.forEach(item => {
        const key = item.title.toLowerCase().trim();
        if (!uniqueMap.has(key)) {
            uniqueMap.set(key, item);
        }
    });

    const finalItems = Array.from(uniqueMap.values())
        .slice(0, outLimit)
        .map((item, index) => ({
            rank: index + 1,
            ...item,
            // UI Compatibility Aliases
            query: item.title,
            url: item.link,
            value: `Rank ${index + 1}`
        }));

    console.log(`[GT] enabled=true ok=${okCount} fail=${failCount} total=${finalItems.length}`);
    return finalItems;
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
    'law', 'bill', 'diplomatic', 'trade', 'tax',
    // Multilingual
    'пенсия', 'выборы', 'протест', 'война', 'санкции', 'путин', 'зеленский',
    '首相', '内閣', '選挙', 'デモ', '増税', '政治', '自民党', '岸田',
    'בחירות', 'מלחמה', 'הפגנה', 'ממשלה', 'נתניהו', 'חמאס'
];

const IGNORE_KEYWORDS = [
    ' vs ', 'score', 'highlight', 'prediction', 'fantasy', 'warriors', 'knicks', 'lakers', 'nba', 'nfl', 'football', 'soccer', 'cricket', 'game', 'movie', 'trailer', 'review'
];

async function callGeminiWithRetry(model, prompt, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            return await model.generateContent(prompt);
        } catch (err) {
            const msg = err.message || '';
            const isQuota = msg.includes('429') || msg.includes('Quota') || msg.includes('Resource has been exhausted');
            if (isQuota && i < retries - 1) {
                if (msg.includes('limit: 0') || msg.includes('limit:0')) {
                    console.warn("[GT] Gemini API Limit is 0. Failing fast.");
                    throw err; // Stop retrying
                }
                const delay = Math.pow(2, i) * 5000 + 5000 + (Math.random() * 2000);
                console.warn(`[GT] Gemini Quota hit. Retrying in ${(delay / 1000).toFixed(1)}s...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw err;
        }
    }
}

/**
 * Classify trends using Gemini (Strict Political Filter) with Heuristic Fallback
 */
export async function classifyTrendsGemini(model, trends) {
    if (trends.length === 0) return [];

    // Heuristic Classification (always run as baseline or fallback)
    const runHeuristic = () => {
        return trends.map(t => {
            const title = t.title.toLowerCase();

            // 1. Blacklist check (Sports/Entertainment)
            if (IGNORE_KEYWORDS.some(bad => title.includes(bad))) {
                return { ...t, is_political: false };
            }

            // 2. Political Keyword Check
            const isPolitical = POLITICAL_KEYWORDS.some(kw => {
                // strict check for short words to avoid "warriors" matching "war"
                if (kw.length <= 4) {
                    const regex = new RegExp(`\\b${kw}\\b`, 'i');
                    return regex.test(title);
                }
                return title.includes(kw);
            });
            return { ...t, is_political: isPolitical };
        });
    };

    const prompt = `Classify these search trend titles. Indicate if they are political/social-risk related.

[POLITICAL/RISK CRITERIA]
- Government, elections, policy, legislation.
- Protests, social movements, strikes, peace walks.
- Economic crisis, inflation, major institutional news.
- Security, conflict, international relations.

[NON-POLITICAL CRITERIA]
- Sports teams, match scores (anything with "vs", "score", "game").
- Celebrities, entertainment, movie releases.
- Generic weather or lifestyle topics.
- Normal business news (unless it's a major crisis).

Strictly return a JSON array of objects for ALL ${trends.length} items: [{"title": "...", "is_political": true/false}].
Maintain the original title exactly.

Trends:
${trends.map(t => t.title).join('\n')}

Output JSON only.`;

    try {
        const result = await callGeminiWithRetry(model, prompt);
        let text = result.response.text();

        // [Fix] Extract JSON from Markdown block if present
        const mdMatch = text.match(/```json\s*(\[[\s\S]*?\])\s*```/);
        if (mdMatch) text = mdMatch[1];

        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error("No JSON array found");

        let classification;
        try {
            classification = JSON.parse(jsonMatch[0]);
        } catch (je) {
            console.warn("[GT] JSON Syntax Error in Gemini output. Falling back to heuristic.");
            return runHeuristic();
        }

        console.log(`[GT] Gemini classified ${classification.length} items. Political count: ${classification.filter(c => c.is_political).length}`);

        return trends.map(t => {
            const match = classification.find(c => c.title === t.title);
            return {
                ...t,
                is_political: match ? !!match.is_political : false
            };
        });
    } catch (err) {
        console.warn("[GT] Gemini classification failed:", err.message);
        console.log("[GT] Falling back to keyword heuristics...");
        return runHeuristic();
    }
}
