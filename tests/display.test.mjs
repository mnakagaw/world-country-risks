import test from 'node:test';
import assert from 'node:assert/strict';
import { alertCounts, briefingLines, countryLevel, mapColors } from '../src/display.js';

// Small contract fixture; live publication and mobile interaction are checked separately.
// No private observation files are needed by the public source mirror's tests.
const current = {
    daily_briefing_ops: { en: 'News-derived monitoring signals.', ja: '報道由来の監視信号です。', es: 'Señales de seguimiento derivadas de noticias.' },
    countries: {
        JP: { data_status: 'partial', baseline_status: 'baseline_insufficient', surge_r: { level: 'Unknown', max_ratio_active: null } },
        BR: { data_status: 'unknown', baseline_status: 'baseline_insufficient', surge_r: { level: 'Unknown', max_ratio_active: null } }
    }
};

test('partial snapshot remains unknown in R-INDEX, rather than stable or zero-risk', () => {
    const counts = alertCounts(current.countries, 'surge_r');
    assert.equal(counts.unknown, Object.keys(current.countries).length);
    assert.equal(counts.green, 0);
    assert.equal(counts.red + counts.orange + counts.yellow, 0);
    for (const palette of Object.values(mapColors)) assert.notEqual(palette.unknown, palette.green);
});

test('v2 multilingual strings and legacy array/string briefings are all readable', () => {
    for (const language of ['en', 'ja', 'es']) {
        for (const mode of ['raw', 'surge_r', 'surge']) assert.deepEqual(briefingLines(current, mode, language), [current.daily_briefing_ops[language]]);
    }
    assert.deepEqual(briefingLines({ daily_briefing: { ja: [' 一行目 ', '二行目'] } }, 'raw', 'ja'), ['一行目', '二行目']);
    assert.deepEqual(briefingLines({ daily_briefing_ja: '旧版の本文' }, 'raw', 'ja'), ['旧版の本文']);
    assert.deepEqual(briefingLines({}, 'raw', 'ja'), []);
});

test('unknown and zero-score records do not acquire top-ranked warning colors', () => {
    assert.equal(countryLevel(undefined, 'raw'), 'unknown');
    assert.equal(countryLevel({ data_status: 'unknown', surge: { score: 10, rank: 1 } }, 'surge'), 'unknown');
    assert.equal(countryLevel({ surge: { score: 0, rank: 1 } }, 'surge'), 'unknown');
    assert.equal(countryLevel({ data_status: 'observed', alert_level: 'green' }, 'raw'), 'green');
    assert.equal(countryLevel({ data_status: 'partial', alert_level: 'red' }, 'raw'), 'red');
    assert.equal(countryLevel({ data_status: 'partial', alert_level: 'unknown', surge: { score: 1, rank: 1 } }, 'surge'), 'unknown');
});
