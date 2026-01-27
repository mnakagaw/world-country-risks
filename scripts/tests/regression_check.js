
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LATEST_FILE = path.resolve(__dirname, '../../public/data/latest_v4.json');

async function runRegression() {
    console.log("Running Regression Test on:", LATEST_FILE);

    if (!fs.existsSync(LATEST_FILE)) {
        console.error("FAILED: latest_v4.json does not exist.");
        process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(LATEST_FILE, 'utf-8'));
    const countries = data.countries || {};
    const keys = Object.keys(countries);

    console.log(`Loaded ${keys.length} countries.`);

    const errors = [];

    // 1. Count Check
    if (keys.length < 200) {
        errors.push(`CRITICAL: Country count too low (${keys.length} < 200)`);
    }

    // 2. Level Distribution
    const levels = { red: 0, orange: 0, yellow: 0, green: 0 };
    keys.forEach(k => levels[countries[k].alert_level]++);
    console.log("Level Distribution:", levels);

    if (levels.red + levels.orange + levels.yellow === 0) {
        errors.push("CRITICAL: Zero risk countries found (All Green).");
    }

    // 3. Sports Filter Check (UY Specific)
    const uy = countries['UY'];
    if (uy) {
        const jsonStr = JSON.stringify(uy).toLowerCase();
        if (jsonStr.includes('yahoo sports')) {
            errors.push("FAILED: Yahoo Sports found in Uruguay data.");
        } else {
            console.log("PASS: Uruguay is clean of Yahoo Sports.");
        }
    }

    // 4. R-Types Check (Feature Verification)
    let foundRTypes = false;
    for (const k of keys) {
        const c = countries[k];
        if (c.sources && c.sources.some(s => s.r_types && Array.isArray(s.r_types) && s.r_types.length > 0)) {
            foundRTypes = true;
            console.log(`PASS: Found R-Types in ${k} sources.`);
            break;
        }
    }
    // Note: R-types only exist for countries using Fallback Events or specific flows. 
    // It might not be in EVERY country. Just checking existence.
    if (!foundRTypes) {
        console.warn("WARNING: No 'r_types' found in any country sources. (Feature might not be active yet or no fallback countries triggered)");
        // Do not fail for this
    }

    // REPORT
    if (errors.length > 0) {
        console.error("\nREGRESSION FAILED WITH ERRORS:");
        errors.forEach(e => console.error(`- ${e}`));
        process.exit(1);
    } else {
        console.log("\nREGRESSION PASSED.");
        process.exit(0);
    }
}

runRegression();
