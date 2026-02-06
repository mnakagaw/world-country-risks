
import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getIsoWeek, weekKeyToInt, getWeeksFromEnum, getEnumFromWeeks, RANGE_ENUMS } from '../utils/dateUtils';

/* ================= UTILS ================= */
const getLevels = (paperMode) => ({
    'Red': { val: 3, label: 'Red', color: '#ff3b3b' },
    'Orange': { val: 2, label: 'Orange', color: '#ff8c00' },
    'Yellow': { val: 1, label: 'Yellow', color: '#ffd700' },
    'None': { val: 0, label: 'None', color: paperMode ? '#f0f0f0' : '#2d333b' },
    'NoData': { val: -1, label: 'No Data', color: paperMode ? '#d0d0d0' : '#444' }
});

/* ================= COMPONENTS ================= */

// 1. HEADER & CONTROLS
function DetailHeader({ iso2, meta, config, setConfig, paperMode, setPaperMode, warnings }) {
    if (!meta) return <div className="detail-header">Loading...</div>;

    const t0Week = getIsoWeek(config.anchorDate || new Date());

    const handleRangeChange = (e) => {
        const newEnum = e.target.value;
        const weeks = getWeeksFromEnum(newEnum);
        setConfig(prev => ({ ...prev, rangeEnum: newEnum, range: weeks }));
    };

    const handleDateChange = (e) => {
        setConfig(prev => ({ ...prev, anchorDate: e.target.value || new Date().toISOString().split('T')[0] }));
    };

    return (
        <div className="detail-header" style={{
            padding: '1rem',
            borderBottom: '1px solid #444',
            background: paperMode ? '#fff' : '#1e2124',
            color: paperMode ? '#000' : '#eee',
            transition: 'all 0.3s ease'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: '800' }}>
                        {iso2} - Rotberg INDEX <span style={{ fontWeight: '300', opacity: 0.7 }}>(Historical Analysis)</span>
                    </h2>
                    <div style={{ fontSize: '0.85rem', color: paperMode ? '#666' : '#aaa', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>Updated: {new Date(meta.generated_at).toLocaleDateString()} | Data coverage: <span style={{ fontWeight: 'bold', color: paperMode ? '#000' : '#fff' }}>{meta.weeks_available || meta.weeks_total || 0}</span>/{meta.weeks_total || 52} weeks</span>
                        {meta.anomalies?.includes('LOW_COVERAGE') && (
                            <span style={{ background: '#444', color: '#aaa', fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 'bold' }}>Low coverage</span>
                        )}
                        {warnings.map((w, i) => (
                            <span key={i} style={{ background: '#dda15e', color: '#000', fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>{w}</span>
                        ))}
                    </div>
                </div>

                <div className="controls" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>

                    {/* Date Picker (Anchor T0) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>T0:</label>
                        <input
                            type="date"
                            value={config.anchorDate}
                            onChange={handleDateChange}
                            style={{
                                background: paperMode ? '#fff' : '#333',
                                color: paperMode ? '#000' : '#fff',
                                border: '1px solid #555',
                                padding: '4px',
                                borderRadius: '4px',
                                fontSize: '0.8rem'
                            }}
                        />
                        <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>({t0Week})</span>
                    </div>

                    <button
                        onClick={() => setPaperMode(!paperMode)}
                        style={{
                            background: paperMode ? '#f0f0f0' : '#333',
                            color: paperMode ? '#000' : '#fff',
                            border: `1px solid ${paperMode ? '#ccc' : '#555'}`,
                            padding: '4px 12px',
                            cursor: 'pointer',
                            borderRadius: '4px',
                            fontSize: '0.8rem',
                            fontWeight: 'bold'
                        }}
                    >
                        {paperMode ? '🌙' : '📄'}
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem' }}>Range:</label>
                        <select
                            value={config.rangeEnum}
                            onChange={handleRangeChange}
                            style={{ background: paperMode ? '#fff' : '#333', color: paperMode ? '#000' : '#fff', border: '1px solid #555', padding: '4px' }}
                        >
                            <option value="12w">12 Weeks</option>
                            <option value="26w">26 Weeks</option>
                            <option value="52w">52 Weeks</option>
                            <option value="3y">3 Years</option>
                            <option value="5y">5 Years</option>
                        </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem' }}>View:</label>
                        <select
                            value={config.view}
                            onChange={(e) => setConfig({ ...config, view: e.target.value })}
                            style={{ background: paperMode ? '#fff' : '#333', color: paperMode ? '#000' : '#fff', border: '1px solid #555', padding: '4px' }}
                        >
                            <option value="signal">Signal (Discrete)</option>
                            <option value="state">State (Absolute)</option>
                            <option value="intensity">Intensity (Heatmap)</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
    );
}

// 2. SIGNAL VIEW (Matrix)
function SignalView({ history, range, paperMode, t }) {
    const LEVELS = getLevels(paperMode);
    // history is already filtered and sliced by parent
    const displayHistory = [...history].reverse();
    const labels = displayHistory.map(h => h.week);

    const getGateColor = (isActive, ratio7, level, thresholds) => {
        if (level === 'NoData' || level === 'nodata' || !level) return LEVELS['NoData'].color;
        if (isActive === undefined) {
            // Backfill fallback
            if (level === 'Red') return '#ff3b3b';
            if (level === 'Orange') return '#ff8c00';
            if (level === 'Yellow') return '#ffd700';
            return LEVELS['None'].color;
        }

        if (!isActive) return paperMode ? '#bbb' : '#555'; // GATED: gray

        const th = thresholds || { yellow: 1.75, orange: 2.75, red: 3.75 };
        if (ratio7 >= th.red) return '#ff3b3b';
        if (ratio7 >= th.orange) return '#ff8c00';
        if (ratio7 >= th.yellow) return '#ffd700';
        return LEVELS['None'].color;
    };

    const overallData = displayHistory.map(h => {
        const sr = h.weekly_surge_r || {};
        const level = sr.level || h.overall_level?.toLowerCase() || 'green';
        const levelColors = {
            'red': '#ff3b3b', 'orange': '#ff8c00', 'yellow': '#ffd700', 'green': LEVELS['None'].color, 'nodata': LEVELS['NoData'].color
        };

        let maxRatio = sr.max_ratio_active;
        if (maxRatio === undefined || maxRatio === null) {
            maxRatio = Math.max(...Object.values(h.ratios || {}), 0);
        }

        return {
            level,
            color: levelColors[level] || LEVELS['None'].color,
            maxRatio,
            activeTypes: sr.active_types || (h.overall_level !== 'None' ? ['Historic'] : [])
        };
    });

    const borderColor = paperMode ? '#ddd' : '#222';
    const textColor = paperMode ? '#333' : '#888';
    const headerColor = paperMode ? '#000' : '#fff';

    return (
        <div className="signal-view" style={{ overflowX: 'auto', padding: '1rem', background: paperMode ? '#fff' : '#111' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', minWidth: range > 52 ? 2000 : 800 }}>
                <thead>
                    <tr>
                        <th style={{ width: 80, color: textColor, textAlign: 'right', paddingRight: '1rem', fontSize: '0.8rem' }}>Week</th>
                        {labels.map((l, idx) => (
                            <th key={l} style={{ fontSize: range > 52 ? '0.45rem' : '0.65rem', color: textColor, padding: '8px 0', textAlign: 'center', borderLeft: `1px solid ${borderColor}` }}>
                                {(range <= 52 || idx % 10 === 0) ? l : ''}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style={{ textAlign: 'right', paddingRight: '1rem', color: headerColor, fontWeight: 'bold' }}>Bundle</td>
                        {overallData.map((od, i) => (
                            <td key={i} style={{ padding: 2 }}>
                                <div
                                    title={`Bundle @ ${labels[i]}\nLevel: ${od.level.toUpperCase()} | Max Ratio: ${od.maxRatio?.toFixed(2) || 'N/A'}`}
                                    style={{
                                        height: 20, background: od.color, borderRadius: 2,
                                        opacity: (od.level === 'green' || od.level === 'nodata') ? 0.3 : 1
                                    }} />
                            </td>
                        ))}
                    </tr>
                    <tr style={{ height: 10 }}></tr>
                    {['R1', 'R2', 'R3', 'R4'].map(rKey => (
                        <tr key={rKey}>
                            <td style={{ textAlign: 'right', paddingRight: '1rem', color: headerColor }}>
                                <div style={{ fontWeight: 'bold' }}>{rKey}</div>
                            </td>
                            {displayHistory.map((h, i) => {
                                const sr = h.weekly_surge_r_by_type?.[rKey];
                                const isActive = sr?.is_active;
                                const ratio7 = sr?.ratio7 || h.ratios?.[rKey] || 0;
                                const level = h.levels?.[rKey] || 'NoData';
                                const bg = getGateColor(isActive, ratio7, level, h.weekly_surge_r?.thresholds);
                                const reason = sr?.reason;
                                const tooltipText = `${rKey} @ ${labels[i]}\nRatio: ${ratio7.toFixed(2)}x\nLevel: ${level}${!isActive && reason && reason !== 'active' ? `\nGate: ${reason}` : ''}`;

                                return (
                                    <td key={i} style={{ padding: 2 }}>
                                        <div
                                            title={tooltipText}
                                            style={{
                                                height: 24, background: bg, borderRadius: 2,
                                                opacity: (level === 'None' || level === 'NoData') ? 0.2 : 0.9,
                                                border: `1px solid ${paperMode ? '#eee' : '#111'}`
                                            }} />
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// 2.5 STATE VIEW
const WEEKLY_ABS_THRESHOLDS = { R1: 2100, R2: 1260, R3: 1050, R4: 1400 };
const STATE_COLOR_THRESHOLDS = { yellow: 1.0, orange: 2.0, red: 3.0 };

function StateView({ history, range, paperMode, t }) {
    const LEVELS = getLevels(paperMode);
    const displayHistory = [...history].reverse();
    const labels = displayHistory.map(h => h.week);

    const getAbsScoreColor = (absScore7, isNoData) => {
        if (isNoData) return LEVELS['NoData'].color;
        if (absScore7 >= STATE_COLOR_THRESHOLDS.red) return '#ff3b3b';
        if (absScore7 >= STATE_COLOR_THRESHOLDS.orange) return '#ff8c00';
        if (absScore7 >= STATE_COLOR_THRESHOLDS.yellow) return '#ffd700';
        return LEVELS['None'].color;
    };

    const bundleData = displayHistory.map(h => {
        let activeCount = 0;
        let maxScore = 0;
        ['R1', 'R2', 'R3', 'R4'].forEach(r => {
            const today7 = h.weekly_surge_r_by_type?.[r]?.today7 || h.counts?.[r] || 0;
            const absScore7 = today7 / WEEKLY_ABS_THRESHOLDS[r];
            if (absScore7 >= STATE_COLOR_THRESHOLDS.yellow) activeCount++;
            if (absScore7 > maxScore) maxScore = absScore7;
        });
        return { activeCount, maxScore, isNoData: (h.levels?.R1 === 'NoData' || !h.levels?.R1) };
    });

    const borderColor = paperMode ? '#ddd' : '#222';
    const textColor = paperMode ? '#333' : '#888';
    const headerColor = paperMode ? '#000' : '#fff';

    return (
        <div className="state-view" style={{ overflowX: 'auto', padding: '1rem', background: paperMode ? '#fff' : '#111' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', minWidth: range > 52 ? 2000 : 800 }}>
                <thead>
                    <tr>
                        <th style={{ width: 80, color: textColor, textAlign: 'right', paddingRight: '1rem', fontSize: '0.8rem' }}>Week</th>
                        {labels.map((l, idx) => (
                            <th key={l} style={{ fontSize: range > 52 ? '0.45rem' : '0.65rem', color: textColor, padding: '8px 0', textAlign: 'center', borderLeft: `1px solid ${borderColor}` }}>
                                {(range <= 52 || idx % 10 === 0) ? l : ''}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style={{ textAlign: 'right', paddingRight: '1rem', color: headerColor, fontWeight: 'bold' }}>Bundle</td>
                        {bundleData.map((bd, i) => (
                            <td key={i} style={{ padding: 2 }}>
                                <div style={{
                                    height: 20, background: getAbsScoreColor(bd.maxScore, bd.isNoData), borderRadius: 2,
                                    opacity: bd.activeCount === 0 ? 0.3 : 1
                                }} title={bd.isNoData ? 'No data' : `Bundle @ ${labels[i]}\nMax abs_score7: ${bd.maxScore.toFixed(2)} | ${bd.activeCount}/4 R-types at Yellow+`} />
                            </td>
                        ))}
                    </tr>
                    <tr style={{ height: 10 }}></tr>
                    {['R1', 'R2', 'R3', 'R4'].map(rKey => (
                        <tr key={rKey}>
                            <td style={{ textAlign: 'right', paddingRight: '1rem', color: headerColor }}>
                                <div style={{ fontWeight: 'bold' }}>{rKey}</div>
                            </td>
                            {displayHistory.map((h, i) => {
                                const today7 = h.weekly_surge_r_by_type?.[rKey]?.today7 || h.counts?.[rKey] || 0;
                                const absScore7 = today7 / WEEKLY_ABS_THRESHOLDS[rKey];
                                const isNoData = !h.levels?.[rKey] || h.levels?.[rKey] === 'NoData';
                                return (
                                    <td key={i} style={{ padding: 2 }}>
                                        <div style={{
                                            height: 24, background: getAbsScoreColor(absScore7, isNoData), borderRadius: 2,
                                            opacity: isNoData ? 0.2 : 0.9,
                                            border: `1px solid ${paperMode ? '#eee' : '#111'}`
                                        }} />
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// 3. INTENSITY VIEW
function IntensityView({ history, range, scale, paperMode, t }) {
    const displayHistory = [...history].reverse();
    const labels = displayHistory.map(h => h.week);
    const borderColor = paperMode ? '#ddd' : '#222';
    const textColor = paperMode ? '#333' : '#888';
    const headerColor = paperMode ? '#000' : '#fff';

    const getColor = (val, lvl) => {
        if (lvl === 'NoData' || !lvl) return paperMode ? '#d0d0d0' : '#444';
        if (val === null || val === undefined) return paperMode ? '#f0f0f0' : '#222';
        if (val < 1.0) return paperMode ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.05)';
        if (val < 1.75) return `rgba(255,215,0, ${0.1 + (val - 1.0) / 0.75 * 0.4})`;
        if (val < 2.75) return `rgba(255,140,0, ${0.5 + (val - 1.75) * 0.4})`;
        return `rgba(255,59,59, ${Math.min(1, 0.6 + (val - 2.75) * 0.4)})`;
    };

    return (
        <div style={{ overflowX: 'auto', padding: '1rem', background: paperMode ? '#fff' : '#111' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', minWidth: range > 52 ? 2000 : 800 }}>
                <thead>
                    <tr>
                        <th style={{ width: 80, color: textColor, textAlign: 'right', paddingRight: '1rem', fontSize: '0.8rem' }}>Week</th>
                        {labels.map((l, idx) => <th key={l} style={{ fontSize: range > 52 ? '0.45rem' : '0.65rem', color: textColor, padding: '8px 0', borderLeft: `1px solid ${borderColor}` }}>{(range <= 52 || idx % 10 === 0) ? l : ''}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {['R1', 'R2', 'R3', 'R4'].map(rKey => (
                        <tr key={rKey}>
                            <td style={{ textAlign: 'right', paddingRight: '1rem', color: headerColor }}>
                                <div style={{ fontWeight: 'bold' }}>{rKey}</div>
                            </td>
                            {displayHistory.map((h, i) => {
                                const val = h.ratios?.[rKey];
                                const lvl = h.levels?.[rKey];
                                return (
                                    <td key={i} style={{ padding: 1 }}>
                                        <div style={{
                                            height: 30, background: getColor(val, lvl),
                                            border: `1px solid ${paperMode ? '#eee' : '#111'}`
                                        }} />
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/* ================= MAIN VIEW ================= */
export default function CountryDetailView({ lang, t, theme }) {
    const { iso2 } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const [data, setData] = useState(null);

    // Initialize state from URL params
    const initialRangeEnum = searchParams.get('range') || '52w';
    const initialAnchor = searchParams.get('base') || new Date().toISOString().split('T')[0];

    // Config State
    const [config, setConfig] = useState({
        rangeEnum: initialRangeEnum,
        range: getWeeksFromEnum(initialRangeEnum),
        view: 'signal',
        scale: 'abs',
        anchorDate: initialAnchor
    });

    const [fetchError, setFetchError] = useState(null);
    const [paperMode, setPaperMode] = useState(theme === 'light');

    // Sync URL when config changes
    useEffect(() => {
        const params = {};
        if (config.anchorDate) params.base = config.anchorDate;
        if (config.rangeEnum) params.range = config.rangeEnum;
        setSearchParams(params, { replace: true });
    }, [config.anchorDate, config.rangeEnum, setSearchParams]);

    useEffect(() => { setPaperMode(theme === 'light'); }, [theme]);

    useEffect(() => {
        setData(null);
        setFetchError(null);

        // Always try to fetch 5y data if range > 52 to ensure we have enough data (naive approach)
        // Optimization: Could check if we already have enough data, but for simplicity always fetch based on max potential need.
        // Actually, let's keep it simple: if range is 3y (156) or 5y (260), fetch 5y file.
        // Also if we use T0 deep in the past, we might need 5y file even if range is small, but for now we rely on range logic.
        // To cover deep past T0, we should probably always prefer 5y file if available, OR logic needs to be smarter.
        // Current logic: If range > 52 use 5y. 
        // Improvement: If logic requires deep history, we should fetch 5y.
        // Let's stick to range-based fetch for now to match verified fix.

        const fetchPaths = config.range > 52
            ? [`./data/history/weekly_5y/${iso2}.json`, `./data/weekly/countries/${iso2}.json`]
            : [`./data/weekly/countries/${iso2}.json`, `./data/history/weekly_5y/${iso2}.json`]; // Fallback to 5y if 52w missing?

        const tryFetch = async (paths) => {
            for (const path of paths) {
                try {
                    const res = await fetch(path);
                    if (res.ok) {
                        const historyData = await res.json();
                        // Also try fetch report if available
                        const reportRes = await fetch(`./data/weekly/_regression_report.json`).catch(() => null);
                        const report = reportRes && reportRes.ok ? await reportRes.json() : null;
                        const anomalies = report?.countries?.[iso2]?.anomalies || [];
                        setData({ ...historyData, anomalies });
                        return;
                    }
                } catch (e) { console.error(`Failed to fetch ${path}`, e); }
            }
            setFetchError("Data not found for this country/range.");
        };

        tryFetch(fetchPaths);
    }, [iso2, config.range]); // Re-fetch only if range bracket changes (e.g. 52 -> 260)

    if (fetchError) return <div style={{ color: 'red', padding: '2rem' }}>Error: {fetchError}</div>;
    if (!data) return <div style={{ padding: '2rem', color: '#fff' }}>Loading data for {iso2}...</div>;

    // --- FILTERING LOGIC ---
    const t0WeekStr = getIsoWeek(config.anchorDate);
    const t0WeekInt = weekKeyToInt(t0WeekStr);

    // Sort data just in case
    const allItems = (data.history || []).sort((a, b) => weekKeyToInt(a.week) - weekKeyToInt(b.week));

    // Check if T0 is beyond latest data
    const lastDataWeekStr = allItems.length > 0 ? allItems[allItems.length - 1].week : '';
    const lastDataWeekInt = weekKeyToInt(lastDataWeekStr);

    const warnings = [];
    let effectiveT0Int = t0WeekInt;

    if (t0WeekInt > lastDataWeekInt && lastDataWeekInt > 0) {
        effectiveT0Int = lastDataWeekInt;
        warnings.push(`T0 clamped to available data (${lastDataWeekStr})`);
    }

    // Filter items <= effective T0
    const relevantItems = allItems.filter(item => weekKeyToInt(item.week) <= effectiveT0Int);

    // Slice the last N items (N = range)
    const displayItems = relevantItems.slice(-config.range);

    return (
        <div className={`country-detail-view ${paperMode ? 'paper-mode' : ''}`} style={{
            minHeight: '100vh', background: paperMode ? '#fff' : '#111', color: paperMode ? '#333' : '#eee', transition: 'all 0.3s ease'
        }}>
            <DetailHeader
                iso2={iso2}
                meta={data}
                config={config}
                setConfig={setConfig}
                paperMode={paperMode}
                setPaperMode={setPaperMode}
                warnings={warnings}
            />
            <div className="view-container">
                {config.view === 'signal' ? (
                    <SignalView history={displayItems} range={config.range} paperMode={paperMode} t={t} />
                ) : config.view === 'state' ? (
                    <StateView history={displayItems} range={config.range} paperMode={paperMode} t={t} />
                ) : (
                    <IntensityView history={displayItems} range={config.range} scale={config.scale} paperMode={paperMode} t={t} />
                )}
            </div>
            <div style={{ padding: '1rem', borderTop: `1px solid ${paperMode ? '#eee' : '#333'}`, textAlign: 'center', opacity: 0.5, fontSize: '0.8rem' }}>
                CONFIDENTIAL - INTERNAL USE ONLY | Generated: {new Date(data.generated_at).toLocaleString()}
            </div>
        </div>
    );
}
