
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

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
function DetailHeader({ iso2, meta, config, setConfig, paperMode, setPaperMode }) {
    if (!meta) return <div className="detail-header">Loading...</div>;

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
                        <span>Updated: {new Date(meta.generated_at).toLocaleDateString()} | Data coverage: <span style={{ fontWeight: 'bold', color: paperMode ? '#000' : '#fff' }}>{meta.weeks_available || 0}</span>/{meta.weeks_total || 52} weeks</span>
                        {meta.anomalies?.includes('LOW_COVERAGE') && (
                            <span style={{ background: '#444', color: '#aaa', fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 'bold' }}>Low coverage</span>
                        )}
                        {meta.anomalies?.includes('HIGH_ZERO_RATIO') && (
                            <span style={{ background: '#444', color: '#aaa', fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 'bold' }}>Sparse signals</span>
                        )}
                    </div>
                </div>

                <div className="controls" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    {/* Paper Mode Toggle */}
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
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                        }}
                    >
                        {paperMode ? '🌙 Normal View' : '📄 Paper Mode'}
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem' }}>Range:</label>
                        <select
                            value={config.range}
                            onChange={(e) => setConfig({ ...config, range: parseInt(e.target.value) })}
                            style={{ background: paperMode ? '#fff' : '#333', color: paperMode ? '#000' : '#fff', border: '1px solid #555', padding: '4px' }}
                        >
                            <option value={12}>12 Weeks</option>
                            <option value={26}>26 Weeks</option>
                            <option value={52}>52 Weeks</option>
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
                    {config.view === 'intensity' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.8rem' }}>Scale:</label>
                            <select
                                value={config.scale}
                                onChange={(e) => setConfig({ ...config, scale: e.target.value })}
                                style={{ background: paperMode ? '#fff' : '#333', color: paperMode ? '#000' : '#fff', border: '1px solid #555', padding: '4px' }}
                            >
                                <option value="abs">Absolute (Ratio)</option>
                                <option value="pct">Percentile (Relative)</option>
                            </select>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// 2. SIGNAL VIEW (Matrix) - Uses Gate-based weekly_surge_r data
function SignalView({ data, range, paperMode, t }) {
    const LEVELS = getLevels(paperMode);
    const history = data.history.slice(-range).reverse();
    const labels = history.map(h => h.week);

    // Gate-aware color helper
    const getGateColor = (isActive, ratio7, level, thresholds) => {
        if (level === 'NoData' || level === 'nodata') return LEVELS['NoData'].color;
        if (!isActive) return paperMode ? '#bbb' : '#555'; // GATED: gray

        // Active - use threshold to determine color
        const th = thresholds || { yellow: 1.75, orange: 2.75, red: 3.75 };
        if (ratio7 >= th.red) return '#ff3b3b';
        if (ratio7 >= th.orange) return '#ff8c00';
        if (ratio7 >= th.yellow) return '#ffd700';
        return LEVELS['None'].color;
    };

    // Bundle/Overall row uses weekly_surge_r.level
    const overallData = history.map(h => {
        const sr = h.weekly_surge_r || {};
        const level = sr.level || 'green';
        const levelColors = {
            'red': '#ff3b3b',
            'orange': '#ff8c00',
            'yellow': '#ffd700',
            'green': LEVELS['None'].color,
            'nodata': LEVELS['NoData'].color
        };
        return {
            level,
            color: levelColors[level] || LEVELS['None'].color,
            maxRatio: sr.max_ratio_active || 0,
            activeTypes: sr.active_types || []
        };
    });

    const borderColor = paperMode ? '#ddd' : '#222';
    const textColor = paperMode ? '#333' : '#888';
    const headerColor = paperMode ? '#000' : '#fff';

    return (
        <div className="signal-view" style={{ overflowX: 'auto', padding: '1rem', background: paperMode ? '#fff' : '#111', transition: 'background 0.3s' }}>
            {/* UI Annotation */}
            <div style={{ fontSize: '0.7rem', color: textColor, marginBottom: '0.5rem', fontStyle: 'italic' }}>
                Signal View: Colors follow is_active (Gate applied). Intensity view shows pre-gate ratios.
            </div>

            <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', minWidth: range > 26 ? 800 : 'auto' }}>
                <thead>
                    <tr>
                        <th style={{ width: 80, color: textColor, textAlign: 'right', paddingRight: '1rem', fontSize: '0.8rem' }}>Week</th>
                        {labels.map(l => (
                            <th key={l} style={{ fontSize: range > 26 ? '0.55rem' : '0.65rem', color: textColor, padding: '8px 0', textAlign: 'center', borderLeft: `1px solid ${borderColor}` }}>
                                {l}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {/* BUNDLE STRIP - Uses weekly_surge_r.level */}
                    <tr>
                        <td style={{ textAlign: 'right', paddingRight: '1rem', color: headerColor, fontWeight: 'bold' }}>Bundle</td>
                        {overallData.map((od, i) => {
                            const isNoData = od.level === 'nodata';
                            const isActive = od.activeTypes.length > 0;

                            // Check if any R-type in this week is gated (ratio >= yellow but inactive)
                            const h = history[i];
                            const hasGatedTypes = ['R1', 'R2', 'R3', 'R4'].some(r => {
                                const sr = h.weekly_surge_r_by_type?.[r] || {};
                                return !sr.is_active && (sr.ratio7 || 0) >= (h.weekly_surge_r?.thresholds?.yellow || 1.75);
                            });
                            const isGatedWeek = !isActive && !isNoData && hasGatedTypes;

                            return (
                                <td key={i} style={{ padding: 2 }}>
                                    <div
                                        title={isNoData
                                            ? 'No data for this week'
                                            : `Level: ${od.level.toUpperCase()} | Active: ${od.activeTypes.join('+') || 'None'} | Max Ratio: ${od.maxRatio.toFixed(2)}x`
                                        }
                                        style={{
                                            height: 20,
                                            background: od.color,
                                            color: paperMode ? '#333' : '#eee',
                                            fontSize: '0.6rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            borderRadius: 2,
                                            opacity: (od.level === 'green' || od.level === 'nodata') ? (isGatedWeek ? 0.8 : 0.3) : 1
                                        }}>
                                        {isGatedWeek && <span style={{ fontWeight: 'bold' }}>G</span>}
                                    </div>
                                </td>
                            );
                        })}
                    </tr>

                    {/* SPACER */}
                    <tr style={{ height: 10 }}></tr>

                    {/* MAIN MATRIX - Uses weekly_surge_r_by_type */}
                    {['R1', 'R2', 'R3', 'R4'].map(rKey => (
                        <tr key={rKey}>
                            <td style={{ textAlign: 'right', paddingRight: '1rem', color: headerColor }}>
                                <div style={{ fontWeight: 'bold' }}>{rKey}</div>
                                <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '-2px' }}>{t.panel.rLabels[rKey.toLowerCase()]}</div>
                            </td>
                            {history.map((h, i) => {
                                const sr = h.weekly_surge_r_by_type?.[rKey] || {};
                                const isActive = sr.is_active || false;
                                const ratio7 = sr.ratio7 || 0;
                                const reason = sr.reason || 'unknown';
                                const level = h.levels?.[rKey] || 'NoData';
                                const thresholds = h.weekly_surge_r?.thresholds;

                                const bg = getGateColor(isActive, ratio7, level, thresholds);
                                const isNoData = level === 'NoData';
                                const isGated = !isNoData && !isActive && ratio7 >= (thresholds?.yellow || 1.75);

                                // Build rich tooltip
                                const tooltipParts = isNoData
                                    ? ['No Data']
                                    : [
                                        `${rKey} @ ${labels[i]}`,
                                        `Ratio: ${ratio7.toFixed(2)}x`,
                                        `Active: ${isActive ? 'YES' : 'NO'}`,
                                        isGated ? `GATED: ${reason}` : '',
                                        `Today7: ${sr.today7 || 0} | Baseline7: ${sr.baseline7 || 0}`,
                                        `Share: ${((sr.share7 || 0) * 100).toFixed(2)}% (Thr: ${((sr.share_thr_used || 0) * 100).toFixed(2)}%, Mode: ${sr.share_gate_mode || 'fixed'})`,
                                        sr.red_override_used ? 'RED OVERRIDE ACTIVE' : '',
                                        sr.high_vol ? 'High-Vol Week' : ''
                                    ].filter(Boolean);

                                return (
                                    <td key={i} style={{ padding: 2 }}>
                                        <div
                                            title={tooltipParts.join('\n')}
                                            style={{
                                                height: 24,
                                                background: bg,
                                                borderRadius: 2,
                                                opacity: (isNoData || (!isActive && level === 'None')) ? 0.2 : 0.9,
                                                border: `1px solid ${paperMode ? '#eee' : '#111'}`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: '0.5rem',
                                                color: paperMode ? '#333' : '#ccc'
                                            }}>
                                            {isGated && <span style={{ opacity: 0.8, textTransform: 'uppercase' }}>G</span>}
                                        </div>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* FIRST LIT ANALYSIS - Uses is_active (Gate-based) */}
            <div style={{ marginTop: '2rem', padding: '1rem', background: paperMode ? '#f8f9fa' : '#25282e', borderRadius: 4, border: paperMode ? '1px solid #ddd' : 'none' }}>
                <h4 style={{ margin: '0 0 1rem 0', color: textColor }}>First Lit Analysis (Signal-based)</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                    {['R1', 'R2', 'R3', 'R4'].map(r => {
                        // Scan forward from oldest to newest using is_active
                        let fY = null, fO = null, fR = null;
                        // Use full history (not reversed)
                        data.history.forEach(h => {
                            const sr = h.weekly_surge_r_by_type?.[r];
                            if (!sr || !sr.is_active) return;

                            const ratio7 = sr.ratio7 || 0;
                            const th = h.weekly_surge_r?.thresholds || { yellow: 1.75, orange: 2.75, red: 3.75 };

                            if (ratio7 >= th.yellow && !fY) fY = h.week;
                            if (ratio7 >= th.orange && !fO) fO = h.week;
                            if (ratio7 >= th.red && !fR) fR = h.week;
                        });

                        return (
                            <div key={r}>
                                <div style={{ borderBottom: `1px solid ${borderColor}`, marginBottom: '0.5rem', color: headerColor, pb: '2px' }}>
                                    <span style={{ fontWeight: 'bold' }}>{r}</span>
                                    <span style={{ fontSize: '0.7rem', opacity: 0.6, marginLeft: '6px' }}>{t.panel.rLabels[r.toLowerCase()]}</span>
                                </div>
                                <div style={{ fontSize: '0.85rem', color: fY ? headerColor : textColor }}>
                                    <span style={{ color: '#ffd700' }}>●</span> First Yellow: {fY || '-'}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: fO ? headerColor : textColor }}>
                                    <span style={{ color: '#ff8c00' }}>●</span> First Orange: {fO || '-'}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: fR ? headerColor : textColor }}>
                                    <span style={{ color: '#ff3b3b' }}>●</span> First Red: {fR || '-'}
                                </div>
                            </div>
                        );
                    })}
                </div>
                {(data.anomalies?.includes('HIGH_ZERO_RATIO') || data.anomalies?.includes('LOW_COVERAGE')) && (
                    <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#888', fontStyle: 'italic' }}>
                        Note: sparse weekly signals; interpret cautiously.
                    </div>
                )}
            </div>
        </div>
    );
}

// 2.5 STATE VIEW (Absolute Threshold-based) - Shows chronic/persistent risk levels
const WEEKLY_ABS_THRESHOLDS = { R1: 2100, R2: 1260, R3: 1050, R4: 1400 }; // Daily × 7
const STATE_COLOR_THRESHOLDS = { yellow: 1.0, orange: 2.0, red: 3.0 };

function StateView({ data, range, paperMode, t }) {
    const LEVELS = getLevels(paperMode);
    const history = data.history.slice(-range).reverse();
    const labels = history.map(h => h.week);

    // Get abs_score7 color
    const getAbsScoreColor = (absScore7, isNoData) => {
        if (isNoData) return LEVELS['NoData'].color;
        if (absScore7 >= STATE_COLOR_THRESHOLDS.red) return '#ff3b3b';
        if (absScore7 >= STATE_COLOR_THRESHOLDS.orange) return '#ff8c00';
        if (absScore7 >= STATE_COLOR_THRESHOLDS.yellow) return '#ffd700';
        return LEVELS['None'].color;
    };

    // Bundle row: count of R-types at Yellow+ level
    const bundleData = history.map(h => {
        let activeCount = 0;
        let maxScore = 0;
        ['R1', 'R2', 'R3', 'R4'].forEach(r => {
            const sr = h.weekly_surge_r_by_type?.[r] || {};
            const today7 = sr.today7 || 0;
            const absScore7 = today7 / WEEKLY_ABS_THRESHOLDS[r];
            if (absScore7 >= STATE_COLOR_THRESHOLDS.yellow) activeCount++;
            if (absScore7 > maxScore) maxScore = absScore7;
        });
        return { activeCount, maxScore, isNoData: h.levels?.R1 === 'NoData' };
    });

    const borderColor = paperMode ? '#ddd' : '#222';
    const textColor = paperMode ? '#333' : '#888';
    const headerColor = paperMode ? '#000' : '#fff';

    return (
        <div className="state-view" style={{ overflowX: 'auto', padding: '1rem', background: paperMode ? '#fff' : '#111', transition: 'background 0.3s' }}>
            {/* UI Annotation */}
            <div style={{ fontSize: '0.7rem', color: textColor, marginBottom: '0.5rem', fontStyle: 'italic' }}>
                State View: Absolute counts vs weekly thresholds. Shows chronic/persistent risk regardless of surge.
            </div>

            <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', minWidth: range > 26 ? 800 : 'auto' }}>
                <thead>
                    <tr>
                        <th style={{ width: 80, color: textColor, textAlign: 'right', paddingRight: '1rem', fontSize: '0.8rem' }}>Week</th>
                        {labels.map(l => (
                            <th key={l} style={{ fontSize: range > 26 ? '0.55rem' : '0.65rem', color: textColor, padding: '8px 0', textAlign: 'center', borderLeft: `1px solid ${borderColor}` }}>
                                {l}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {/* BUNDLE STRIP */}
                    <tr>
                        <td style={{ textAlign: 'right', paddingRight: '1rem', color: headerColor, fontWeight: 'bold' }}>Bundle</td>
                        {bundleData.map((bd, i) => {
                            const bundleColor = getAbsScoreColor(bd.maxScore, bd.isNoData);
                            return (
                                <td key={i} style={{ padding: 2 }}>
                                    <div
                                        title={bd.isNoData ? 'No data' : `Max abs_score7: ${bd.maxScore.toFixed(2)} | ${bd.activeCount}/4 R-types at Yellow+`}
                                        style={{
                                            height: 20,
                                            background: bundleColor,
                                            color: paperMode ? '#333' : '#eee',
                                            fontSize: '0.6rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            borderRadius: 2,
                                            opacity: bd.activeCount === 0 ? 0.3 : 1
                                        }}>
                                        {!bd.isNoData && bd.activeCount > 0 && <span>{bd.activeCount}</span>}
                                    </div>
                                </td>
                            );
                        })}
                    </tr>

                    {/* SPACER */}
                    <tr style={{ height: 10 }}></tr>

                    {/* MAIN MATRIX */}
                    {['R1', 'R2', 'R3', 'R4'].map(rKey => (
                        <tr key={rKey}>
                            <td style={{ textAlign: 'right', paddingRight: '1rem', color: headerColor }}>
                                <div style={{ fontWeight: 'bold' }}>{rKey}</div>
                                <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '-2px' }}>{t.panel.rLabels[rKey.toLowerCase()]}</div>
                            </td>
                            {history.map((h, i) => {
                                const sr = h.weekly_surge_r_by_type?.[rKey] || {};
                                const today7 = sr.today7 || 0;
                                const baseline7 = sr.baseline7 || 0;
                                const ratio7 = sr.ratio7 || 0;
                                const absScore7 = today7 / WEEKLY_ABS_THRESHOLDS[rKey];
                                const isNoData = h.levels?.[rKey] === 'NoData';

                                const bg = getAbsScoreColor(absScore7, isNoData);

                                // Enhanced tooltip
                                const tooltipParts = isNoData
                                    ? ['No Data']
                                    : [
                                        `Mode: State (Absolute)`,
                                        `${rKey} @ ${labels[i]}`,
                                        `today7: ${today7}`,
                                        `baseline7: ${baseline7}`,
                                        `ratio7: ${ratio7.toFixed(2)}x`,
                                        `abs_score7: ${absScore7.toFixed(2)}`,
                                        `weekly_threshold: ${WEEKLY_ABS_THRESHOLDS[rKey]}`
                                    ];

                                return (
                                    <td key={i} style={{ padding: 2 }}>
                                        <div
                                            title={tooltipParts.join('\n')}
                                            style={{
                                                height: 24,
                                                background: bg,
                                                borderRadius: 2,
                                                opacity: isNoData ? 0.2 : 0.9,
                                                border: `1px solid ${paperMode ? '#eee' : '#111'}`,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: '0.5rem',
                                                color: paperMode ? '#333' : '#ccc'
                                            }}>
                                            {!isNoData && absScore7 >= 1.0 && <span style={{ fontSize: '0.55rem' }}>{absScore7.toFixed(1)}</span>}
                                        </div>
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Legend */}
            <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '0.75rem', color: textColor }}>
                <span>Legend:</span>
                <span style={{ background: '#ffd700', padding: '2px 8px', borderRadius: 2 }}>≥1x threshold</span>
                <span style={{ background: '#ff8c00', padding: '2px 8px', borderRadius: 2, color: '#fff' }}>≥2x threshold</span>
                <span style={{ background: '#ff3b3b', padding: '2px 8px', borderRadius: 2, color: '#fff' }}>≥3x threshold</span>
            </div>
        </div>
    );
}

// 3. INTENSITY VIEW (Heatmap)
function IntensityView({ data, range, scale, paperMode, t }) {
    const history = data.history.slice(-range).reverse();
    const labels = history.map(h => h.week);

    const borderColor = paperMode ? '#ddd' : '#222';
    const textColor = paperMode ? '#333' : '#888';
    const headerColor = paperMode ? '#000' : '#fff';

    const getColor = (val, lvl, allVals) => {
        if (lvl === 'NoData') return paperMode ? '#d0d0d0' : '#444';
        if (val === null) return paperMode ? '#f0f0f0' : '#222';

        if (scale === 'abs') {
            if (val < 1.0) return paperMode ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.05)';
            if (val < 1.75) return paperMode ? `rgba(255,215,0, ${(val - 1.0) / 1.5 * 0.4})` : `rgba(255,215,0, ${(val - 1.0) / 1.5 * 0.3})`;
            if (val < 2.75) return paperMode ? `rgba(255,140,0, ${0.5 + (val - 1.75) * 0.4})` : `rgba(255,140,0, ${0.4 + (val - 1.75) * 0.4})`;
            return `rgba(255,59,59, ${Math.min(1, 0.6 + (val - 2.75) * 0.4)})`;
        }

        if (scale === 'pct') {
            const sorted = allVals.filter(v => v !== null).sort((a, b) => a - b);
            const rank = sorted.indexOf(val);
            const pct = rank / sorted.length;
            if (pct > 0.95) return '#ff3b3b';
            if (pct > 0.85) return '#ff8c00';
            if (pct > 0.70) return '#ffd700';
            if (pct > 0.50) return '#4caf50';
            return paperMode ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)';
        }

        return '#333';
    };

    // Collect all valid values for Percentile calc if needed
    let allValues = [];
    if (scale === 'pct') {
        ['R1', 'R2', 'R3', 'R4'].forEach(rKey => {
            history.forEach(h => {
                if (h.ratios[rKey] !== null) allValues.push(h.ratios[rKey]);
            });
        });
    }

    return (
        <div style={{ overflowX: 'auto', padding: '1rem', background: paperMode ? '#fff' : '#111', transition: 'background 0.3s' }}>
            {/* UI Annotation - Updated for unified formula */}
            <div style={{ fontSize: '0.7rem', color: textColor, marginBottom: '0.5rem', fontStyle: 'italic' }}>
                Intensity View: ratio7 = (today7 + k) / (baseline7 + k) — same formula as Signal. Gate前の連続値を参考表示。
            </div>
            <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', minWidth: range > 26 ? 800 : 'auto' }}>
                <thead>
                    <tr>
                        <th style={{ width: 80, color: textColor, textAlign: 'right', paddingRight: '1rem', fontSize: '0.8rem' }}>Method: {scale}</th>
                        {labels.map(l => <th key={l} style={{ fontSize: range > 26 ? '0.55rem' : '0.65rem', color: textColor, padding: '8px 0', borderLeft: `1px solid ${borderColor}` }}>{l}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {['R1', 'R2', 'R3', 'R4'].map(rKey => (
                        <tr key={rKey}>
                            <td style={{ textAlign: 'right', paddingRight: '1rem', color: headerColor }}>
                                <div style={{ fontWeight: 'bold' }}>{rKey}</div>
                                <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '-2px' }}>{t.panel.rLabels[rKey.toLowerCase()]}</div>
                            </td>
                            {history.map((h, i) => {
                                const val = h.ratios[rKey];
                                const lvl = h.levels[rKey];
                                const sr = h.weekly_surge_r_by_type?.[rKey] || {};
                                const baselineMode = h.baseline_modes?.[rKey] || 'unknown';
                                const smoothingK = h.smoothing_k || 5;

                                // Enhanced tooltip with audit fields
                                const tooltipParts = lvl === 'NoData'
                                    ? ['No Data']
                                    : [
                                        `Mode: Intensity`,
                                        `${rKey} @ ${labels[i]}`,
                                        `today7: ${sr.today7 || 0}`,
                                        `baseline7: ${sr.baseline7 || 0}`,
                                        `k: ${smoothingK}`,
                                        `ratio7: ${val?.toFixed(3) || 'N/A'}`,
                                        `baseline_mode: ${baselineMode}`
                                    ];

                                return (
                                    <td key={i} style={{ padding: 1 }}>
                                        <div
                                            title={tooltipParts.join('\n')}
                                            style={{
                                                height: 30,
                                                background: getColor(val, lvl, allValues),
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '0.7rem', color: val && val > 2 ? '#fff' : textColor,
                                                border: `1px solid ${paperMode ? '#eee' : '#111'}`
                                            }}>
                                            {lvl === 'NoData' ? 'N/A' : (val ? val.toFixed(1) : '-')}
                                        </div>
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
export default function CountryDetailView({ lang, t }) {
    const { iso2 } = useParams();
    const [data, setData] = useState(null);
    const [config, setConfig] = useState({ range: 52, view: 'signal', scale: 'abs' });
    const [paperMode, setPaperMode] = useState(() => localStorage.getItem('rw_paper_mode') === 'true');
    const [error, setError] = useState(null);

    useEffect(() => {
        localStorage.setItem('rw_paper_mode', paperMode);
    }, [paperMode]);

    useEffect(() => {
        // Fetch specific country history from new Tier B cache
        Promise.all([
            fetch(`./data/weekly/countries/${iso2}.json`).then(res => {
                if (!res.ok) throw new Error("History not found");
                return res.json();
            }),
            fetch(`./data/weekly/_regression_report.json`).then(res => res.json()).catch(() => null)
        ])
            .then(([historyData, report]) => {
                const anomalies = report?.countries?.[iso2]?.anomalies || [];
                setData({ ...historyData, anomalies });
            })
            .catch(err => setError(err.message));
    }, [iso2]);

    if (error) return <div style={{ color: 'red', padding: '2rem' }}>Error: {error}. This country may not have historical tracking enabled.</div>;
    if (!data) return <div style={{ padding: '2rem', color: '#fff' }}>Loading historical data for {iso2}...</div>;

    return (
        <div className={`country-detail-view ${paperMode ? 'paper-mode' : ''}`} style={{
            minHeight: '100vh',
            background: paperMode ? '#fff' : '#111',
            color: paperMode ? '#333' : '#eee',
            fontFamily: 'sans-serif',
            transition: 'all 0.3s ease'
        }}>
            <DetailHeader iso2={iso2} meta={data} config={config} setConfig={setConfig} paperMode={paperMode} setPaperMode={setPaperMode} />

            <div className="view-container">
                {config.view === 'signal' ? (
                    <SignalView data={data} range={config.range} paperMode={paperMode} t={t} />
                ) : config.view === 'state' ? (
                    <StateView data={data} range={config.range} paperMode={paperMode} t={t} />
                ) : (
                    <IntensityView data={data} range={config.range} scale={config.scale} paperMode={paperMode} t={t} />
                )}
            </div>

            <div style={{ padding: '1rem', borderTop: `1px solid ${paperMode ? '#eee' : '#333'}`, marginTop: 'auto', textAlign: 'center', color: paperMode ? '#999' : '#555', fontSize: '0.8rem' }}>
                CONFIDENTIAL - INTERNAL USE ONLY | Cache Generated: {new Date(data.generated_at).toLocaleString()}
            </div>
        </div>
    );
}
