import React, { useState, useEffect } from 'react';
import {countryLevel,monitoringMethod,greenLabel} from '../display';
import {alertCard} from '../alert-contract';
import CountryGoogleInterest from './CountryGoogleInterest';

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

export default function CountryModal({ country, onClose, t, lang, isPinned, hasHistory, side, signals, viewMode, theme, editionDate }) {
    if (!country) return null;

    const popupStyle = side === 'right' ? { left: 'auto', right: '420px' } : { left: '20px', right: 'auto' };

    // Fetch weekly cache for 4-WEEK TREND (same as Historical)
    const [weeklyCache, setWeeklyCache] = useState(null);
    const iso2 = country.code || country.iso2;

    useEffect(() => {
        if (hasHistory && iso2) {
            fetch('./data/history/weekly_5y/index.json', { cache: 'no-store' })
                .then(res => res.json())
                .then(index => fetch(`./data/history/weekly_5y/${index.countries.find(c => c.iso2 === iso2)?.path || iso2 + '.json'}`))
                .then(res => res.ok ? res.json() : null)
                .then(data => setWeeklyCache(data))
                .catch(() => setWeeklyCache(null));
        }
    }, [iso2, hasHistory]);

    const alertLevel = countryLevel(country,viewMode);
    const alertLabel = alertLevel==='green' ? greenLabel(viewMode,t) : alertLevel==='unknown' ? t.legend.unknown : t?.alertLabels?.[alertLevel] || alertLevel.toUpperCase();
    const practical=alertCard(viewMode==='surge_r' ? country.practical_alert?.active_types || [] : viewMode==='raw' ? country.evaluation?.initial_active_types || [] : country.evaluation?.active_types || [],lang);

    const getName = () => {
        if (lang === 'ja') return country.name_ja || country.name_en;
        if (lang === 'es') return country.name_es || country.name_en;
        return country.name_en;
    };

    const getSummary = () => {
        if(country.mode_summaries?.[viewMode]?.[lang])return country.mode_summaries[viewMode][lang];
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
        if (viewMode === 'monitoring' || viewMode === 'surge' || viewMode === 'index' || viewMode === 'adj') return country.r_scores_adj || country.r_scores || {};
        // RAW mode: use r_scores_raw (absolute level) if available
        return country.r_scores_raw || country.r_scores || {};
    };

    const displayScores = getDisplayScores();

    return (
        <div className={`country-popup ${isPinned ? 'country-popup--pinned' : ''}`} style={popupStyle} data-country={iso2} data-monitoring-level={alertLevel} data-snapshot-id={country.snapshot_id}>
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

            {country.brief && !country.evaluation ? (
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

            {practical.active.length>0 && <section className="practical-alert"><h4>{practical.title}</h4>{practical.checks.map(c=><p key={c.r}><strong>{c.r}</strong> · {c.text}</p>)}<p>{practical.next}: {practical.candidates.join(' → ')||'—'}</p><small>{practical.conditions}</small></section>}
            <div className="modal-scores">
                <div className="modal-scores-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'bold' }}>
                        {viewMode === 'surge_r'
                            ? `R-INDEX · ${t.comparisonMax}: ${country.surge_r?.max_ratio_active?.toFixed(2) ?? '—'}`
                            : `${t.panel.riskScores} (${viewMode === 'monitoring' ? t.viewMode.monitoring : viewMode === 'surge' ? t.viewMode.surge : (viewMode === 'index' ? t.viewMode.index : (viewMode === 'adj' ? t.viewMode.adj : t.viewMode.raw))})`
                        }
                    </span>
                    {viewMode !== 'surge_r' && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            {(viewMode === 'surge' && country.surge) || (viewMode === 'index' && country.index) ? (
                                <span style={{ fontSize: '0.6rem', color: '#ff3b3b', fontWeight: 'bold', padding: '1px 4px', background: 'rgba(255,59,59,0.1)', borderRadius: '2px' }}>
                                    {viewMode === 'surge' ? `Rank: #${country.surge.rank} (S: ${country.surge.score.toFixed(1)})` :
                                        `Index: ${country.index.score?.toFixed(1) ?? 'Unknown'}`}
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
                                {country.index.score?.toFixed(1) ?? 'Unknown'} ({country.index.level})
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

                {country.evaluation && <div className="country-evaluation">
                    <p><strong>{monitoringMethod(country,t,viewMode)}</strong> · {country.evaluation.partial_observation ? t.global.partial : t.global.observed}</p>
                    <p className="mode-comparison">R-INDEX: {countryLevel(country,'surge_r')} · RAW: {countryLevel(country,'raw')} · {t.viewMode.monitoring}: {countryLevel(country,'monitoring')}</p>
                    <p>{t.global.observedRecords}: {country.evaluation.country_input.records} · {t.global.domains}: {country.evaluation.country_input.source_domains || 0} · {t.global.observedHours}: {country.evaluation.country_input.observed_hours || 0}</p>
                    <p>{t.global.availableComparisons}: {country.evaluation.available_comparisons.join(', ') || t.global.none}</p>
                    {alertLevel==='unknown' && <p>{(viewMode==='surge_r'?country.rindex_evaluation?.reasons || []:country.evaluation.reasons).map(reason=>t.reasons[reason] || reason).join(' / ')}</p>}
                    {alertLevel==='green' && <p>{viewMode==='surge_r'?t.global.rindexGreenScope:t.global.greenScope}</p>}
                    <small>{t.global.partialScope}</small>
                </div>}
                {viewMode === 'surge_r' && country.evaluation && <p className="comparison-note">{t.global.matchedNote}</p>}
                {viewMode === 'surge_r' && country.evaluation && <p className="comparison-note">{t.global.activeZeroNote}</p>}
                {viewMode === 'surge_r' && country.surge_r_by_type && (
                    <div style={{ marginTop: '1rem', padding: '10px', background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(0,0,0,0.2)', borderRadius: '4px', border: theme === 'light' ? '1px solid rgba(0,0,0,0.1)' : '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#6fa5b5', marginBottom: '8px' }}>{t.comparisonTitle}</div>
                        <table style={{ width: '100%', fontSize: '0.65rem', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: theme === 'light' ? '1px solid #ddd' : '1px solid #333', color: theme === 'light' ? '#666' : '#888' }}>
                                    <th style={{ textAlign: 'left', padding: '4px' }}>Type</th>
                                    <th style={{ textAlign: 'center', padding: '4px' }}>{country.evaluation ? t.pairedToday : "Today"}</th>
                                    <th style={{ textAlign: 'center', padding: '4px' }}>{t.pairedBaseline}</th>
                                    <th style={{ textAlign: 'right', padding: '4px' }}>Ratio</th>
                                </tr>
                            </thead>
                            <tbody>
                                {['R1', 'R2', 'R3', 'R4'].map(key => {
                                    const data = country.surge_r_by_type[key];
                                    if (!data) return null;

                                    const th = country.surge_r?.thresholds || { yellow: 1.75, orange: 2.75, red: 3.75 };
                                    const ratio = Number(data.ratio || 0);

                                    const displayLevel = data.comparison_level || (data.ratio == null ? 'unknown' : data.is_active ? ratio >= th.red ? 'red' : ratio >= th.orange ? 'orange' : 'yellow' : 'green');
                                    const levelColor = {red:'var(--color-red)',orange:'var(--color-orange)',yellow:'var(--color-yellow)',green:'var(--color-green)',unknown:'#aaa'}[displayLevel];
                                    const levelLabel = data.ratio == null ? t.comparisonStatus[data.data_status] || t.legend.unknown : `${data.reference?.valid_days || 0} / ${data.reference?.required_days || 10} ${t.comparisonDays}`;

                                    return (
                                        <tr key={key} style={{ borderBottom: theme === 'light' ? '1px solid rgba(0,0,0,0.1)' : '1px solid rgba(255,255,255,0.05)', color: levelColor }}>
                                            <td style={{ textAlign: 'left', padding: '4px' }}>
                                                <div style={{ fontWeight: data.is_active ? 'bold' : 'normal' }}>
                                                    {key} {data.is_active ? '●' : ''} {levelLabel}
                                                </div>
                                                <div style={{ fontSize: '0.55rem', opacity: 0.6 }}>{t.panel.rLabels[key.toLowerCase()]}</div>
                                                <div style={{fontSize:'0.6rem'}}>{data.gate_reasons?.map(reason=>t.reasons[reason] || reason).join(' / ')}</div>
                                            </td>
                                            <td style={{ textAlign: 'center', padding: '4px' }}>{data.today}</td>
                                            <td style={{ textAlign: 'center', padding: '4px' }}>{data.baseline_median ?? '—'}</td>
                                            <td style={{ textAlign: 'right', padding: '4px', fontWeight: 'bold' }}>{data.ratio == null ? '—' : data.ratio.toFixed(2)+'x'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div style={{ fontSize: '0.55rem', color: theme === 'light' ? '#888' : '#666', marginTop: '8px', fontStyle: 'italic', wordBreak: 'break-all' }}>
                            {country.evaluation ? t.global.matchedNote : "Colors follow is_active."}
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
                        if(sr.method==='same-offset-observed-7d-pairs-v2')return {state:sr.level,color:{red:'var(--color-red)',orange:'var(--color-orange)',yellow:'var(--color-yellow)',green:'var(--color-green)',unknown:'#666'}[sr.level],text:sr.ratio7==null?'—':sr.ratio7.toFixed(1),reason:sr.reason};
                        const ratio7 = sr.ratio7 || 0;
                        const isActive = sr.is_active || false;
                        const yellowThr = thresholds?.yellow || 1.75;
                        const orangeThr = thresholds?.orange || 2.75;
                        const redThr = thresholds?.red || 3.75;

                        if (isActive) {
                            const level = ratio7 >= redThr ? 'red' : ratio7 >= orangeThr ? 'orange' : ratio7 >= yellowThr ? 'yellow' : 'none';
                            const levelColor = level === 'red' ? 'var(--color-red)' : level === 'orange' ? 'var(--color-orange)' : level === 'yellow' ? 'var(--color-yellow)' : (theme === 'light' ? '#ccc' : '#444');
                            return { state: 'active', color: levelColor, text: ratio7.toFixed(1), reason: `ACTIVE: ${ratio7.toFixed(2)}x` };
                        } else if (ratio7 >= yellowThr) {
                            return { state: 'gated', color: theme === 'light' ? '#999' : '#666', text: 'G', reason: `GATED: ${sr.reason || 'gate condition'}\nRatio: ${ratio7.toFixed(2)}x` };
                        } else {
                            return { state: 'none', color: theme === 'light' ? '#e0e0e0' : (theme === 'dark' ? '#222' : '#333'), text: '', reason: `NONE: ratio7 ${ratio7.toFixed(2)}x < ${yellowThr}` };
                        }
                    };

                    const thresholds = { yellow: 1.75, orange: 2.75, red: 3.75 };

                    return (
                        <div style={{ marginTop: '1rem', padding: '10px', background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(0,0,0,0.3)', borderRadius: '4px', border: theme === 'light' ? '1px solid rgba(0,0,0,0.1)' : '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ fontSize: '0.7rem', fontWeight: 'bold', color: theme === 'light' ? 'var(--color-accent)' : '#6fa5b5', marginBottom: '8px' }}>4-WEEK TREND (Weekly ISO)</div>

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

                                    let bundleLabel = activeTypes.length > 0 ? activeTypes.join('+') : (hasGated ? 'G' : '');
                                    let bundleColor = theme === 'light' ? '#e0e0e0' : '#444';
                                    let textColor = theme === 'light' ? '#666' : '#888';

                                    if (activeTypes.length > 0) {
                                        const maxRatio = Math.max(...activeTypes.map(r => w.weekly_surge_r_by_type?.[r]?.ratio7 || 0));
                                        if (maxRatio >= thresholds.red) { bundleColor = 'var(--color-red)'; textColor = '#fff'; }
                                        else if (maxRatio >= thresholds.orange) { bundleColor = 'var(--color-orange)'; textColor = '#000'; }
                                        else { bundleColor = 'var(--color-yellow)'; textColor = '#000'; }
                                    }
                                    if(w.evaluation){bundleColor={red:'var(--color-red)',orange:'var(--color-orange)',yellow:'var(--color-yellow)',green:'var(--color-green)',unknown:'#666'}[w.overall_level];bundleLabel=w.overall_level==='unknown'?t.legend.unknown:t.alertLabels[w.overall_level];textColor='#fff';}

                                    return (
                                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', background: theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)', padding: '4px 2px', borderRadius: '3px' }}>
                                            <span style={{ fontSize: '0.55rem', color: theme === 'light' ? '#666' : '#888', marginBottom: '2px' }}>{w.week?.slice(-3) || `W${i}`}</span>
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
                                    <tr style={{ color: theme === 'light' ? '#666' : '#888' }}>
                                        <th style={{ textAlign: 'left', padding: '2px' }}>Type</th>
                                        {last4Weeks.map(w => (
                                            <th key={w.week} style={{ textAlign: 'center', padding: '2px' }}>{w.week?.slice(-3) || ''}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {['R1', 'R2', 'R3', 'R4'].map(rKey => (
                                        <tr key={rKey} style={{ borderBottom: theme === 'light' ? '1px solid rgba(0,0,0,0.05)' : '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ textAlign: 'left', padding: '2px' }}>
                                                <div style={{ color: theme === 'light' ? '#333' : '#ccc' }}>{rKey}</div>
                                                <div style={{ fontSize: '0.5rem', opacity: theme === 'light' ? 0.8 : 0.5, color: theme === 'light' ? '#666' : '#888' }}>{t.panel.rLabels[rKey.toLowerCase()]}</div>
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
                                                                color: signal.state === 'gated' ? (theme === 'light' ? '#666' : '#aaa') : (signal.color === 'var(--color-yellow)' ? '#000' : '#fff'),
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
                                if(last4Weeks.some(w=>w.evaluation) && !last4Weeks.some(w=>Object.values(w.ratios||{}).some(r=>r!==null)))return <p>{t.comparisonStatus.baseline_days_insufficient}</p>;
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
                                    <div style={{ fontSize: '0.6rem', color: theme === 'light' ? '#666' : '#ccc', fontStyle: 'italic', background: theme === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: '2px', display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Pattern: <strong style={{ color: theme === 'light' ? '#000' : '#fff' }}>{pattern}</strong> {detail && <span style={{ opacity: 0.7 }}>({detail})</span>}</span>
                                    </div>
                                );
                            })()}

                            {/* Updated Note */}
                            <div style={{ fontSize: '10px', opacity: theme === 'light' ? 0.8 : 0.6, color: theme === 'light' ? '#666' : 'inherit', marginTop: '6px', lineHeight: '1.2' }}>
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
                                <tr style={{ borderBottom: theme === 'light' ? '1px solid #ddd' : '1px solid #333', color: theme === 'light' ? '#666' : '#888' }}>
                                    <th style={{ textAlign: 'left', padding: '2px' }}>{t.panel.indicator}</th>
                                    <th style={{ textAlign: 'center', padding: '2px' }}>Raw</th>
                                    <th style={{ textAlign: 'center', padding: '2px' }}>Adj</th>
                                    <th style={{ textAlign: 'center', padding: '2px' }}>Ratio</th>
                                </tr>
                            </thead>
                            <tbody>
                                {['R1', 'R2', 'R3', 'R4'].map(key => (
                                    <tr key={key} style={{ borderBottom: theme === 'light' ? '1px dotted #ddd' : '1px dotted #222' }}>
                                        <td style={{ padding: '2px' }}>
                                            <div style={{ color: theme === 'light' ? '#333' : '#aaa' }}>{key}</div>
                                            <div style={{ fontSize: '0.55rem', opacity: 0.6, color: theme === 'light' ? '#666' : '#888' }}>{t.panel.rLabels[key.toLowerCase()]}</div>
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
                        <div style={{ fontSize: '0.55rem', color: theme === 'light' ? '#888' : '#555', marginTop: '4px', fontStyle: 'italic' }}>
                            * Mode: {country.v4_scoring?.debug?.mode || 'none'}
                        </div>
                    </div>
                )}

                <div style={{ fontSize: '0.6rem', color: '#666', marginTop: '0.5rem', fontStyle: 'italic', textAlign: 'center', lineHeight: '1.2' }}>
                    {lang === 'ja'
                        ? "報道記録の指標（独立事件数ではありません）"
                        : "News-record indicators, not independent incident counts."}
                </div>
            </div>

            {/* KEY SOURCES (Moved above Signals) */}
            {country.article_interpretations?.length>0 && <section className="article-interpretations"><h4>R / Article context</h4><small>{t.global.articleContextScope}</small>{country.article_interpretations.map(a=><article key={a.article_id}><a href={a.url} target="_blank" rel="noopener noreferrer">{a.title_localized?.[lang] || a.article_id} ↗</a>{a.summary_localized?.[lang] && <p>{a.summary_localized[lang]}</p>}{a.claims.map((c,i)=><p key={i}>{c.r || 'Unknown'} · {c.subcategory} · {c.direction}: {c.reason}</p>)}</article>)}</section>}
            {country.confirmed_impacts?.length > 0 && <section className="confirmed-impacts"><h4>{t.methods.verified}</h4><p>{t.global.localImpactScope}</p>{country.confirmed_impacts.map(impact => <article key={impact.event_id}><p>{impact.impact_localized?.[lang] || impact.impact} · {impact.scope}</p><small>{impact.period?.publication_date} · {impact.assessment?.current_at_cutoff ? t.impactCurrent : t.impactHistorical} · {impact.verification.verified_at} · {impact.confidence}</small><p>{impact.evidence.map(e => <a key={e.url} href={e.url} target="_blank" rel="noopener noreferrer">{e.original_source_id} ↗ </a>)}</p></article>)}</section>}
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

            <CountryGoogleInterest key={country.iso2+editionDate} country={country.iso2} day={editionDate} lang={lang} />

            {signals?.pm?.length > 0 && (
                <div className="modal-signals" style={{marginTop:"1rem"}}>
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
