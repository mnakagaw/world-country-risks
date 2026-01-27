import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Manual overrides for countries where simple slugification fails or differs
const SLUG_OVERRIDES = {
    'US': 'united-states',
    'GB': 'united-kingdom',
    'AE': 'united-arab-emirates',
    'CZ': 'czech-republic',
    'DO': 'dominican-republic',
    'KR': 'south-korea',
    'ZA': 'south-africa',
    'SA': 'saudi-arabia',
    'RU': 'russia', // getdaytrends often uses 'russia' despite official 'Russian Federation'
    'VN': 'vietnam',
    'IR': 'iran',
    'SY': 'syria',
    'TZ': 'tanzania',
    'VE': 'venezuela',
    'BO': 'bolivia',
    'Moldova': 'moldova', // ISO name is 'Moldova, Republic of' usually
    'CD': 'democratic-republic-of-congo',
    'CI': 'ivory-coast', // Cote d'Ivoire
    'TR': 'turkey', // Turkiye? GetDayTrends likely still Turkey
    'TW': 'taiwan',
    'PS': 'palestine' // Often not listed, but if it is
};

// Simple delay helper
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Load country map for slug generation (memoized)
let isoToName = null;
async function loadCountryMap() {
    if (isoToName) return isoToName;
    try {
        const geoJsonPath = path.resolve(__dirname, '../public/geo/countries.geojson');
        const data = JSON.parse(await fs.readFile(geoJsonPath, 'utf8'));
        isoToName = {};
        data.features.forEach(f => {
            const iso = f.properties['ISO3166-1-Alpha-2'];
            const name = f.properties['name']; // Using the simple name property
            if (iso) isoToName[iso] = name;
        });
    } catch (err) {
        console.warn("[AIR] Failed to load geojson for names, using fallbacks.");
        isoToName = {};
    }
    return isoToName;
}

function getSlug(iso2, name) {
    if (SLUG_OVERRIDES[iso2]) return SLUG_OVERRIDES[iso2];
    if (!name) return iso2.toLowerCase();

    // Slugify: lowercase, remove special chars, replace spaces with hyphens
    return name.toLowerCase()
        .replace(/[^\w\s-]/g, '') // remove non-word chars except space and hyphen
        .trim()
        .replace(/\s+/g, '-');
}

async function fetchCountryTrends(iso2, slug, n_terms) {
    const url = `https://getdaytrends.com/${slug}/`;
    // console.log(`[AIR] Fetching ${iso2} -> ${url}`);

    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!res.ok) {
            // console.warn(`[AIR] Failed ${iso2} (${res.status})`);
            return { ok: false, err: `HTTP ${res.status}` };
        }

        const html = await res.text();
        const terms = [];

        // Regex Parsing Strategy
        // Looking for table rows or list items.
        // Typical structure might be: <a href="/indonesia/trend/Term/">Term</a> ... <span class="...">20K</span>
        // Let's try to match the specific pattern seen on GetDayTrends.
        // Pattern: <td class="main"><a href="...">Term</a></td> ... <td class="amount">20K+</td>
        // Or simpler: <a href="/[slug]/trend/[^"]+/">([^<]+)</a>

        // Regex to capture term matches. Adjust based on inspection if possible, but generic approach:
        // href="/slug/trend/..." is a strong signal.
        const trendLinkRegex = new RegExp(`href="/${slug}/trend/([^"]+)/">([^<]+)</a>`, 'g');
        let match;

        // We also want volume if possible. It usually follows the link.
        // Let's try a broader regex for row capturing if needed, but simple link extraction is safer MVP.
        // We can check if "20K+" or similar follows.

        // Set to dedup
        const seenTerms = new Set();

        const rowRegex = new RegExp(`<tr[\\s\\S]*?href="/${slug}/trend/([^"]+)/">([^<]+)</a>[\\s\\S]*?class="amount">([^<]*)<`, 'g');
        // If table structure:
        // <tr>...<a ...>Term</a>...<td class="amount">50K+</td>...</tr>

        let rowMatch;
        while ((rowMatch = rowRegex.exec(html)) !== null) {
            if (terms.length >= n_terms) break;

            // eslint-disable-next-line no-unused-vars
            const [_, pathPart, termRaw, volRaw] = rowMatch;
            const term = termRaw.replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();

            if (!seenTerms.has(term)) {
                seenTerms.add(term);
                terms.push({
                    rank: terms.length + 1,
                    term: term,
                    volume_text: volRaw.trim() || 'Wait...',
                    url: `https://getdaytrends.com/${slug}/trend/${pathPart}/`
                });
            }
        }

        // Fallback: If table parsing provided 0 terms (DOM changed?), try generic link hunting
        if (terms.length === 0) {
            while ((match = trendLinkRegex.exec(html)) !== null) {
                if (terms.length >= n_terms) break;
                const term = match[2].replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
                if (!seenTerms.has(term)) {
                    seenTerms.add(term);
                    terms.push({
                        rank: terms.length + 1,
                        term: term,
                        volume_text: '?',
                        url: `https://getdaytrends.com/${slug}/trend/${match[1]}/`
                    });
                }
            }
        }

        return {
            ok: terms.length > 0,
            fetched_at: new Date().toISOString(),
            source_url: url,
            terms: terms
        };

    } catch (err) {
        return { ok: false, err: err.message };
    }
}

/**
 * Main Fetch Function
 * @param {Object} opts
 * @param {string[]} opts.iso2List
 * @param {number} opts.nTerms
 * @param {number} opts.concurrency
 * @returns {Promise<Object>}
 */
export async function fetchGetDayTrends({ iso2List, nTerms = 20, concurrency = 3 }) {
    const isoMap = await loadCountryMap();
    const result = {
        provider: "getdaytrends",
        fetched_at: new Date().toISOString(),
        n_terms: nTerms,
        countries: {}
    };

    // Queue processing
    const queue = [...iso2List];
    const activeWorkers = [];

    // Worker function
    const worker = async () => {
        while (queue.length > 0) {
            const iso2 = queue.shift();
            const name = isoMap[iso2];
            const slug = getSlug(iso2, name);

            // Random delay 200-500ms before request to be polite
            await delay(200 + Math.random() * 300);

            const r = await fetchCountryTrends(iso2, slug, nTerms);
            result.countries[iso2] = r;

            // console.log(`[AIR] ${iso2}: ${r.ok ? `OK (${r.terms.length})` : `FAIL (${r.err})`}`);
        }
    };

    // Start workers
    const workers = Array(Math.min(concurrency, queue.length)).fill(null).map(() => worker());
    await Promise.all(workers);

    return result;
}
