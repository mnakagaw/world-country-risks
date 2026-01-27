import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DATA_DIR = path.join(__dirname, '../public/data');
const AVAILABLE_DATES_FILE = path.join(PUBLIC_DATA_DIR, 'available_dates.json');

// Args
const ARGS = process.argv.slice(2);
const DAYS_IDX = ARGS.indexOf('--days');
const DAYS_LIMIT = DAYS_IDX !== -1 ? parseInt(ARGS[DAYS_IDX + 1]) : 0;
const DRY_RUN = process.env.DRY_RUN === '1';

if (DRY_RUN) console.log('--- DRY RUN MODE ---');

function getDates() {
    if (fs.existsSync(AVAILABLE_DATES_FILE)) {
        try {
            const dates = JSON.parse(fs.readFileSync(AVAILABLE_DATES_FILE, 'utf8'));
            return DAYS_LIMIT > 0 ? dates.slice(0, DAYS_LIMIT) : dates;
        } catch (e) {
            console.warn('Failed to read available_dates.json, using file scan.');
        }
    }
    const files = fs.readdirSync(PUBLIC_DATA_DIR)
        .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort().reverse()
        .map(f => f.replace('.json', ''));

    return DAYS_LIMIT > 0 ? files.slice(0, DAYS_LIMIT) : files;
}

const dates = getDates();
console.log(`Targeting ${dates.length} files...`);

dates.forEach(date => {
    const filePath = path.join(PUBLIC_DATA_DIR, `${date}.json`);
    if (!fs.existsSync(filePath)) return;

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let modified = false;
    let counts = 0;

    Object.values(data.countries || {}).forEach(c => {
        if (!c.index) {
            // Calculation Logic (same as App.jsx / eval script)
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

            c.index = {
                score: parseFloat(indexScore.toFixed(1)),
                level,
                rawScore: parseFloat(rawScore.toFixed(1)),
                surgeScore: parseFloat(surgeScore.toFixed(1)),
                bundle_count: bundleCount
            };
            modified = true;
            counts++;
        }
    });

    if (modified) {
        if (!DRY_RUN) {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); // 2 space indent to match typical formatting
            console.log(`[UPDATED] ${date}: Backfilled ${counts} countries.`);
        } else {
            console.log(`[DRY-RUN] ${date}: Would backfill ${counts} countries.`);
        }
    } else {
        // console.log(`[SKIP] ${date}: No missing index.`);
    }
});
