import React, { useState, useEffect } from 'react';

function ScoreBar({ label, score, max = 10 }) {
    const percentage = (score / max) * 100;
    const color = score >= 7 ? '#ff3b3b' : score >= 5 ? '#ff8c00' : score >= 3 ? '#ffd700' : '#3d4654';

    return (
        <div className="score-bar" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <div className="score-label" style={{ width: '80px', fontSize: '0.75rem', fontWeight: 'bold', display: 'flex', flexDirection: 'column' }}>
                <span>{label && label.split(' ')[0]}</span>
                <span style={{ fontSize: '0.6rem', opacity: 0.6, fontWeight: 'normal' }}>{label && label.split(' ').slice(1).join(' ')}</span>
            </div>
            <div className="score-track" style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                <div
                    className="score-fill"
                    style={{ width: `${percentage}%`, backgroundColor: color, height: '100%', transition: 'width 0.5s ease' }}
                />
            </div>
            <div className="score-value" style={{ color: color, fontSize: '0.8rem', fontWeight: 'bold', width: '30px', textAlign: 'right' }}>{score.toFixed(1)}</div>
        </div>
    );
}

// [P0] Expand Button Logic
// [P0] Expand Button Logic - simplified to use prop
function ExpandButton({ iso2, isAvailable }) {
    if (!isAvailable) return null;

    return (
        <a
            href={`#/country/${iso2}`}
            target="_blank"
            className="expand-btn"
            style={{
                position: 'absolute',
                top: 10,
                right: 30, // Left of close button
                color: '#aaa',
                textDecoration: 'none',
                fontSize: '0.85rem',
                border: '1px solid #555',
                padding: '2px 8px',
                borderRadius: '4px'
            }}
            title="Open Historical Detail View"
        >
            Expand ↗
        </a>
    );
}

export default function CountryModal({ country, onClose, t, lang, isPinned, hasHistory, side, signals, viewMode }) {
    if (!country) return null;

    const popupStyle = side === 'right' ? { left: 'auto', right: '420px' } : { left: '20px', right: 'auto' };

    // Fetch weekly cache for 4-WEEK TREND (same as Historical)
    const [weeklyCache, setWeeklyCache] = useState(null);
    const iso2 = country.code || country.iso2;

    useEffect(() => {
        if (hasHistory && iso2) {
            fetch(`/data/weekly/countries/${iso2}.json`)
                .then(res => res.ok ? res.json() : null)
                .then(data => setWeeklyCache(data))
                .catch(() => setWeeklyCache(null));
        }
    }, [iso2, hasHistory]);

    // Dynamic Alert Level based on viewMode
    const getActiveAlertLevel = () => {
        if (viewMode === 'surge' && country.surge) {
            const rank = country.surge.rank;
            if (rank <= 10) return 'red';
            if (rank <= 20) return 'orange';
            if (rank <= 40) return 'yellow';
            return 'green';
        }
        if (viewMode === 'surge_r' && country.surge_r) {
            return country.surge_r.level?.toLowerCase() || 'green';
        }
        if (viewMode === 'index' && country.index) {
            return country.index.level?.toLowerCase() || 'green';
        }
        return country.alert_level || 'green';
    };

    const alertLevel = getActiveAlertLevel();
    const alertLabel = t?.alertLabels?.[alertLevel] || alertLevel.toUpperCase();

    const getName = () => {
        if (lang === 'ja') return country.name_ja || country.name_en;
        if (lang === 'es') return country.name_es || country.name_en;
        return country.name_en;
    };

    const getSummary = () => {
        if (lang === 'ja') return country.summary_ja || country.summary_en || '—';
        if (lang === 'es') return country.summary_es || country.summary_en || '—';
        return country.summary_en || country.summary_ja || '—';
    };

    // Find the main driver (highest R score > 1)
    const getMainDriver = () => {
        const bars = country.r_bars || country.bundles;
        if (!bars) return null;
        const sorted = Object.entries(bars)
            .filter(([k, v]) => v > 2.0) // Only count as driver if significant (>1.0)
            .sort((a, b) => b[1] - a[1]);
        return sorted[0] ? { key: sorted[0][0].toUpperCase(), value: sorted[0][1] } : null;
    };

    const mainDriver = getMainDriver();

    const getDisplayScores = () => {
        if (viewMode === 'surge_r') return country.surge_r_score_by_type || {};
        if (viewMode === 'surge' || viewMode === 'index' || viewMode === 'adj') return country.r_scores_adj || country.r_scores || {};
        // RAW mode: use r_scores_raw (absolute level) if available
        return country.r_scores_raw || country.r_scores || {};
    };

    const displayScores = getDisplayScores();

    return (
        <div className={`country-popup ${isPinned ? 'country-popup--pinned' : ''}`} style={popupStyle}>
            {isPinned && <button className="modal-close" onClick={onClose} style={{ position: 'absolute', top: 5, right: 10, cursor: 'pointer', background: 'none', border: 'none', color: '#fff', fontSize: '1.2rem', padding: 0, lineHeight: 1 }}>×</button>}
            <div className="popup-header">
                <span className={`modal-badge modal-badge--${alertLevel}`}>
                    {alertLabel}
                </span>
                <span className="popup-country-name">{getName()}</span>
                {country.anomalies?.includes('LOW_COVERAGE') && (
                    <span className="modal-badge modal-badge--gray" style={{ background: '#444', color: '#aaa', marginLeft: '6px' }} title="Limited weekly history points">Low coverage</span>
                )}
                {country.anomalies?.includes('HIGH_ZERO_RATIO') && (
                    <span className="modal-badge modal-badge--gray" style={{ background: '#444', color: '#aaa', marginLeft: '6px' }} title="Many weeks with zero events">Sparse signals</span>
                )}
            </div>

            <ExpandButton iso2={country.code || country.iso2} isAvailable={hasHistory} />

            {mainDriver && (
                <div className="modal-driver">
                    <span className="driver-icon">⚡</span>
                    <span className="driver-label">Driver: {mainDriver.key}</span>
                </div>
            )}

            {country.brief ? (
                <div className="modal-brief" style={{ marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '0.4rem', color: '#fff' }}>
                        {country.brief.headline}
                    </div>
                    <div style={{ fontSize: '0.85rem', lineHeight: '1.4', color: '#ccc' }}>
                        {country.brief.what_happened}
                    </div>

                    <div style={{ display: 'flex', gap: '10px', marginTop: '0.5rem', fontSize: '0.7rem' }}>
                        <span style={{
                            color: (country.brief.confidence || 'low') === 'high' ? '#2dd4bf' : (country.brief.confidence || 'low') === 'med' ? '#facc15' : '#ef4444',
                            fontWeight: 'bold'
                        }}>
                            {country.brief.confidence?.toUpperCase() || 'LOW'} CONFIDENCE
                        </span>

                        {(!country.brief.sources || country.brief.sources.length === 0) && (
                            <span style={{ color: '#888', fontStyle: 'italic' }}>
                                (Unverified: No Sources)
                            </span>
                        )}
                    </div>
                </div>
            ) : (
                <p className="modal-summary">{getSummary()}</p>
            )}

            <div className="modal-scores">
                <div className="modal-scores-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'bold' }}>
                        {viewMode === 'surge_r'
                            ? `RISK SCORE (R-INDEX): Max Ratio ${country.surge_r?.max_ratio_active?.toFixed(1) || '0.0'}`
                            : `${t.panel.riskScores} (${viewMode === 'surge' ? t.viewMode.surge : (viewMode === 'index' ? t.viewMode.index : (viewMode === 'adj' ? t.viewMode.adj : t.viewMode.raw))})`
                        }
                    </span>
                    {viewMode !== 'surge_r' && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            {(viewMode === 'surge' && country.surge) || (viewMode === 'index' && country.index) ? (
                                <span style={{ fontSize: '0.6rem', color: '#ff3b3b', fontWeight: 'bold', padding: '1px 4px', background: 'rgba(255,59,59,0.1)', borderRadius: '2px' }}>
                                    {viewMode === 'surge' ? `Rank: #${country.surge.rank} (S: ${country.surge.score.toFixed(1)})` :
                                        `Index: ${country.index.score.toFixed(1)}`}
                                </span>
                            ) : null}
                            {country.baseline?.gdelt?.GDELTweight && (
                                <span style={{ fontSize: '0.6rem', color: '#4b5563', padding: '1px 4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px' }}>
                                    Base Weight: {country.baseline.gdelt.GDELTweight.toLocaleString()}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="modal-scores-list" style={{ display: 'flex', flexDirection: 'column' }}>
                    {(() => {
                        // [P0] HIDE TOP BARS for surge_r (User Request)
                        if (viewMode === 'surge_r') return null;

                        // We iterate in order R1, R2, R3, R4
                        return ['R1', 'R2', 'R3', 'R4'].map(key => {
                            const val = parseFloat(displayScores[key] || 0);
                            return (
                                <ScoreBar
                                    key={key}
                                    label={t?.panel?.[key.toLowerCase()] || key}
                                    score={val}
                                />
                            );
                        });
                    })()}
                </div>

                {viewMode === 'index' && country.index && (
                    <div style={{ marginTop: '1rem', padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#aaa' }}>INDEX SCORE</span>
                            <span style={{ fontSize: '1.2rem', fontWeight: 'bold', color: (country.index?.level || '').toLowerCase() === 'red' ? 'var(--color-red)' : (country.index?.level || '').toLowerCase() === 'orange' ? 'var(--color-orange)' : 'var(--color-yellow)' }}>
                                {country.index.score.toFixed(1)} ({country.index.level})
                            </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', fontSize: '0.75rem', color: '#888' }}>
                            <div>Bundle Count: <span style={{ color: '#ccc' }}>{country.index.bundle_count}</span></div>
                            <div>RawScore (B*2.5): <span style={{ color: '#ccc' }}>{country.index.rawScore}</span></div>
                            <div style={{ gridColumn: 'span 2' }}>SurgeScore (MaxAdj): <span style={{ color: '#ccc' }}>{country.index.surgeScore}</span></div>
                            <div style={{ gridColumn: 'span 2', fontSize: '0.65rem', borderTop: '1px solid #333', paddingTop: '5px', marginTop: '5px', fontStyle: 'italic' }}>
                                Calculation: (RawScore * SurgeScore) / 10
                            </div>
                        </div>
                    </div>
                )}

                {viewMode === 'surge_r' && country.surge_r_by_type && (
                    <div style={{ marginTop: '1rem', padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#6fa5b5', marginBottom: '8px' }}>SURGE R BREAKDOWN</div>
                        <table style={{ width: '100%', fontSize: '0.65rem', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #333', color: '#888' }}>
                                    <th style={{ textAlign: 'left', padding: '4px' }}>Type</th>
                                    <th style={{ textAlign: 'center', padding: '4px' }}>Today</th>
                                    <th style={{ textAlign: 'center', padding: '4px' }}>Baseline</th>
                                    <th style={{ textAlign: 'right', padding: '4px' }}>Ratio</th>
                                </tr>
                            </thead>
                            <tbody>
                                {['R1', 'R2', 'R3', 'R4'].map(key => {
                                    const data = country.surge_r_by_type[key];
                                    if (!data) return null;

                                    const th = country.surge_r?.thresholds || { yellow: 1.75, orange: 2.75, red: 3.75 };
                                    const ratio = Number(data.ratio || 0);

                                    // Gate-aware level: Only show color if is_active is true
                                    let displayLevel = 'none';
                                    let gateReason = '';

                                    if (data.is_active) {
                                        // Active: calculate level from ratio
                                        displayLevel =
                                            ratio >= th.red ? 'red' :
                                                ratio >= th.orange ? 'orange' :
                                                    ratio >= th.yellow ? 'yellow' : 'none';
                                    } else {
                                        // Gated: determine the reason
                                        displayLevel = 'gated';
                                        if (!data.is_stable_input) {
                                            gateReason = 'low-baseline';
                                        } else if (!data.triggered) {
                                            if (data.high_vol && !data.share_hit) {
                                                gateReason = 'high-vol';
                                            } else if (!data.share_hit && !data.abs_hit) {
                                                gateReason = 'low-share';
                                            } else if (!data.abs_hit) {
                                                gateReason = 'low-abs';
                                            } else {
                                                gateReason = 'no-trigger';
                                            }
                                        } else if (ratio < th.yellow) {
                                            gateReason = 'below-threshold';
                                        }
                                    }

                                    const levelColor =
                                        displayLevel === 'red' ? 'var(--color-red)' :
                                            displayLevel === 'orange' ? 'var(--color-orange)' :
                                                displayLevel === 'yellow' ? 'var(--color-yellow)' :
                                                    displayLevel === 'gated' ? '#666' : '#ccc';

                                    const levelLabel =
                                        displayLevel === 'gated'
                                            ? `(GATED${gateReason ? ': ' + gateReason : ''})`
                                            : displayLevel !== 'none' ? `(${displayLevel.toUpperCase()})` : '';

                                    return (
                                        <tr key={key} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', color: levelColor }}>
                                            <td style={{ textAlign: 'left', padding: '4px' }}>
                                                <div style={{ fontWeight: data.is_active ? 'bold' : 'normal' }}>
                                                    {key} {data.is_active ? '●' : ''} {levelLabel}
                                                </div>
                                                <div style={{ fontSize: '0.55rem', opacity: 0.6 }}>{t.panel.rLabels[key.toLowerCase()]}</div>
                                            </td>
                                            <td style={{ textAlign: 'center', padding: '4px' }}>{data.today}</td>
                                            <td style={{ textAlign: 'center', padding: '4px' }}>{data.baseline_median}</td>
                                            <td style={{ textAlign: 'right', padding: '4px', fontWeight: 'bold' }}>{data.ratio?.toFixed(1)}x</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div style={{ fontSize: '0.55rem', color: '#666', marginTop: '8px', fontStyle: 'italic', wordBreak: 'break-all' }}>
                            * Colors follow is_active (Gate applied). High ratio alone does not trigger alert.
                        </div>
                    </div>
                )}

                {viewMode === 'surge_r' && weeklyCache?.history && (() => {
                    // Use weekly cache (same as Historical) for 4-WEEK TREND
                    const last4Weeks = weeklyCache.history.slice(-4);
                    if (last4Weeks.length === 0) return null;

                    // Helper: Get Signal (Discrete) display state
                    const getSignalState = (sr, thresholds) => {
                        if (!sr) return { state: 'nodata', color: '#333', text: '', reason: 'No data' };
                        const ratio7 = sr.ratio7 || 0;
                        const isActive = sr.is_active || false;
                        const yellowThr = thresholds?.yellow || 1.75;
                        const orangeThr = thresholds?.orange || 2.75;
                        const redThr = thresholds?.red || 3.75;

                        if (isActive) {
                            const level = ratio7 >= redThr ? 'red' : ratio7 >= orangeThr ? 'orange' : ratio7 >= yellowThr ? 'yellow' : 'none';
                            const levelColor = level === 'red' ? 'var(--color-red)' : level === 'orange' ? 'var(--color-orange)' : level === 'yellow' ? 'var(--color-yellow)' : '#333';
                            return { state: 'active', color: levelColor, text: ratio7.toFixed(1), reason: `ACTIVE: ${ratio7.toFixed(2)}x` };
                        } else if (ratio7 >= yellowThr) {
                            return { state: 'gated', color: '#555', text: 'G', reason: `GATED: ${sr.reason || 'gate condition'}\nRatio: ${ratio7.toFixed(2)}x` };
                        } else {
                            return { state: 'none', color: '#333', text: '', reason: `NONE: ratio7 ${ratio7.toFixed(2)}x < ${yellowThr}` };
                        }
                    };

                    const thresholds = { yellow: 1.75, orange: 2.75, red: 3.75 };

                    return (
                        <div style={{ marginTop: '1rem', padding: '10px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <div style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#6fa5b5', marginBottom: '8px' }}>4-WEEK TREND (Weekly ISO)</div>

                            {/* Bundle Strip */}
                            <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                                {last4Weeks.map((w, i) => {
                                    const activeTypes = ['R1', 'R2', 'R3', 'R4'].filter(r => {
                                        const sr = w.weekly_surge_r_by_type?.[r];
                                        return sr?.is_active;
                                    });
                                    const hasGated = ['R1', 'R2', 'R3', 'R4'].some(r => {
                                        const sr = w.weekly_surge_r_by_type?.[r];
                                        return !sr?.is_active && (sr?.ratio7 || 0) >= thresholds.yellow;
                                    });

                                    const bundleLabel = activeTypes.length > 0 ? activeTypes.join('+') : (hasGated ? 'G' : '');
                                    let bundleColor = '#444';
                                    let textColor = '#888';

                                    if (activeTypes.length > 0) {
                                        const maxRatio = Math.max(...activeTypes.map(r => w.weekly_surge_r_by_type?.[r]?.ratio7 || 0));
                                        if (maxRatio >= thresholds.red) { bundleColor = 'var(--color-red)'; textColor = '#fff'; }
                                        else if (maxRatio >= thresholds.orange) { bundleColor = 'var(--color-orange)'; textColor = '#000'; }
                                        else { bundleColor = 'var(--color-yellow)'; textColor = '#000'; }
                                    }

                                    return (
                                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '4px 2px', borderRadius: '3px' }}>
                                            <span style={{ fontSize: '0.55rem', color: '#888', marginBottom: '2px' }}>{w.week?.slice(-3) || `W${i}`}</span>
                                            <span style={{ fontSize: '0.6rem', fontWeight: 'bold', backgroundColor: bundleColor, color: textColor, padding: '1px 4px', borderRadius: '2px', width: '100%', textAlign: 'center' }}>
                                                {bundleLabel}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* 4x4 Grid - Signal (Discrete) style */}
                            <table style={{ width: '100%', fontSize: '0.65rem', borderCollapse: 'collapse', marginBottom: '8px' }}>
                                <thead>
                                    <tr style={{ color: '#888' }}>
                                        <th style={{ textAlign: 'left', padding: '2px' }}>Type</th>
                                        {last4Weeks.map(w => (
                                            <th key={w.week} style={{ textAlign: 'center', padding: '2px' }}>{w.week?.slice(-3) || ''}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {['R1', 'R2', 'R3', 'R4'].map(rKey => (
                                        <tr key={rKey} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ textAlign: 'left', padding: '2px' }}>
                                                <div style={{ color: '#ccc' }}>{rKey}</div>
                                                <div style={{ fontSize: '0.5rem', opacity: 0.5, color: '#888' }}>{t.panel.rLabels[rKey.toLowerCase()]}</div>
                                            </td>
                                            {last4Weeks.map((w, idx) => {
                                                const sr = w.weekly_surge_r_by_type?.[rKey];
                                                const baselineMode = w.baseline_modes?.[rKey] || 'unknown';
                                                const signal = getSignalState(sr, thresholds);

                                                // Enhanced tooltip with audit fields
                                                const tooltipParts = [
                                                    `Mode: Signal (Discrete)`,
                                                    `${rKey} @ ${w.week}`,
                                                    `today7: ${sr?.today7 || 0}`,
                                                    `baseline7: ${sr?.baseline7 || 0}`,
                                                    `k: ${w.smoothing_k || 5}`,
                                                    `ratio7: ${(sr?.ratio7 || 0).toFixed(3)}`,
                                                    `is_active: ${sr?.is_active || false}`,
                                                    `reason: ${sr?.reason || 'N/A'}`,
                                                    `baseline_mode: ${baselineMode}`
                                                ];

                                                return (
                                                    <td key={idx} style={{ textAlign: 'center', padding: '2px' }}>
                                                        <div
                                                            title={tooltipParts.join('\n')}
                                                            style={{
                                                                backgroundColor: signal.color,
                                                                color: signal.state === 'gated' ? '#aaa' : (signal.color === 'var(--color-yellow)' ? '#000' : '#fff'),
                                                                borderRadius: '2px',
                                                                padding: '1px 0',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                fontSize: '0.6rem',
                                                                minHeight: '14px'
                                                            }}>
                                                            {signal.text}
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* Pattern Analysis */}
                            {(() => {
                                const getLevelScore = (lvl) => lvl === 'red' ? 3 : lvl === 'orange' ? 2 : lvl === 'yellow' ? 1 : 0;
                                const weekStats = last4Weeks.map(w => {
                                    const activeR = ['R1', 'R2', 'R3', 'R4'].filter(r => w.weekly_surge_r_by_type?.[r]?.is_active);
                                    const maxRatio = Math.max(...['R1', 'R2', 'R3', 'R4'].map(r => w.weekly_surge_r_by_type?.[r]?.ratio7 || 0));
                                    const maxLevel = maxRatio >= 3.75 ? 3 : maxRatio >= 2.75 ? 2 : maxRatio >= 1.75 ? 1 : 0;
                                    return { active: activeR.length > 0, bundleSize: activeR.length, maxLevel };
                                });

                                const activeCount = weekStats.filter(s => s.active).length;
                                const idxW0 = weekStats.length - 1;
                                const idxW3 = 0;

                                let pattern = 'Stable', detail = '';
                                if (activeCount === 1 && weekStats[idxW0].active) { pattern = 'Shock'; detail = 'New surge'; }
                                else if (activeCount >= 3) { pattern = 'Chronic'; detail = weekStats[idxW0].maxLevel > weekStats[idxW3].maxLevel + 0.5 ? 'Escalating intensity' : 'Persistent risk'; }
                                else if (weekStats[idxW0].maxLevel > weekStats[idxW3].maxLevel || (weekStats[idxW0].bundleSize > weekStats[idxW3].bundleSize && weekStats[idxW0].active)) {
                                    pattern = 'Escalating'; detail = weekStats[idxW0].bundleSize > weekStats[idxW3].bundleSize ? 'Broadening' : 'Intensifying';
                                }
                                else if (weekStats[idxW0].maxLevel < weekStats[idxW3].maxLevel || weekStats[idxW0].bundleSize < weekStats[idxW3].bundleSize) { pattern = 'Cooling'; }
                                else if (activeCount > 0) { pattern = 'Volatile'; detail = 'Intermittent'; }
                                else { pattern = 'Quiet'; detail = 'No active surges'; }

                                return (
                                    <div style={{ fontSize: '0.6rem', color: '#ccc', fontStyle: 'italic', background: 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: '2px', display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Pattern: <strong style={{ color: '#fff' }}>{pattern}</strong> {detail && <span style={{ opacity: 0.7 }}>({detail})</span>}</span>
                                    </div>
                                );
                            })()}

                            {/* Updated Note */}
                            <div style={{ fontSize: '10px', opacity: 0.6, marginTop: '6px', lineHeight: '1.2' }}>
                                Note: Uses weekly cache (same Signal logic as Historical).<br />
                                Colors follow is_active (Gate applied). "G" = gated. baseline_mode shown in tooltips.
                            </div>
                        </div>
                    );
                })()}

                {/* Detailed Comparison Table (Raw vs Adjusted) */}
                {country.r_scores && country.r_scores_adj && (
                    <div className="score-comparison-table" style={{ marginTop: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', padding: '6px' }}>
                        <table style={{ width: '100%', fontSize: '0.65rem', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #333', color: '#888' }}>
                                    <th style={{ textAlign: 'left', padding: '2px' }}>{t.panel.indicator}</th>
                                    <th style={{ textAlign: 'center', padding: '2px' }}>Raw</th>
                                    <th style={{ textAlign: 'center', padding: '2px' }}>Adj</th>
                                    <th style={{ textAlign: 'center', padding: '2px' }}>Ratio</th>
                                </tr>
                            </thead>
                            <tbody>
                                {['R1', 'R2', 'R3', 'R4'].map(key => (
                                    <tr key={key} style={{ borderBottom: '1px dotted #222' }}>
                                        <td style={{ padding: '2px' }}>
                                            <div style={{ color: '#aaa' }}>{key}</div>
                                            <div style={{ fontSize: '0.55rem', opacity: 0.6 }}>{t.panel.rLabels[key.toLowerCase()]}</div>
                                        </td>
                                        <td style={{ textAlign: 'center', color: '#fff', padding: '2px' }}>{country.r_scores[key]}</td>
                                        <td style={{ textAlign: 'center', color: '#2dd4bf', padding: '2px' }}>{country.r_scores_adj[key]}</td>
                                        <td style={{ textAlign: 'center', color: '#6fa5b5', padding: '2px' }}>
                                            {country.v4_scoring?.debug?.ratios?.[key.toLowerCase()] || '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ fontSize: '0.55rem', color: '#555', marginTop: '4px', fontStyle: 'italic' }}>
                            * Mode: {country.v4_scoring?.debug?.mode || 'none'}
                        </div>
                    </div>
                )}

                <div style={{ fontSize: '0.6rem', color: '#666', marginTop: '0.5rem', fontStyle: 'italic', textAlign: 'center', lineHeight: '1.2' }}>
                    {lang === 'ja'
                        ? "平時ボリューム補正後の0〜10スコア（暫定）"
                        : "* Normalized 0-10 score after baseline adjustment."}
                </div>
            </div>

            {/* KEY SOURCES (Moved above Signals) */}
            {country.sources && country.sources.length > 0 && (
                <div className="modal-sources" style={{ marginBottom: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.5rem' }}>
                    <h4>{t?.panel?.sources || 'KEY SOURCES'}</h4>
                    <ul>
                        {country.sources.slice(0, 3).map((src, idx) => (
                            <li key={idx}>
                                <a href={src.url} target="_blank" rel="noopener noreferrer">
                                    {src.title.substring(0, 40)}{src.title.length > 40 ? '...' : ''} <span className="source-badge">{src.source}</span>
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {(signals?.gt?.length > 0 || signals?.pm?.length > 0 || signals?.xt) && (
                <div className="modal-signals" style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.5rem' }}>

                    {/* SNS Political Surge (Phase E4) - Moved to TOP */}
                    {signals.xt && (
                        <div className="signal-group-modal" style={{ marginBottom: '0.5rem' }}>
                            <h4 style={{ fontSize: '0.6rem', color: '#6fa5b5', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ color: '#ff7ee2' }}>●</span> SNS POLITICAL SURGE
                            </h4>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                <span style={{ fontSize: '0.6rem', color: '#ccc' }}>
                                    {lang === 'ja' ? '政治関心スコア' : 'Political Score'}
                                </span>
                                <span style={{ fontSize: '0.7rem', color: '#fff', fontWeight: 'bold' }}>
                                    {signals.xt.ps_today?.toFixed(2) || '0.00'}
                                </span>
                            </div>
                            {signals.xt.political_terms?.length > 0 ? (
                                <ul className="signal-list" style={{ padding: 0 }}>
                                    {signals.xt.political_terms.map((term, i) => (
                                        <li key={i} className="signal-item" style={{ padding: '0.25rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                            <span className="signal-id signal-id--xt" style={{ fontSize: '0.4rem', padding: '0 2px', backgroundColor: '#ff7ee2', color: '#000' }}>SNS</span>
                                            <span className="signal-text" style={{ fontSize: '0.6rem', color: '#ccc' }}>{term}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <div style={{ fontSize: '0.55rem', color: '#666', fontStyle: 'italic' }}>
                                    {lang === 'ja' ? '目立った政治的シグナルなし' : 'No significant political signals'}
                                </div>
                            )}
                        </div>
                    )}

                    {/* GT */}
                    {signals.gt?.length > 0 && (
                        <div className="signal-group-modal" style={{ marginBottom: '0.5rem' }}>
                            <h4 style={{ fontSize: '0.6rem', color: '#6fa5b5', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ color: '#2dd4bf' }}>●</span> GOOGLE TRENDS
                            </h4>
                            <ul className="signal-list" style={{ padding: 0 }}>
                                {signals.gt.map((item, i) => (
                                    <li key={i} className="signal-item" style={{ padding: '0.25rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: item.is_political ? 1 : 0.6 }}>
                                        <span className="signal-id" style={{ fontSize: '0.4rem', padding: '0 2px', backgroundColor: item.is_political ? '#2dd4bf' : '#444', color: item.is_political ? '#000' : '#888' }}>GT</span>
                                        <span className="signal-text" style={{ fontSize: '0.6rem', color: item.is_political ? '#ccc' : '#888' }}>{item.term}</span>
                                        <span className="signal-value" style={{ fontSize: '0.5rem', color: item.is_political ? '#2dd4bf' : '#666' }}>
                                            {item.is_political ? (item.labels?.[0] || 'Political') : 'Non-political'}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* PM */}
                    {signals.pm?.length > 0 && (
                        <div className="signal-group-modal">
                            <h4 style={{ fontSize: '0.6rem', color: '#6fa5b5', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ color: '#4ade80' }}>●</span> POLYMARKET
                            </h4>
                            <ul className="signal-list" style={{ padding: 0 }}>
                                {signals.pm.map((item, i) => (
                                    <li key={i} className="signal-item" style={{ padding: '0.25rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <span className="signal-id signal-id--pm" style={{ fontSize: '0.4rem', padding: '0 2px' }}>PM</span>
                                        <span className="signal-text" style={{ fontSize: '0.6rem', color: '#ccc' }}>{item.title}</span>
                                        <span className="signal-value" style={{ fontSize: '0.5rem' }}>{item.volume}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                </div>
            )}

        </div>
    );
}
