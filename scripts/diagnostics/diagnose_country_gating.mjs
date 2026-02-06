import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
    const args = process.argv.slice(2);
    const iso2 = args[args.indexOf('--iso2') + 1] || 'CR';
    const weeksLimit = parseInt(args[args.indexOf('--weeks') + 1]) || 52;

    console.log(`[DIAGNOSTICS] Analyzing Gating for ${iso2} (Last ${weeksLimit} weeks)`);

    const dataDir = path.resolve(__dirname, '../../public/data');
    const weeklyPath = path.join(dataDir, `weekly/countries/${iso2}.json`);
    const historyPath = path.join(dataDir, `history/latam33_5y/${iso2}.json`);

    if (!fs.existsSync(weeklyPath) && !fs.existsSync(historyPath)) {
        console.error(`Data files not found for ${iso2}`);
        process.exit(1);
    }

    const weeklyData = fs.existsSync(weeklyPath) ? JSON.parse(fs.readFileSync(weeklyPath, 'utf-8')) : null;
    const historyData = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf-8')) : null;

    const combinedHistory = historyData ? historyData.history : (weeklyData ? weeklyData.history : []);
    const recentHistory = combinedHistory.slice(Math.max(0, combinedHistory.length - weeksLimit));

    const stats = {
        total_weeks: recentHistory.length,
        reasons: {}, // reason -> count
        r_type_reasons: { R1: {}, R2: {}, R3: {}, R4: {} },
        raw_highlights: [], // weeks where raw_level > None but gated
        volume: { min: Infinity, max: 0, sum: 0, count: 0 }
    };

    recentHistory.forEach(h => {
        const evCount = h.event_count || 0;
        stats.volume.min = Math.min(stats.volume.min, evCount);
        stats.volume.max = Math.max(stats.volume.max, evCount);
        stats.volume.sum += evCount;
        stats.volume.count++;

        let weekHasGatedColor = false;

        ['R1', 'R2', 'R3', 'R4'].forEach(r => {
            const sr = h.weekly_surge_r_by_type?.[r];
            if (!sr) return;

            const reason = sr.is_active ? 'active' : (sr.reason || 'unknown');
            const isActive = sr.is_active;
            const ratio7 = sr.ratio7 || 0;
            const rawLevel = h.levels?.[r] || 'None';

            stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
            stats.r_type_reasons[r][reason] = (stats.r_type_reasons[r][reason] || 0) + 1;

            if (!isActive && rawLevel !== 'None' && rawLevel !== 'NoData') {
                stats.raw_highlights.push({
                    week: h.week,
                    r,
                    rawLevel,
                    ratio7: ratio7.toFixed(2),
                    reason,
                    evCount
                });
            }
        });
    });

    stats.volume.avg = stats.volume.sum / stats.volume.count;

    console.log(`\n--- VOLUME STATS ---`);
    console.log(`Avg Weekly Event Count: ${stats.volume.avg.toFixed(1)}`);
    console.log(`Min: ${stats.volume.min}, Max: ${stats.volume.max}`);

    console.log(`\n--- GATING REASONS (OVERALL) ---`);
    Object.entries(stats.reasons).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
        console.log(`${k}: ${v}`);
    });

    console.log(`\n--- GATING REASONS (BY R-TYPE) ---`);
    ['R1', 'R2', 'R3', 'R4'].forEach(r => {
        const rStats = Object.entries(stats.r_type_reasons[r]).map(([k, v]) => `${k}:${v}`).join(', ');
        console.log(`${r}: ${rStats}`);
    });

    console.log(`\n--- RAW HIGHLIGHTS (GATED BUT POTENTIAL) ---`);
    stats.raw_highlights.slice(0, 10).forEach(x => {
        console.log(`Week ${x.week} | ${x.r} | Raw:${x.rawLevel} (${x.ratio7}x) | Gatedby:${x.reason} | Vol:${x.evCount}`);
    });

    // Cross-country volume comparison
    console.log(`\n--- LATAM33 CROSS-COUNTRY VOLUME COMPARISON ---`);
    const latamIndex = JSON.parse(fs.readFileSync(path.join(dataDir, 'history/latam33_5y/index.json'), 'utf-8'));
    const comparison = [];
    for (const c of latamIndex.countries) {
        const cPath = path.join(dataDir, `history/latam33_5y/${c.iso2}.json`);
        if (fs.existsSync(cPath)) {
            const cData = JSON.parse(fs.readFileSync(cPath, 'utf-8'));
            const lastWeek = cData.history[cData.history.length - 1];
            comparison.push({ iso2: c.iso2, event_count: lastWeek.event_count });
        }
    }
    comparison.sort((a, b) => b.event_count - a.event_count);
    console.log(`Rank | ISO2 | Event Count (Latest Week)`);
    comparison.forEach((c, i) => {
        const mark = c.iso2 === iso2 ? ' <--- TARGET' : '';
        if (i < 5 || i > comparison.length - 6 || c.iso2 === iso2) {
            console.log(`${(i + 1).toString().padStart(4)} | ${c.iso2}   | ${c.event_count}${mark}`);
        } else if (i === 5) {
            console.log(`...`);
        }
    });

}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
