/**
 * scripts/tests/validate_rdefs_vs_weekly_sql.mjs
 * 
 * Validates that r_definitions.json and weekly_query.sql are in sync.
 * 
 * Logic:
 * - For each R-type with eventCodePrefixes, check that STARTS_WITH(CAST(...), 'prefix') appears in SQL
 * - For eventCodes not covered by any prefix, check they appear in the SQL IN clause
 * - eventCodes covered by a prefix are allowed to be missing from SQL (redundancy allowed)
 * 
 * Exit 0 = OK, Exit 1 = Mismatch detected
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildRCondition } from '../gdelt_bigquery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RDEFS_PATH = path.resolve(__dirname, '../../config/r_definitions.json');
const SQL_PATH = path.resolve(__dirname, '../weekly_query.sql');

function main() {
    console.log('[VALIDATE] Checking r_definitions.json vs weekly_query.sql...');

    // 1. Load files
    let rDefs, sqlContentRaw;
    try {
        rDefs = JSON.parse(fs.readFileSync(RDEFS_PATH, 'utf-8'));
        console.log(`[LOAD] r_definitions.json version: ${rDefs.version}`);
    } catch (err) {
        console.error(`[FATAL] Could not load ${RDEFS_PATH}: ${err.message}`);
        process.exit(1);
    }

    try {
        sqlContentRaw = fs.readFileSync(SQL_PATH, 'utf-8');
        console.log(`[LOAD] weekly_query.sql template loaded (${sqlContentRaw.length} chars)`);
    } catch (err) {
        console.error(`[FATAL] Could not load ${SQL_PATH}: ${err.message}`);
        process.exit(1);
    }

    // Render Template
    const sqlContent = sqlContentRaw
        .replace(/\${R1_CONDITION}/g, buildRCondition(rDefs.R1))
        .replace(/\${R2_CONDITION}/g, buildRCondition(rDefs.R2))
        .replace(/\${R3_CONDITION}/g, buildRCondition(rDefs.R3))
        .replace(/\${R4_CONDITION}/g, buildRCondition(rDefs.R4));

    console.log(`[RENDER] Template rendered for validation.`);

    const errors = [];

    // 2. Check each R-type
    const rTypes = ['R1', 'R2', 'R3', 'R4'];
    const sqlFieldMap = {
        R1: 'r1_security',
        R2: 'r2_living',
        R3: 'r3_governance',
        R4: 'r4_fiscal'
    };

    for (const rType of rTypes) {
        const def = rDefs[rType];
        if (!def) {
            errors.push(`${rType}: Missing from r_definitions.json`);
            continue;
        }

        const sqlField = sqlFieldMap[rType];

        // Find the SUM(CASE WHEN...) line that ends with AS <field_name>
        // Match from SUM(CASE WHEN to AS r1_security/r2_living/etc
        const sqlLines = sqlContent.split('\n');
        let sqlLine = '';
        for (const line of sqlLines) {
            if (line.includes(`AS ${sqlField}`)) {
                sqlLine = line;
                break;
            }
        }

        if (!sqlLine) {
            errors.push(`${rType}: Could not find '${sqlField}' in weekly_query.sql`);
            continue;
        }

        console.log(`\n[CHECK] ${rType} (${sqlField}):`);
        console.log(`  SQL: ${sqlLine.trim().substring(0, 80)}...`);
        // 2a. Check eventCodePrefixes
        const prefixes = def.eventCodePrefixes || [];
        for (const prefix of prefixes) {
            // Check for STARTS_WITH(CAST(EventCode AS STRING), 'prefix')
            const prefixPattern = `STARTS_WITH(CAST(EventCode AS STRING), '${prefix}')`;
            if (!sqlLine.includes(prefixPattern)) {
                // Also accept without CAST for backward compat check
                const altPattern = `STARTS_WITH(EventCode, '${prefix}')`;
                if (!sqlLine.includes(altPattern)) {
                    errors.push(`${rType}: Missing prefix '${prefix}' in SQL (expected STARTS_WITH pattern)`);
                } else {
                    console.warn(`  [WARN] Prefix '${prefix}' found without CAST - consider adding CAST for type safety`);
                }
            } else {
                console.log(`  [OK] Prefix '${prefix}' → STARTS_WITH found`);
            }
        }

        // 2b. Check eventCodes not covered by prefixes
        const eventCodes = def.eventCodes || [];
        for (const code of eventCodes) {
            // Check if this code is covered by any prefix
            const coveredByPrefix = prefixes.some(p => code.startsWith(p));

            if (coveredByPrefix) {
                console.log(`  [SKIP] Code '${code}' covered by prefix`);
                continue;
            }

            // Check if code appears in SQL
            if (!sqlLine.includes(`'${code}'`)) {
                errors.push(`${rType}: Missing eventCode '${code}' in SQL (not covered by prefix)`);
            } else {
                console.log(`  [OK] Code '${code}' → found in SQL`);
            }
        }

        // 2c. Check rootCodes (must appear in EventRootCode IN clause)
        const rootCodes = def.rootCodes || [];
        for (const root of rootCodes) {
            // Check for EventRootCode IN (...'root'...)
            const rootPattern = `EventRootCode IN`;
            if (rootCodes.length > 0 && !sqlLine.includes(rootPattern)) {
                errors.push(`${rType}: Missing EventRootCode IN clause for rootCodes`);
                break;
            }
            if (!sqlLine.includes(`'${root}'`)) {
                errors.push(`${rType}: Missing rootCode '${root}' in SQL`);
            } else {
                console.log(`  [OK] RootCode '${root}' → found in SQL`);
            }
        }
    }

    // 3. Report
    console.log('\n' + '='.repeat(60));
    if (errors.length === 0) {
        console.log('[PASS] All definitions in sync!');
        process.exit(0);
    } else {
        console.error(`[FAIL] ${errors.length} mismatch(es) found:\n`);
        errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
        process.exit(1);
    }
}

main();
