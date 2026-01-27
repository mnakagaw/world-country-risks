
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

// 1. PHASE 1: Historical Backfill (Days 90 to 15) - SCORING ONLY
// GKG/Gemini Disabled for speed and quota safety
const phase1Dates = generateDates(90, 15);

// 2. PHASE 2: Recent Backfill (Days 14 to 0) - FULL GENERATION
// GKG/Gemini Enabled for recent context
const phase2Dates = generateDates(14, 0);

console.log(`[BACKFILL] Plan:`);
console.log(`Phase 1 (Score Only): ${phase1Dates.length} days (${phase1Dates[0]} to ${phase1Dates[phase1Dates.length - 1]})`);
console.log(`Phase 2 (Full Mode): ${phase2Dates.length} days (${phase2Dates[0]} to ${phase2Dates[phase2Dates.length - 1]})`);

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
            // Continue despite error
        }
    }
};

// EXECUTE
console.log("\n[BACKFILL] Starting Phase 1 (Score Only)...");
runBatch(phase1Dates, true);

console.log("\n[BACKFILL] Starting Phase 2 (Full AI)...");
runBatch(phase2Dates, false);

console.log("\n[BACKFILL] All Phases Complete.");
