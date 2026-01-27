/**
 * scoring_diff.mjs - Difference verification test
 * 
 * Primary DoD: Fixed snapshot 100% match
 * Secondary DoD: BigQuery execution ≥90% match
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreAllCountries, loadHistoricalData } from '../scripts/scoring.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ TEST: Fixed Snapshot ============
async function testFixedSnapshot() {
    console.log('='.repeat(60));
    console.log('TEST: Fixed Snapshot 100% Match');
    console.log('='.repeat(60));

    const fixturesDir = path.join(__dirname, 'fixtures');
    const snapshotFiles = fs.readdirSync(fixturesDir).filter(f => f.startsWith('snapshot_') && f.endsWith('.json'));

    if (snapshotFiles.length === 0) {
        console.log('[SKIP] No snapshot files found. Generate one first with: node tests/generate_snapshot.mjs');
        return { passed: false, reason: 'no_fixtures' };
    }

    let allPassed = true;
    const results = [];

    for (const file of snapshotFiles) {
        console.log(`\nTesting: ${file}`);
        const snapshot = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf-8'));

        // Load historical data if present in snapshot
        if (snapshot.historical_data) {
            loadHistoricalData(snapshot.historical_data);
        }

        // Run scoring
        const result = scoreAllCountries(snapshot.gdelt_data);

        // Compare distribution
        const distMatch = JSON.stringify(result.distribution) === JSON.stringify(snapshot.expected.distribution);
        console.log(`  Distribution match: ${distMatch ? '✅' : '❌'}`);
        if (!distMatch) {
            console.log(`    Expected: ${JSON.stringify(snapshot.expected.distribution)}`);
            console.log(`    Actual:   ${JSON.stringify(result.distribution)}`);
            allPassed = false;
        }

        // Compare Yellow+ list
        const expectedYP = new Set(snapshot.expected.yellowPlus || []);
        const actualYP = new Set(result.yellowPlusTop.map(c => c.code));
        const ypMatch = [...expectedYP].every(c => actualYP.has(c)) && [...actualYP].every(c => expectedYP.has(c));
        console.log(`  Yellow+ Top20 match: ${ypMatch ? '✅' : '❌'}`);

        // Compare focus countries (IR/VE)
        let focusMatch = true;
        for (const code of ['IR', 'VE']) {
            const expected = snapshot.expected.focus?.[code];
            const actual = result.results[code];
            if (expected && actual) {
                const levelMatch = expected.level === actual.level;
                console.log(`  ${code} level match: ${levelMatch ? '✅' : '❌'} (expected: ${expected.level}, actual: ${actual.level})`);
                if (!levelMatch) focusMatch = false;
            }
        }

        results.push({
            file,
            distMatch,
            ypMatch,
            focusMatch,
            passed: distMatch && ypMatch && focusMatch
        });

        if (!distMatch || !focusMatch) allPassed = false;
    }

    console.log('\n' + '='.repeat(60));
    console.log(`RESULT: ${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}`);
    console.log('='.repeat(60));

    return { passed: allPassed, results };
}

// ============ TEST: BigQuery Live (Secondary) ============
async function testBigQueryLive() {
    console.log('\n' + '='.repeat(60));
    console.log('TEST: BigQuery Live (Secondary DoD)');
    console.log('='.repeat(60));
    console.log('[INFO] This test requires BigQuery access. Run manually with:');
    console.log('  node scripts/eval_backfill.mjs (single day mode)');
    console.log('\nTolerance criteria:');
    console.log('  - alert_level match: ≥90%');
    console.log('  - Yellow+ list match: ≥85%');
    console.log('  - IR/VE level: 100% match');
    console.log('\nAllowed variance:');
    console.log('  ✅ Delayed articles/boundary dates/source additions');
    console.log('  ❌ Code conversion errors/bundle logic diff/config loading diff');
}

// ============ MAIN ============
async function main() {
    const snapshotResult = await testFixedSnapshot();
    await testBigQueryLive();

    process.exit(snapshotResult.passed ? 0 : 1);
}

main().catch(console.error);
