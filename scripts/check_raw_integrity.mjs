import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ARGS = process.argv.slice(2);
const COMPARE_FLAG_IDX = ARGS.indexOf('--compare');
const COMPARE_FILE = COMPARE_FLAG_IDX !== -1 ? ARGS[COMPARE_FLAG_IDX + 1] : null;

const LATEST_FILE = path.join(__dirname, '../public/data/latest_v4.json');
const OUT_DIR = path.join(__dirname, '../tmp');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function analyze(filePath) {
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const countries = data.countries || {};

    const stats = {
        total: 0,
        counts: { red: 0, orange: 0, yellow: 0, green: 0 },
        lists: { red: [], orange: [], yellow: [], green: [] }
    };

    for (const [iso2, c] of Object.entries(countries)) {
        const level = (c.alert_level || 'green').toLowerCase();
        if (stats.counts[level] !== undefined) {
            stats.counts[level]++;
            stats.lists[level].push(iso2);
        }
        stats.total++;
    }

    // Sort lists
    for (const k of Object.keys(stats.lists)) {
        stats.lists[k].sort();
    }

    return stats;
}

console.log(`Analyzing: ${LATEST_FILE}`);
const currentStats = analyze(LATEST_FILE);

console.log('--- Current RAW Stats ---');
console.log(JSON.stringify(currentStats.counts, null, 2));

fs.writeFileSync(path.join(OUT_DIR, 'raw_counts.json'), JSON.stringify(currentStats.counts, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'raw_lists.json'), JSON.stringify(currentStats.lists, null, 2));
console.log(`Saved output to ${OUT_DIR}`);

if (COMPARE_FILE) {
    console.log(`\nComparing with: ${COMPARE_FILE}`);
    // Check if compare file is partial or full
    let compareStats;
    try {
        compareStats = analyze(COMPARE_FILE);
    } catch (e) {
        console.error(`Failed to analyze compare file: ${e.message}`);
        process.exit(1); // Fail safe
    }

    console.log('--- Comparison (Current vs Snapshot) ---');
    let hasDiff = false;
    for (const level of ['red', 'orange', 'yellow', 'green']) {
        const curr = currentStats.counts[level];
        const prev = compareStats.counts[level];
        const diff = curr - prev;
        console.log(`${level.toUpperCase()}: ${curr} (Prev: ${prev}, Diff: ${diff > 0 ? '+' : ''}${diff})`);
        if (diff !== 0) hasDiff = true;
    }

    if (hasDiff) {
        console.warn('WARNING: Counts do not match snapshot.');
        process.exit(1);
    } else {
        console.log('SUCCESS: Counts match snapshot.');
    }
}
