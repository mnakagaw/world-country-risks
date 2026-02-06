
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to generate dates
const generateDates = (startDaysBack, endDaysBack) => {
    const dates = [];
    const today = new Date();
    for (let i = startDaysBack; i >= endDaysBack; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
};

// Plan: Last 5 weeks = 35 days
// Days 35-15: Score Only (Save cost/time)
// Days 14-0: Full AI (Rich data for recent context)

const phase1Dates = generateDates(35, 15);
const phase2Dates = generateDates(14, 0);

console.log(`[BACKFILL] Plan (Last 5 Weeks):`);
console.log(`Phase 1 (Score Only | Days 35-15): ${phase1Dates.length} days`);
console.log(`Phase 2 (Full AI   | Days 14-0 ): ${phase2Dates.length} days`);

const runBatch = (dates, disableAI) => {
    for (const date of dates) {
        console.log(`\n----------------------------------------`);
        console.log(`[BACKFILL] Generating ${date} (AI_DISABLED=${disableAI})...`);
        try {
            execSync(`node scripts/generate_daily.js`, {
                stdio: 'inherit',
                env: {
                    ...process.env,
                    TARGET_DATE: date,
                    DISABLE_GKG: disableAI ? '1' : '0',
                    DISABLE_GEMINI: disableAI ? '1' : '0'
                }
            });
            console.log(`[BACKFILL] Success: ${date}`);
        } catch (err) {
            console.error(`[BACKFILL] FAILED: ${date}`);
        }
    }
};

// EXECUTE
if (phase1Dates.length > 0) {
    console.log("\n[BACKFILL] Starting Phase 1 (Score Only)...");
    runBatch(phase1Dates, true);
}

if (phase2Dates.length > 0) {
    console.log("\n[BACKFILL] Starting Phase 2 (Full AI)...");
    runBatch(phase2Dates, false);
}

console.log("\n[BACKFILL] 5-Week Backfill Complete.");
