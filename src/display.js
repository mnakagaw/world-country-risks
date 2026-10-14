const levels = new Set(['red', 'orange', 'yellow', 'green']);

// One display state for the map, counts and country list. Missing is never green.
export function countryLevel(country, mode) {
    if (country?.evaluation && typeof country.monitoring_level === 'string') {
        return levels.has(country.monitoring_level) ? country.monitoring_level : 'unknown';
    }
    if (!country || country.data_status && !['observed', 'partial'].includes(country.data_status)) return 'unknown';
    if (mode === 'surge_r') {
        if (country.baseline_status === 'baseline_insufficient') return 'unknown';
        const level = country.surge_r?.level?.toLowerCase();
        return levels.has(level) ? level : 'unknown';
    }
    if (mode === 'surge') {
        if (country.data_status && country.alert_level === 'unknown') return 'unknown';
        const { rank, score } = country.surge || {};
        if (!Number.isFinite(rank) || rank < 1 || !Number.isFinite(score) || score <= 0) return 'unknown';
        return rank <= 10 ? 'red' : rank <= 20 ? 'orange' : rank <= 40 ? 'yellow' : 'green';
    }
    const level = (mode === 'index' ? country.index?.level : country.alert_level)?.toLowerCase();
    return levels.has(level) ? level : 'unknown';
}

export function monitoringMethod(country,t) {
    const method=country?.evaluation?.method;
    return method==='accepted-functional-impact-v2' ? t.methods.verified :
        method==='initial-plus-matched-comparison-v2' ? t.methods.paired : t.methods.initial;
}

export function alertCounts(countries, mode) {
    const counts = { red: 0, orange: 0, yellow: 0, green: 0, unknown: 0 };
    for (const country of Object.values(countries || {})) counts[countryLevel(country, mode)]++;
    return counts;
}

export function briefingLines(data, mode, lang) {
    if (!data) return [];
    const fallback = data.daily_briefing || data.daily_briefing_ops;
    const source = mode === 'surge' ? data.daily_briefing_trending || fallback
        : ['raw', 'surge_r'].includes(mode) ? data.daily_briefing_ops || fallback : fallback;
    const localized = typeof source === 'object' ? source?.[lang] ?? source?.en : source;
    const value = localized ?? data[`daily_briefing_${lang}`] ?? data.daily_briefing_en;
    return (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
        .filter(line => typeof line === 'string' && line.trim())
        .map(line => line.trim());
}

export const mapColors = {
    dark: { red: '#ee2c2c', orange: '#f57c00', yellow: '#dca01d', green: '#388e3c', unknown: '#3d4654' },
    light: { red: '#ee2c2c', orange: '#f57c00', yellow: '#fbc02d', green: '#388e3c', unknown: '#c7cdd4' }
};
