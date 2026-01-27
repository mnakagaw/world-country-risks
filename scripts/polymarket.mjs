import fetch from 'node-fetch';

/**
 * Fetch top markets from Polymarket Gamma API
 */
export async function fetchPolymarketTop10({ limit = 10 } = {}) {
    // API Parameters
    // active=true, closed=false
    // limit=50 (fetch enough to filter)
    // sort=volume (if supported, otherwise default sort and filter later)
    const url = "https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=50&order=volume24hr&ascending=false";

    // console.log(`[PM] Requesting ${url}...`);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        // Gamma API usually returns an array directly or { data: [...] } ?
        // Based on docs, it's array of markets.

        let markets = Array.isArray(data) ? data : (data.data || []);

        // Filter Strategy (Heuristic)
        // We want "Politics" or substantial events.
        // We can check tags or categories if available.
        // Gamma API markets objects usually have: `tags` (array of strings-like), `question`, `slug`, `volume24hr`, `volume`

        const relevant = markets.filter(m => {
            if (!m.volume24hr || m.volume24hr < 1000) return false; // Filter noise
            if (!m.question || !m.slug) return false;

            // Optional: Filter for politics keywords if tags aren't clear
            // But let's keep it broad for 'trending'
            return true;
        });

        // Sort by 24h volume descending
        relevant.sort((a, b) => (b.volume24hr || 0) - (a.volume24hr || 0));

        // Simple mapping for major countries (expanded as needed)
        const COUNTRY_NAMEMAP = {
            "United States": "US", "USA": "US", "U.S.": "US", "America": "US",
            "China": "CN",
            "Japan": "JP",
            "Germany": "DE",
            "United Kingdom": "GB", "UK": "GB", "Britain": "GB",
            "India": "IN",
            "France": "FR",
            "Italy": "IT",
            "Brazil": "BR",
            "Canada": "CA",
            "Russia": "RU", "Russian": "RU",
            "South Korea": "KR", "Korea": "KR",
            "Australia": "AU",
            "Mexico": "MX",
            "Indonesia": "ID",
            "Saudi Arabia": "SA",
            "Turkey": "TR", "Türkiye": "TR",
            "Taiwan": "TW",
            "Iran": "IR",
            "Israel": "IL", "Gaza": "IL", "Hamas": "IL", // Geographic approximation for conflict
            "Ukraine": "UA",
            "Venezuela": "VE",
            "Argentina": "AR",
            "Nigeria": "NG",
            "South Africa": "ZA",
            "Egypt": "EG",
            "Pakistan": "PK",
            "Bangladesh": "BD",
            "Vietnam": "VN",
            "Philippines": "PH",
            "Colombia": "CO",
            "Poland": "PL",
            "Thailand": "TH",
            "Malaysia": "MY",
            "Netherlands": "NL",
            "Spain": "ES",
            "Ireland": "IE",
            "Sweden": "SE",
            "Norway": "NO",
            "Switzerland": "CH",
            "Singapore": "SG",
            "Hong Kong": "HK",
            "Chile": "CL",
            "Peru": "PE",
            "Haiti": "HT",
            "Syria": "SY",
            "Iraq": "IQ",
            "Afghanistan": "AF"
        };

        const matchCountry = (text) => {
            if (!text) return null;
            const t = text.toUpperCase();
            // Check specific keys first (longest match priority?)
            // Simple iteration:
            for (const [name, iso] of Object.entries(COUNTRY_NAMEMAP)) {
                // Heuristic: Space-padded or boundary check is better, but simple verify first
                // e.g. "Russian" in "Russian Election"
                if (t.includes(name.toUpperCase())) return iso;
            }
            return null;
        };

        const top = relevant.slice(0, limit).map((m, idx) => ({
            rank: idx + 1,
            title: m.question,
            url: `https://polymarket.com/market/${m.slug}`,
            volume: m.volume24hr || 0,
            volume_text: `$${Math.round((m.volume24hr || 0) / 1000)}K`,
            source: 'polymarket_gamma',
            iso2: matchCountry(m.question) // Attempt to match ISO2
        }));

        console.log(`[PM] enabled=true ok=true count=${top.length} matched=${top.filter(t => t.iso2).length}`);
        return top;

    } catch (err) {
        console.warn(`[PM] Fetch failed: ${err.message}`);
        return [];
    }
}

async function callGeminiWithRetry(model, prompt, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            return await model.generateContent(prompt);
        } catch (err) {
            const msg = err.message || '';
            const isQuota = msg.includes('429') || msg.includes('Quota') || msg.includes('Resource has been exhausted');
            if (isQuota && i < retries - 1) {
                if (msg.includes('limit: 0') || msg.includes('limit:0')) {
                    console.warn("[PM] Gemini API Limit is 0. Failing fast.");
                    throw err; // Stop retrying
                }
                const delay = Math.pow(2, i) * 5000 + 5000 + (Math.random() * 2000);
                console.warn(`[PM] Gemini Quota hit. Retrying in ${(delay / 1000).toFixed(1)}s...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw err;
        }
    }
}

/**
 * Map Polymarket Question to ISO2 using Gemini and Heuristics
 */
export async function mapPolymarketToCountry(model, title) {
    if (!title) return null;
    const t = title.toUpperCase();

    // 1. High-confidence keyword fallback
    if (t.includes('FED ') || t.includes('TRUMP') || t.includes('BIDEN') || t.includes('U.S.') || t.includes('USA')) return 'US';
    if (t.includes('GAZA') || t.includes('HAMAS') || t.includes('ISRAEL')) return 'IL';
    if (t.includes('XI JINPING') || t.includes('CHINA')) return 'CN';
    if (t.includes('PUTIN') || t.includes('RUSSIA')) return 'RU';
    if (t.includes('UKRAINE')) return 'UA';

    // 2. Gemini mapping
    const prompt = `Identify the primary target country ISO2 code for this Polymarket question.
- For persons (Trump, Biden, Harris, Ron Paul, Elon Musk) -> US
- For institutions (Fed, SEC, ECB, BoJ) -> US, EU, JP etc.
- If it's about a specific country's local event -> that country's ISO2
- If it's a truly global event (e.g. World Cup, Global Pandemic) -> null
Strictly return a single ISO2 code or the string "null".

Question: ${title}

ISO2:`;

    try {
        const result = await callGeminiWithRetry(model, prompt);
        const text = result.response.text().trim().toUpperCase();
        if (text === 'NULL' || text.length > 5) return null;
        return text;
    } catch (err) {
        console.warn("[PM] Gemini mapping failed:", err.message);
        return null;
    }
}
