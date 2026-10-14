import { useRef, useEffect, useMemo, useState } from 'react';
import { briefingLines, countryLevel, monitoringMethod } from '../display';

export default function GlobalPanel({ riskData, onCountrySelect, selectedCountry, onSignalSelect, selectedSignal, hoveredSignal, hoveredCountry, t, lang, viewMode, onViewModeChange }) {
    const scrollRef = useRef(null);
    const [levelFilter,setLevelFilter]=useState('all');

    // 1) BRIEFING Logic
    const getBriefingContent = () => {
        if (!riskData) return null;

        const lines = briefingLines(riskData, viewMode, lang);
        if (lines.length) {
            const filteredLines = lines.filter(line => {
                const l = line.trim();
                return !(
                    l.startsWith("世界の報道機関は、いくつかの主要地域に注目している") ||
                    l.startsWith("Global news organizations are focusing") ||
                    l.startsWith("Las agencias de noticias mundiales")
                );
            });

            return filteredLines.map((line, idx) => {
                const isLast = idx === filteredLines.length - 1;
                const isDisclaimer = isLast && (
                    line.includes("事実認定ではない") ||
                    line.includes("fact certification") ||
                    line.includes("certificación oficial")
                );

                if (isDisclaimer) {
                    return (
                        <div key={idx} style={{
                            marginTop: '1em',
                            fontSize: '0.85em',
                            color: 'var(--color-text-dim, #a1a1aa)',
                            opacity: 0.8,
                            lineHeight: 1.4
                        }}>
                            （{line.replace(/[「」（）()]/g, '').trim()}）
                        </div>
                    );
                }

                return (
                    <div key={idx} style={{ marginBottom: '0.5em' }}>{line}</div>
                );
            });
        }

        return <div>{t.global.noBriefing}</div>;
    };

    // 2) HEAT LIST Logic
    const sortedCountries = useMemo(() => {
        if (!riskData?.countries) return [];
        const allRows = Object.entries(riskData.countries).map(([iso2, data]) => ({ iso2, ...data }));
        if(allRows.some(country=>country.evaluation)) {
            const levels={red:4,orange:3,yellow:2,green:1,unknown:0};
            return allRows.filter(country=>levelFilter==='all' ? countryLevel(country,viewMode)!=='unknown' : countryLevel(country,viewMode)===levelFilter)
                .sort((a,b)=>levels[countryLevel(b,viewMode)]-levels[countryLevel(a,viewMode)] ||
                    (viewMode==='surge_r' ? (b.surge_r?.max_ratio_active || 0)-(a.surge_r?.max_ratio_active || 0) : (b.composite_score || 0)-(a.composite_score || 0)) || a.iso2.localeCompare(b.iso2))
                .slice(0,40);
        }
        const all=allRows.filter(country=>countryLevel(country,viewMode)!=='unknown');

        if (viewMode === 'index') {
            return all
                .filter(c => (c.index?.score || 0) > 0)
                .sort((a, b) => (b.index?.score || 0) - (a.index?.score || 0) || a.iso2.localeCompare(b.iso2))
                .slice(0, 40);
        }

        if (viewMode === 'surge') {
            return all
                .filter(c => (c.surge?.score || 0) > 0)
                .sort((a, b) => (b.surge?.score || 0) - (a.surge?.score || 0) || a.iso2.localeCompare(b.iso2))
                .slice(0, 40);
        }

        if (viewMode === 'surge_r') {
            return all
                .filter(c => (c.surge_r?.max_ratio_active || 0) > 0)
                .sort((a, b) => (b.surge_r?.max_ratio_active || 0) - (a.surge_r?.max_ratio_active || 0) || a.iso2.localeCompare(b.iso2))
                .slice(0, 40);
        }

        // RAW (Default)
        const levels = { red: 3, orange: 2, yellow: 1, green: 0 };
        return all
            .filter(c => ['red', 'orange', 'yellow'].includes(c.alert_level))
            .sort((a, b) => (levels[b.alert_level] || 0) - (levels[a.alert_level] || 0) || b.composite_score - a.composite_score || a.iso2.localeCompare(b.iso2))
            .slice(0, 15);
    }, [riskData, viewMode,levelFilter]);

    const getAlertStyle = (country) => {
        if(country.evaluation) {
            const level=countryLevel(country,viewMode);
            return {backgroundColor:level==='unknown'?'#3d4654':`var(--color-${level})`,color:level==='yellow'?'#000':'#fff'};
        }
        if (country.data_status && !['observed','partial'].includes(country.data_status)) return { backgroundColor: '#3d4654', color: '#fff' };
        if (viewMode === 'surge_r' && country.baseline_status === 'baseline_insufficient') return { backgroundColor: '#3d4654', color: '#fff' };
        if (viewMode === 'index') {
            const level = country.index?.level?.toLowerCase() || 'green';
            return { backgroundColor: `var(--color-${level})`, color: (level || '').toLowerCase() === 'yellow' ? '#000' : '#fff' };
        }
        if (viewMode === 'surge') {
            const rank = country.surge?.rank;
            let bgColor = '#3d4654';
            if (rank <= 10) bgColor = 'var(--color-red)';
            else if (rank <= 20) bgColor = 'var(--color-orange)';
            else if (rank <= 40) bgColor = 'var(--color-yellow)';
            return { backgroundColor: bgColor, color: (rank > 20 && rank <= 40) ? '#000' : '#fff' };
        }
        if (viewMode === 'surge_r') {
            const level = country.surge_r?.level?.toLowerCase() || 'green';
            return { backgroundColor: `var(--color-${level})`, color: level === 'yellow' ? '#000' : '#fff' };
        }
        return {
            backgroundColor: `var(--color-${country.alert_level})`,
            color: (country.alert_level || '').toLowerCase() === 'yellow' ? '#000' : '#fff'
        };
    };

    const getAlertLabel = (country) => {
        if(country.evaluation) {
            const level=countryLevel(country,viewMode);
            const label=level==='green' ? t.green : level==='unknown' ? t.legend.unknown : t.alertLabels[level];
            return label+(country.evaluation.partial_observation ? ` · ${t.global.partialShort}` : '');
        }
        if (country.data_status === 'partial' && viewMode !== 'surge_r') return `${country.alert_level?.toUpperCase() || 'UNKNOWN'} · PARTIAL`;
        if (country.data_status && !['observed','partial'].includes(country.data_status)) return country.data_status.toUpperCase();
        if (viewMode === 'surge_r' && country.baseline_status === 'baseline_insufficient') return 'BASELINE INSUFFICIENT';
        if (viewMode === 'index') return country.index?.level?.toUpperCase() || 'STABLE';
        if (viewMode === 'surge') {
            const rank = country.surge?.rank;
            if (rank <= 10) return 'TOP 10';
            if (rank <= 20) return 'TOP 20';
            if (rank <= 40) return 'TOP 40';
            return 'STABLE';
        }
        if (viewMode === 'surge_r') return country.surge_r?.level?.toUpperCase() || 'STABLE';
        const level = country.alert_level;
        const safeLevel = (level || '').toLowerCase();
        if (safeLevel === 'red') return t?.legend?.critical || 'CRITICAL';
        if (safeLevel === 'orange') return t?.legend?.warning || 'WARNING';
        if (safeLevel === 'yellow') return t?.legend?.watch || 'WATCH';
        return t?.legend?.stable || 'STABLE';
    };

    // 3) AIR SIGNALS Logic
    const googleTrends = riskData?.google_trends || [];
    const snsSurge = riskData?.air?.sns_top10 || [];
    const polymarket = riskData?.polymarket || [];

    // Scroll into view effector
    useEffect(() => {
        if (selectedSignal) {
            const el = document.querySelector('.signal-item--selected');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [selectedSignal]);

    // Scroll to hovered signal
    useEffect(() => {
        if (hoveredSignal) {
            const el = document.querySelector('.signal-item--hovered');
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [hoveredSignal]);

    // Scroll to hovered country
    useEffect(() => {
        if (hoveredCountry) {
            const el = document.querySelector('.heat-list-item--hovered');
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [hoveredCountry]);

    // Scroll to selected country
    useEffect(() => {
        if (selectedCountry) {
            const el = document.querySelector('.heat-list-item--selected');
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [selectedCountry]);

    return (
        <div className="global-panel" ref={scrollRef} data-snapshot-id={riskData?.snapshot_id}>
            {/* 1) AI DAILY BRIEFING */}
            <div className="briefing-section">
                <h3><span className="icon">◎</span> {riskData?.engine_version ? t.global.monitoringSummary : t.global.briefing}</h3>
                <div className="briefing-text">{getBriefingContent()}</div>
            </div>

            {/* 2) Global Heat List */}
            <div className="heat-list-section">
                <div className="section-header">
                    <h3><span className="icon">📈</span> {t?.global?.heatList || 'Global Heat List'}</h3>
                    <span className="badge">{sortedCountries.length ? `Top ${sortedCountries.length}` : viewMode === 'surge_r' ? t.global.noComparable : t.global.none}</span>
                </div>

                {riskData?.engine_version && <label className="level-filter">{t.global.levelFilter} <select value={levelFilter} onChange={event=>setLevelFilter(event.target.value)}>
                    <option value="all">{t.global.assessed}</option>
                    {['red','orange','yellow','green','unknown'].map(level=><option key={level} value={level}>{level==='green'?t.green:level==='unknown'?t.legend.unknown:t.alertLabels[level]}</option>)}
                </select></label>}
                {sortedCountries.length === 0 && <div className="heat-list-empty" role="status">
                    <p>{viewMode === 'surge_r' ? t.global.rIndexUnavailable : t.global.noHeat}</p>
                    {viewMode === 'surge_r' && onViewModeChange && <button type="button" onClick={() => onViewModeChange('raw')}>{t.global.showRaw}</button>}
                </div>}
                {sortedCountries.length > 0 && <div className="heat-list-header">
                    <span className="col-rank">#</span>
                    <span className="col-country">{t?.global?.country || 'Country'}</span>
                    <span className="col-risk">{t?.global?.risk || 'Risk'}</span>
                    <span className="col-summary">{t?.global?.summary || 'Summary'}</span>
                </div>}

                <ul className="heat-list">
                    {sortedCountries.map((country, idx) => (
                        <li
                            key={country.iso2}
                            data-country={country.iso2}
                            data-monitoring-level={countryLevel(country,viewMode)}
                            className={`heat-list-item ${selectedCountry === country.iso2 ? 'heat-list-item--selected' : ''} ${hoveredCountry === country.iso2 ? 'heat-list-item--hovered' : ''}`}
                            onClick={() => onCountrySelect(country.iso2)}
                        >
                            <span className="col-rank">{(viewMode === 'surge' || viewMode === 'index' || viewMode === 'surge_r') ? (country[viewMode]?.rank || idx + 1) : idx + 1}</span>
                            <div className="col-country">
                                <span className="country-name">{lang === 'ja' ? (country.name_ja || country.name_en) : (lang === 'es' ? (country.name_es || country.name_en) : country.name_en)}</span>
                                <span className="country-driver">
                                    {country.evaluation ? monitoringMethod(country,t) : viewMode === 'index' ? `Index: ${country.index?.score?.toFixed(1) ?? t.legend.unknown}` :
                                        viewMode === 'surge' ? `Surge: ${country.surge?.score.toFixed(1)}` :
                                            viewMode === 'surge_r' ? `SurgeR: ${country.surge_r?.max_ratio_active?.toFixed(1)}` :
                                                `Rank Score: ${country.composite_score?.toFixed(1) ?? t.legend.unknown}`}
                                </span>
                            </div>
                            <span className="col-risk" style={getAlertStyle(country)}>{getAlertLabel(country)}</span>
                            <span className="col-summary">
                                {((country.evaluation ? (lang==='ja'?country.summary_ja:lang==='es'?country.summary_es:country.summary_en) : null) || country.brief?.headline ||
                                    (lang === 'ja' ? country.summary_ja : (lang === 'es' ? (country.summary_es || country.summary_en) : country.summary_en)) ||
                                    country.brief?.what_happened) || "..."}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>

            {/* 3) AIR SIGNALS */}
            <div className="air-signals-section">
                <div className="section-header">
                    <h3><span className="icon">📡</span> {t?.global?.airSignals || 'AIR SIGNALS'}</h3>
                </div>

                <div className="signal-group">
                    <ul className="signal-list">
                        {/* Google Trends */}
                        {googleTrends.length > 0 && (
                            <div className="air-caption-item" style={{ fontSize: '0.85em', color: 'var(--color-text-dim, #a1a1aa)', opacity: 0.8, padding: '8px 4px 4px' }}>
                                📡 {t?.global?.airCaptions?.gt}
                            </div>
                        )}
                        {googleTrends.map((item, idx) => {
                            const isGray = item.is_political === false;
                            const iso = item.iso2 || item.geo;
                            const isHovered = hoveredSignal?.type === 'gt' && hoveredSignal?.index === idx;
                            const isSelected = selectedSignal?.type === 'gt' && selectedSignal?.index === idx;
                            return (
                                <li
                                    key={`gt-${idx}`}
                                    className={`signal-item ${isSelected ? 'signal-item--selected' : ''} ${isHovered ? 'signal-item--hovered' : ''}`}
                                    onClick={() => {
                                        if (iso) onCountrySelect(iso);
                                        onSignalSelect({ type: 'gt', index: idx, ...item });
                                    }}
                                >
                                    <span
                                        className="signal-id"
                                        style={isGray ? { backgroundColor: '#52525b', color: '#a1a1aa' } : {}}
                                    >
                                        GT{(idx + 1).toString().padStart(2, '0')}
                                    </span>
                                    <span
                                        className="signal-text"
                                        style={isGray ? { color: '#a1a1aa' } : {}}
                                    >
                                        {item.term || item.title}
                                    </span>
                                    <span className="signal-geo">{iso}</span>
                                    <span className="signal-value">{item.ps_today > 0 ? `P:${item.ps_today.toFixed(1)}` : `#${item.rank}`}</span>
                                </li>
                            );
                        })}

                        {/* SNS Political Surge */}
                        {snsSurge.length > 0 && (
                            <div className="air-caption-item" style={{ fontSize: '0.85em', color: 'var(--color-text-dim, #a1a1aa)', opacity: 0.8, padding: '16px 4px 4px' }}>
                                📡 {t?.global?.airCaptions?.xt}
                            </div>
                        )}
                        {snsSurge.map((item, idx) => {
                            const isHovered = hoveredSignal?.type === 'xt' && hoveredSignal?.index === idx;
                            const isSelected = selectedSignal?.type === 'xt' && selectedSignal?.index === idx;
                            return (
                                <li
                                    key={`sns-${idx}`}
                                    className={`signal-item ${isSelected ? 'signal-item--selected' : ''} ${isHovered ? 'signal-item--hovered' : ''}`}
                                    onClick={() => {
                                        if (item.iso2) onCountrySelect(item.iso2);
                                        onSignalSelect({ type: 'xt', index: idx, ...item });
                                    }}
                                >
                                    <span className="signal-id" style={{ backgroundColor: 'rgba(255, 126, 226, 0.2)', color: '#ff7ee2' }}>
                                        SNS{(idx + 1).toString().padStart(2, '0')}
                                    </span>
                                    <span className="signal-text">{Array.isArray(item.political_terms) ? item.political_terms.join(', ') : item.term}</span>
                                    <span className="signal-geo">{item.iso2}</span>
                                    <span className="signal-value">{item.volume_text || `PS:${item.ps_today?.toFixed(1)}`}</span>
                                </li>
                            );
                        })}

                        {/* Polymarket */}
                        {polymarket.length > 0 && (
                            <div className="air-caption-item" style={{ fontSize: '0.85em', color: 'var(--color-text-dim, #a1a1aa)', opacity: 0.8, padding: '16px 4px 4px' }}>
                                📡 {t?.global?.airCaptions?.pm}
                            </div>
                        )}
                        {polymarket.map((item, idx) => {
                            const isHovered = hoveredSignal?.type === 'pm' && hoveredSignal?.index === idx;
                            const isSelected = selectedSignal?.type === 'pm' && selectedSignal?.index === idx;
                            return (
                                <li
                                    key={`pm-${idx}`}
                                    className={`signal-item ${isSelected ? 'signal-item--selected' : ''} ${isHovered ? 'signal-item--hovered' : ''}`}
                                    onClick={() => {
                                        if (item.iso2 || item.geo) onCountrySelect(item.iso2 || item.geo);
                                        onSignalSelect({ type: 'pm', index: idx, ...item });
                                    }}
                                >
                                    <span className="signal-id signal-id--pm">PM{(idx + 1).toString().padStart(2, '0')}</span>
                                    <span className="signal-text">{item.title}</span>
                                    <span className="signal-geo">{item.iso2 || item.geo || item.country}</span>
                                    <span className="signal-value">{item.volume_text}</span>
                                    {item.url && (
                                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="signal-link" onClick={(e) => e.stopPropagation()}>
                                            ↗
                                        </a>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </div>
    );
}
