import fs from 'fs';
import path from 'path';

const debugDir = './weekly_debug';
const beforeDir = './weekly_debug/before';
const countries = ['DK', 'IR', 'VE', 'UA', 'US', 'DE', 'GB', 'FR'];

console.log('| Country | Period | Active (Before) | Active (After) | Change | True Gated (New Definition) | Non-Gated (Low Signal) | Status |');
console.log('| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |');

for (const iso of countries) {
    const afterFile = path.join(debugDir, `${iso}.json`);
    const beforeFile = path.join(beforeDir, `${iso}.json`);

    let afterData = [];
    if (fs.existsSync(afterFile)) {
        afterData = JSON.parse(fs.readFileSync(afterFile, 'utf-8'));
    }

    let beforeData = [];
    if (fs.existsSync(beforeFile)) {
        beforeData = JSON.parse(fs.readFileSync(beforeFile, 'utf-8'));
    }

    const countActive = (data) => data.filter(e => e.isActive).length;
    const countTrueGated = (data) => data.filter(e => !e.isActive && e.ratio7 >= 1.75).length;
    const countLowSignal = (data) => data.filter(e => !e.isActive && e.ratio7 < 1.75).length;

    const activeAfter = countActive(afterData);
    const activeBefore = fs.existsSync(beforeFile) ? countActive(beforeData) : 'N/A';

    const trueGatedAfter = countTrueGated(afterData);
    const lowSignalAfter = countLowSignal(afterData);

    const totalAfter = afterData.length || 1;
    const trueGatedRate = ((trueGatedAfter / totalAfter) * 100).toFixed(1) + '%';
    const lowSignalRate = ((lowSignalAfter / totalAfter) * 100).toFixed(1) + '%';

    const change = (typeof activeBefore === 'number') ? (activeAfter - activeBefore) : '-';
    const diffText = change > 0 ? `+${change}` : change;

    let status = 'Stable';
    if (change > 0) status = 'Improved';
    if (iso === 'UA') status = 'Baseline-limited';
    if (['US', 'DE', 'GB', 'FR'].includes(iso)) status = 'Clean (Blank)';

    console.log(`| ${iso} | 8 weeks | ${activeBefore} | ${activeAfter} | ${diffText} | ${trueGatedRate} | ${lowSignalRate} | ${status} |`);
}
