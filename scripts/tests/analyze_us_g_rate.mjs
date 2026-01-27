import fs from 'fs';
import path from 'path';

const debugDir = './weekly_debug';
const countries = ['US', 'DE', 'GB', 'FR'];

console.log('| Country | Total Cells | Ratio >= 1.75 && !Active (True Gated) | Ratio < 1.75 (No Signal) | G-rate (as currently reported) |');
console.log('| :--- | :---: | :---: | :---: | :---: |');

for (const iso of countries) {
    const file = path.join(debugDir, `${iso}.json`);
    if (!fs.existsSync(file)) {
        console.log(`| ${iso} | N/A | N/A | N/A | N/A |`);
        continue;
    }

    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const total = data.length;
    const gatedTrue = data.filter(e => e.ratio7 >= 1.75 && !e.isActive).length;
    const noSignal = data.filter(e => e.ratio7 < 1.75).length;
    const active = data.filter(e => e.isActive).length;

    // Current reporting: gated = total - active
    const currentGated = total - active;
    const currentGRate = ((currentGated / total) * 100).toFixed(1) + '%';

    console.log(`| ${iso} | ${total} | ${gatedTrue} | ${noSignal} | ${currentGRate} |`);
}
