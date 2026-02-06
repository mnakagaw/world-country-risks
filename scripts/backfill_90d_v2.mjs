
import { execSync, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import util from 'util';

const execPromise = util.promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../public/data');

// Configuration
const DAYS_TOTAL = 90;
const DAYS_FULL_AI = 35; // Last 5 weeks (approx 35 days)
const PHASE1_START = DAYS_TOTAL;
const PHASE1_END = DAYS_FULL_AI + 1;
const PHASE2_START = DAYS_FULL_AI;
const PHASE2_END = 0;

// Date Generator (Oldest to Newest for correct History/VolJump build)
const generateDatesAscending = () => {
    const dates = [];
    const today = new Date();
    // Start from oldest (90 days ago) to newest (0 days ago)
    for (let i = DAYS_TOTAL; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        dates.push({
            daysAgo: i,
            dateStr: d.toISOString().split('T')[0],
            mode: i > DAYS_FULL_AI ? 'SCORE_ONLY' : 'FULL_AI'
        });
    }
    return dates;
};

// Verification Checks
const verifyResults = () => {
    console.log('\n[VERIFY] Running post-execution checks...');
    let healthy = true;

    // 1. Check latest_v4.json
    try {
        const latestPath = path.resolve(DATA_DIR, 'latest_v4.json');
        if (fs.existsSync(latestPath)) {
            const latest = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
            if (!latest.date || !latest.countries || Object.keys(latest.countries).length < 200) {
                console.error(`[FAIL] latest_v4.json invalid or too small (${Object.keys(latest.countries || {}).length} countries)`);
                healthy = false;
            } else {
                console.log(`[PASS] latest_v4.json seems valid (Date: ${latest.date}, Countries: ${Object.keys(latest.countries).length})`);
            }
        } else {
            console.error(`[FAIL] latest_v4.json not found.`);
            healthy = false;
        }
    } catch (e) {
        console.error(`[FAIL] Error checking latest_v4.json: ${e.message}`);
        healthy = false;
    }

    // 2. Check History
    try {
        const histPath = path.resolve(DATA_DIR, 'v4_history_30d.json');
        if (fs.existsSync(histPath)) {
            const hist = JSON.parse(fs.readFileSync(histPath, 'utf-8'));
            const dates = Object.keys(hist);
            console.log(`[PASS] v4_history_30d.json contains ${dates.length} days.`);
            // Check for recent dates
            const todayStr = new Date().toISOString().split('T')[0];
            if (!dates.includes(todayStr) && !dates.some(d => d > new Date(Date.now() - 86400000 * 2).toISOString().split('T')[0])) {
                console.warn(`[WARN] History might be stale (Latest entry: ${dates.sort().pop()})`);
            }
        } else {
            console.error(`[FAIL] v4_history_30d.json not found.`);
            healthy = false;
        }
    } catch (e) {
        console.error(`[FAIL] Error checking history: ${e.message}`);
        healthy = false;
    }

    // 3. Weekly consistency (Basic Check)
    // Just verify weekly directory exists and contains files
    try {
        const weeklyDir = path.resolve(DATA_DIR, 'weekly/countries');
        if (fs.existsSync(weeklyDir)) {
            const files = fs.readdirSync(weeklyDir);
            if (files.length > 50) {
                console.log(`[PASS] Weekly directory exists with ${files.length} files. (Note: Run refresh_weekly_gating if logic changed)`);
            } else {
                console.warn(`[WARN] Weekly directory seems empty or sparse (${files.length} files).`);
            }
        }
    } catch (e) {
        console.warn(`[WARN] Weekly check failed: ${e.message}`);
    }

    return healthy;
};

// Main Execution Loop
async function run() {
    const queue = generateDatesAscending();
    console.log(`[BACKFILL] Plan: ${queue.length} days (Oldest -> Newest)`);
    console.log(` - Phase 1 (Score Only): Days ${PHASE1_START}-${PHASE1_END} (Older)`);
    console.log(` - Phase 2 (Full AI):    Days ${PHASE2_START}-${PHASE2_END} (Recent)`);

    let totalBytes = 0;
    let errors = 0;

    for (const item of queue) {
        const { daysAgo, dateStr, mode } = item;
        const disableAI = mode === 'SCORE_ONLY';

        console.log(`\n----------------------------------------------------------------`);
        console.log(`[STEP] Processing ${dateStr} (T-${daysAgo}d) | Mode: ${mode}`);

        try {
            // Run generate_daily
            const cmd = `node scripts/generate_daily.js`;
            const env = {
                ...process.env,
                TARGET_DATE: dateStr,
                DISABLE_GEMINI: disableAI ? '1' : '0',
                DISABLE_GKG: disableAI ? '1' : '0' // Also skip GKG for older score-only to save cost
            };

            // Using execPromise to capture stdout easily
            const { stdout, stderr } = await execPromise(cmd, { env, maxBuffer: 1024 * 1024 * 10 }); // 10MB buffer

            // Parse output for Cost/Bytes
            const lines = stdout.split('\n');
            let runBytes = 0;
            lines.forEach(line => {
                // Look for: [COST] Events Query: 0.1234 GB scanned...
                // OR raw logic if generate_daily doesn't output extracted bytes directly, 
                // but we saw gdelt_bigquery.js logs "[COST] ... scanned, ~$..."

                // Regex for "X GB scanned" or "totalBytesProcessed" if raw log
                // gdelt_bigquery.js: console.log(`[COST] Events Query: ${gbProcessed} GB scanned, ~$${estimatedCostUsd} USD`);
                // and: console.log(`[COST] GKG Query: ...`)

                if (line.includes('[COST]')) {
                    // Try to extract GB
                    const gbMatch = line.match(/([\d\.]+)\s*GB scanned/);
                    if (gbMatch) {
                        const gb = parseFloat(gbMatch[1]);
                        runBytes += gb * 1024 * 1024 * 1024;
                    }
                    console.log(`  > ${line.trim()}`); // Echo cost line
                }
            });

            totalBytes += runBytes;
            const mb = (runBytes / (1024 * 1024)).toFixed(2);
            console.log(`[DONE] ${dateStr} - Processed approx ${mb} MB`);

            // Check for critical errors in stdout/stderr
            if (stderr && stderr.length > 0) {
                // Filter out non-critical warnings
                const critical = stderr.split('\n').filter(l => l.includes('Error') || l.includes('FAIL') || l.includes('CRITICAL'));
                if (critical.length > 0) {
                    console.warn(`[WARN] Stderr output:`, critical.join('\n'));
                }
            }

        } catch (err) {
            console.error(`[ERROR] Failed processing ${dateStr}:`);
            console.error(err.message);
            errors++;
        }
    }

    console.log(`\n================================================================`);
    console.log(`[SUMMARY] Backfill Complete.`);
    console.log(` - Total Bytes Processed: ${(totalBytes / (1024 * 1024 * 1024)).toFixed(4)} GB`);
    console.log(` - Errors: ${errors}`);

    verifyResults();

    if (errors === 0) {
        console.log(`[SUCCESS] DoD met: No errors.`);
        process.exit(0);
    } else {
        console.error(`[FAIL] DoD not met: ${errors} errors occurred.`);
        process.exit(1);
    }
}

run();
