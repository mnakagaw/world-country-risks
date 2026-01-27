import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DATA_DIR = path.join(__dirname, '../public/data');
const EVAL_DIR = path.join(PUBLIC_DATA_DIR, 'eval');
const AVAILABLE_DATES_FILE = path.join(PUBLIC_DATA_DIR, 'available_dates.json');
const LATEST_FILE = path.join(PUBLIC_DATA_DIR, 'latest_v4.json');

if (!fs.existsSync(EVAL_DIR)) fs.mkdirSync(EVAL_DIR, { recursive: true });

// --- Helpers for Statistics ---
function getQuantiles(arr) {
    if (!arr || arr.length === 0) return { p50: 0, p90: 0, p95: 0, p99: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const getP = (p) => {
        const idx = Math.ceil(p * sorted.length) - 1;
        return sorted[Math.max(0, idx)];
    };
    return {
        p50: getP(0.50),
        p90: getP(0.90),
        p95: getP(0.95),
        p99: getP(0.99)
    };
}

function calculateIndex(c) {
    if (c.index) return c.index;

    // Same fallback logic just in case
    const scores = c.r_scores_adj || c.r_scores || {};
    const surgeScore = Math.max(
        parseFloat(scores.R1 || 0),
        parseFloat(scores.R2 || 0),
        parseFloat(scores.R3 || 0),
        parseFloat(scores.R4 || 0)
    );

    const bundleCount = c.v4_scoring?.bundles || 0;
    const rawScore = bundleCount * 2.5;
    const indexScore = (rawScore * surgeScore) / 10;

    let level = 'Green';
    if (indexScore >= 6) level = 'Red';
    else if (indexScore >= 3) level = 'Orange';
    else if (indexScore >= 1) level = 'Yellow';

    return {
        score: parseFloat(indexScore.toFixed(1)),
        level,
        surgeScore: parseFloat(surgeScore.toFixed(1))
    };
}

// --- Logic ---

// 1. Get Dates (Priority: available_dates.json -> File Scan)
// But we want to ensure we get MAX 30 days, and rely on file scan if available_dates is short
function getDates() {
    let dates = [];

    // Check available_dates.json first
    if (fs.existsSync(AVAILABLE_DATES_FILE)) {
        try {
            const jsonDates = JSON.parse(fs.readFileSync(AVAILABLE_DATES_FILE, 'utf8'));
            if (Array.isArray(jsonDates)) {
                dates = jsonDates.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
            }
        } catch (e) {
            console.warn(`[WARN] Failed to read ${AVAILABLE_DATES_FILE}: ${e.message}`);
        }
    }

    // Always scan directory to maybe find more recent files not yet in manifest
    // or if manifest is broken/short
    const fileDates = fs.readdirSync(PUBLIC_DATA_DIR)
        .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .map(f => f.replace('.json', ''));

    // Merge unique
    const uniqueDates = new Set([...dates, ...fileDates]);
    return Array.from(uniqueDates).sort().reverse().slice(0, 30);
}

const dates = getDates();
console.log(`Analyzing last ${dates.length} days (Target: 30)...`);
if (dates.length < 30) {
    console.warn(`[WARN] Only found ${dates.length} daily files. Data might be incomplete.`);
}

// 2. Load Latest for reference check
let latestCount = 0;
if (fs.existsSync(LATEST_FILE)) {
    try {
        const latestInfo = JSON.parse(fs.readFileSync(LATEST_FILE, 'utf8'));
        latestCount = Object.keys(latestInfo.countries || {}).length;
        console.log(`Latest (latest_v4.json) Total Countries: ${latestCount}`);
    } catch (e) {/* ignore */ }
}

const results = [];
const aggregated = { green: [], yellow: [], orange: [], red: [] };

dates.forEach(date => {
    const filePath = path.join(PUBLIC_DATA_DIR, `${date}.json`);
    if (!fs.existsSync(filePath)) return;

    let data;
    try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.warn(`[WARN] Skipped corrupt file ${date}.json`);
        return;
    }

    const countries = Object.values(data.countries || {});
    const totalCountries = countries.length;
    const counts = { green: 0, yellow: 0, orange: 0, red: 0 };

    // Arrays for stats
    const indexScores = [];
    const surgeScores = [];

    countries.forEach(c => {
        const idx = calculateIndex(c);
        const lvl = idx.level.toLowerCase();

        if (counts[lvl] !== undefined) counts[lvl]++;

        indexScores.push(idx.score);
        surgeScores.push(idx.surgeScore || 0);
    });

    const sumCounts = counts.green + counts.yellow + counts.orange + counts.red;

    // Warn if total mismatch
    if (sumCounts !== totalCountries) {
        console.warn(`[WARN] ${date}: Total mismatch ${totalCountries} vs Sum ${sumCounts}`);
    }

    // Flag if significant drop from latest (e.g. > 20% drop) or absolute minimum
    let incomplete = false;
    // Condition 1: Absolute Minimum (Safety Rule)
    if (totalCountries < 200) {
        incomplete = true;
    }
    // Condition 2: Relative Drop (20% drop from latest)
    // Only apply if latestCount is valid (e.g. > 100) to avoid false positives on empty latest
    if (latestCount > 100 && totalCountries < latestCount * 0.8) {
        incomplete = true;
    }

    if (incomplete) {
        console.warn(`[INFO] ${date}: Marked as incomplete (Total=${totalCountries}, Latest=${latestCount})`);
    }

    results.push({
        date,
        totalCountries,
        incomplete, // New Flag
        counts,
        quantiles: {
            index: getQuantiles(indexScores),
            surge: getQuantiles(surgeScores)
        }
    });

    if (!incomplete) {
        Object.keys(counts).forEach(k => aggregated[k].push(counts[k]));
    }
});

// Calculate Average / Median of COUNTS (not scores)
// aggregated only contains data from COMPLETE days now
const summary = { avg: {}, median: {} };
const median = arr => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const avg = arr => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

Object.keys(aggregated).forEach(k => {
    const vals = aggregated[k];
    summary.avg[k] = parseFloat(avg(vals).toFixed(1));
    summary.median[k] = median(vals);
});

const output = {
    generated_at: new Date().toISOString(),
    source_days_found: dates.length,
    days_requested: 30,
    days: results,
    summary
};

const outFile = path.join(EVAL_DIR, 'index_distribution_30d.json');
fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
console.log(`Generated distribution to ${outFile}`);

