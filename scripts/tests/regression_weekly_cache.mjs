import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

// [P0] Validate r_definitions.json vs weekly_query.sql before running
try {
    console.log('[PRE-CHECK] Validating R-definitions vs SQL...');
    execSync('node scripts/tests/validate_rdefs_vs_weekly_sql.mjs', {
        stdio: 'inherit',
        cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    });
} catch (err) {
    console.error('[FATAL] R-definitions validation failed. Fix discrepancies before running regression tests.');
    process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Config
const DATA_DIR = path.resolve(__dirname, '../../public/data');
const WEEKLY_DIR = path.resolve(DATA_DIR, 'weekly');
const COUNTRIES_DIR = path.resolve(WEEKLY_DIR, 'countries');
const BASELINES_PATH = path.resolve(DATA_DIR, 'baselines/gdelt_r_baselines_5y.json');
const REPORT_PATH = path.resolve(WEEKLY_DIR, '_regression_report.json');

const THRESHOLDS = {
    LOW_COVERAGE: 40,
    HIGH_ZERO_RATIO: 0.25
};

async function main() {
    console.log("[REGRESSION] Starting Weekly Cache Validation...");

    const report = {
        generated_at: new Date().toISOString(),
        summary: {
            total_weeks: 0,
            total_countries_in_index: 0,
            countries_missing: [],
            countries_with_low_coverage: [],
            countries_with_high_zero_ratio: [],
            status: "PASS"
        },
        countries: {}
    };

    // 1. Load Indices & Baselines
    if (!fs.existsSync(WEEKLY_DIR)) {
        console.error("[FAIL] Weekly directory missing.");
        process.exit(1);
    }

    const weeklyIndex = JSON.parse(fs.readFileSync(path.join(WEEKLY_DIR, 'index.json'), 'utf-8'));
    const countryIndex = JSON.parse(fs.readFileSync(path.join(COUNTRIES_DIR, 'index.json'), 'utf-8'));
    const baselineData = JSON.parse(fs.readFileSync(BASELINES_PATH, 'utf-8'));
    const baselineIsos = Object.keys(baselineData.baselines);

    report.summary.total_weeks = weeklyIndex.weeks.length;
    report.summary.total_countries_in_index = Object.keys(countryIndex.countries).length;

    // 2. Check latest_week
    const latestWeek = weeklyIndex.latest_week;
    if (!latestWeek) {
        console.error("[FAIL] index.json missing latest_week field.");
        report.summary.status = "FAIL";
    } else {
        if (!weeklyIndex.weeks.includes(latestWeek)) {
            console.error(`[FAIL] latest_week "${latestWeek}" not found in weeks list.`);
            report.summary.status = "FAIL";
        }
        const latestPath = path.join(WEEKLY_DIR, `${latestWeek}.json`);
        if (!fs.existsSync(latestPath)) {
            console.error(`[FAIL] latest_week file missing: ${latestWeek}.json`);
            report.summary.status = "FAIL";
        }
    }

    // 3. Check Tier A (Weekly Files)
    weeklyIndex.weeks.forEach(w => {
        const fPath = path.join(WEEKLY_DIR, `${w}.json`);
        if (!fs.existsSync(fPath)) {
            console.error(`[FAIL] Tier A file missing: ${w}.json`);
            report.summary.status = "FAIL";
        }
    });

    // 3. Check Tier B (Country Series)
    const processedIsos = Object.keys(countryIndex.countries);

    // Identify Missing Countries
    baselineIsos.forEach(iso => {
        if (!processedIsos.includes(iso)) {
            report.summary.countries_missing.push(iso);
        }
    });

    processedIsos.forEach(iso => {
        const fPath = path.join(COUNTRIES_DIR, `${iso}.json`);
        if (!fs.existsSync(fPath)) {
            console.error(`[FAIL] Tier B file missing: ${iso}.json`);
            report.summary.status = "FAIL";
            return;
        }

        const data = JSON.parse(fs.readFileSync(fPath, 'utf-8'));
        const history = data.history || [];

        let zeroWeeks = 0;
        let availableWeeks = 0;

        history.forEach(h => {
            if (h.overall_level !== 'NoData' && h.levels.R1 !== 'NoData') {
                availableWeeks++;
                const sum = Object.values(h.counts).reduce((a, b) => a + b, 0);
                if (sum === 0) {
                    zeroWeeks++;
                }
            }
        });

        const zeroRatio = availableWeeks > 0 ? zeroWeeks / availableWeeks : 0;

        const metrics = {
            weeks_total: history.length,
            weeks_available: availableWeeks,
            zero_weeks: zeroWeeks,
            zero_ratio: parseFloat(zeroRatio.toFixed(3)),
            anomalies: []
        };

        if (availableWeeks < THRESHOLDS.LOW_COVERAGE) {
            metrics.anomalies.push("LOW_COVERAGE");
            report.summary.countries_with_low_coverage.push(iso);
        }
        if (zeroRatio >= THRESHOLDS.HIGH_ZERO_RATIO) {
            metrics.anomalies.push("HIGH_ZERO_RATIO");
            report.summary.countries_with_high_zero_ratio.push(iso);
        }

        report.countries[iso] = metrics;
    });

    // Status Check
    if (report.summary.countries_with_high_zero_ratio.length > 20) {
        console.warn(`[WARN] High number of countries (${report.summary.countries_with_high_zero_ratio.length}) have excessive zero weeks.`);
        report.summary.status = "FAIL";
    }

    // [NEW] 3-State Logic Check (Gated vs None)
    console.log("[REGRESSION] Verifying 3-State Logic (Gated vs None)...");
    const cleanIsos = ['US', 'DE', 'GB', 'FR'];
    const gatedCandidates = ['VE', 'DK', 'IR'];

    cleanIsos.forEach(iso => {
        const counts = { gated: 0, none: 0, active: 0 };
        const fPath = path.join(COUNTRIES_DIR, `${iso}.json`);
        if (!fs.existsSync(fPath)) return;
        const data = JSON.parse(fs.readFileSync(fPath, 'utf-8'));
        // Check last 8 weeks (32 data points)
        data.history.slice(-8).forEach(h => {
            ['R1', 'R2', 'R3', 'R4'].forEach(r => {
                const typeData = h.weekly_surge_r_by_type?.[r];
                if (!typeData) return;
                if (typeData.is_active) counts.active++;
                else if (typeData.ratio7 >= (h.weekly_surge_r?.thresholds?.yellow || 1.75)) counts.gated++;
                else counts.none++;
            });
        });

        // US/DE/GB/FR should have Very Low/Zero gated in recent weeks
        if (counts.gated > 2) {
            console.error(`[FAIL] ${iso} has too many GATED signals (${counts.gated}/32). Expected mostly NONE.`);
            report.summary.status = "FAIL";
        } else {
            console.log(`[PASS] ${iso} G-rate check: gated=${counts.gated}, none=${counts.none}, active=${counts.active}`);
        }
    });

    gatedCandidates.forEach(iso => {
        const counts = { gated: 0, none: 0, active: 0 };
        const fPath = path.join(COUNTRIES_DIR, `${iso}.json`);
        if (!fs.existsSync(fPath)) return;
        const data = JSON.parse(fs.readFileSync(fPath, 'utf-8'));
        data.history.slice(-12).forEach(h => {
            ['R1', 'R2', 'R3', 'R4'].forEach(r => {
                const typeData = h.weekly_surge_r_by_type?.[r];
                if (!typeData) return;
                if (typeData.is_active) counts.active++;
                else if (typeData.ratio7 >= (h.weekly_surge_r?.thresholds?.yellow || 1.75)) counts.gated++;
                else counts.none++;
            });
        });
        console.log(`[INFO] ${iso} Logic check: gated=${counts.gated}, none=${counts.none}, active=${counts.active}`);
    });

    // 4. Output Summary
    console.log(`[REPORT] Summary:`);
    console.log(`  Weeks: ${report.summary.total_weeks}`);
    console.log(`  Countries: ${report.summary.total_countries_in_index}`);
    console.log(`  Missing: ${report.summary.countries_missing.length} (${report.summary.countries_missing.slice(0, 10).join(', ')}...)`);
    console.log(`  Low Coverage (<${THRESHOLDS.LOW_COVERAGE}w): ${report.summary.countries_with_low_coverage.length}`);
    console.log(`  High Zero Ratio (>${THRESHOLDS.HIGH_ZERO_RATIO}): ${report.summary.countries_with_high_zero_ratio.length}`);

    if (report.summary.countries_with_high_zero_ratio.length > 0) {
        console.log(`  Sample (High Zero): ${report.summary.countries_with_high_zero_ratio.slice(0, 5).join(', ')}`);
    }

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`[DONE] Regression report saved to ${REPORT_PATH}`);

    if (report.summary.status === "FAIL") {
        console.error("[FAIL] Regression tests did not pass critical quality bars.");
        process.exit(1);
    }
}

main().catch(err => {
    console.error("[FATAL]", err);
    process.exit(1);
});
