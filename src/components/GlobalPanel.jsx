import { useRef, useEffect, useMemo } from 'react';

export default function GlobalPanel({ riskData, onCountrySelect, selectedCountry, onSignalSelect, selectedSignal, hoveredSignal, hoveredCountry, t, lang, viewMode }) {
    const scrollRef = useRef(null);

    // 1) BRIEFING Logic
    const getBriefingContent = () => {
        if (!riskData) return null;

        // Determine source based on ViewMode
        let source = riskData.daily_briefing; // Default (legacy/fallback)
        if (viewMode === 'surge') {
            source = riskData.daily_briefing_trending || source;
        } else if (viewMode === 'raw' || viewMode === 'surge_r') {
            source = riskData.daily_briefing_ops || source;
        }

        // New Object Support
        if (source && Array.isArray(source[lang])) {
            const lines = source[lang];
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

        // Legacy string Support
        let text = "";
        if (lang === 'ja' && riskData.daily_briefing_ja) text = riskData.daily_briefing_ja;
        else if (lang === 'es' && riskData.daily_briefing_es) text = riskData.daily_briefing_es;
        else text = riskData.daily_briefing_en || "...";

        return <div>{text}</div>;
    };

    // 2) HEAT LIST Logic
    const sortedCountries = useMemo(() => {
        if (!riskData?.countries) return [];
        const all = Object.entries(riskData.countries).map(([iso2, data]) => ({ iso2, ...data }));

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
            .filter(c => c.alert_level !== 'green')
            .sort((a, b) => (levels[b.alert_level] || 0) - (levels[a.alert_level] || 0) || b.composite_score - a.composite_score || a.iso2.localeCompare(b.iso2))
            .slice(0, 15);
    }, [riskData, viewMode]);

    const getAlertStyle = (country) => {
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
        <div className="global-panel" ref={scrollRef}>
            {/* 1) AI DAILY BRIEFING */}
            <div className="briefing-section">
                <h3><span className="icon">◎</span> {t?.global?.briefing || 'AI DAILY BRIEFING'}</h3>
                <div className="briefing-text">{getBriefingContent()}</div>
            </div>

            {/* 2) Global Heat List */}
            <div className="heat-list-section">
                <div className="section-header">
                    <h3><span className="icon">📈</span> {t?.global?.heatList || 'Global Heat List'}</h3>
                    <span className="badge">Top {sortedCountries.length}</span>
                </div>

                <div className="heat-list-header">
                    <span className="col-rank">#</span>
                    <span className="col-country">{t?.global?.country || 'Country'}</span>
                    <span className="col-risk">{t?.global?.risk || 'Risk'}</span>
                    <span className="col-summary">{t?.global?.summary || 'Summary'}</span>
                </div>

                <ul className="heat-list">
                    {sortedCountries.map((country, idx) => (
                        <li
                            key={country.iso2}
                            className={`heat-list-item ${selectedCountry === country.iso2 ? 'heat-list-item--selected' : ''} ${hoveredCountry === country.iso2 ? 'heat-list-item--hovered' : ''}`}
                            onClick={() => onCountrySelect(country.iso2)}
                        >
                            <span className="col-rank">{(viewMode === 'surge' || viewMode === 'index' || viewMode === 'surge_r') ? (country[viewMode]?.rank || idx + 1) : idx + 1}</span>
                            <div className="col-country">
                                <span className="country-name">{lang === 'ja' ? (country.name_ja || country.name_en) : (lang === 'es' ? (country.name_es || country.name_en) : country.name_en)}</span>
                                <span className="country-driver">
                                    {viewMode === 'index' ? `Index: ${country.index?.score.toFixed(1)}` :
                                        viewMode === 'surge' ? `Surge: ${country.surge?.score.toFixed(1)}` :
                                            viewMode === 'surge_r' ? `SurgeR: ${country.surge_r?.max_ratio_active?.toFixed(1)}` :
                                                `Rank Score: ${country.composite_score?.toFixed(1)}`}
                                </span>
                            </div>
                            <span className="col-risk" style={getAlertStyle(country)}>{getAlertLabel(country)}</span>
                            <span className="col-summary">
                                {(country.brief?.headline ||
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
