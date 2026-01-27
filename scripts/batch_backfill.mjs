import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../public/data');

/**
 * batch_backfill.mjs
 * Generates daily JSON files for the last N days.
 */
async function run() {
    const daysToBackfill = 30;
    const now = new Date();

    for (let i = daysToBackfill - 1; i >= 0; i--) {
        const target = new Date(now);
        target.setDate(now.getDate() - i);
        const dateStr = target.toISOString().split('T')[0];

        const filePath = path.join(DATA_DIR, `${dateStr}.json`);

        const forceRegen = process.env.FORCE_REGEN === 'true';
        if (fs.existsSync(filePath) && !forceRegen) {
            console.log(`[SKIP] ${dateStr}.json already exists. Use FORCE_REGEN=true to overwrite.`);
            continue;
        }

        console.log(`\n=== Backfilling Date: ${dateStr} ===`);

        try {
            // Execute generate_daily with TARGET_DATE env var
            // Full AI mode: Ensure DISABLE_GEMINI is NOT 1
            execSync(`node scripts/generate_daily.js`, {
                env: {
                    ...process.env,
                    TARGET_DATE: dateStr,
                    DISABLE_GEMINI: '0',
                    DISABLE_GKG: '0'
                },
                stdio: 'inherit'
            });
            console.log(`[SUCCESS] Generated data for ${dateStr}`);
        } catch (err) {
            console.error(`[ERROR] Failed to generate data for ${dateStr}:`, err.message);
        }
    }

    console.log('\nBatch backfill complete.');
}

run();
