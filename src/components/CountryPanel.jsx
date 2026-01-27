function ScoreBar({ label, score, max = 10 }) {
    const percentage = (score / max) * 100;
    const color = score >= 7 ? '#ff3b3b' : score >= 5 ? '#ff8c00' : score >= 3 ? '#ffd700' : '#3d4654';

    return (
        <div className="score-bar">
            <div className="score-label">{label}</div>
            <div className="score-track">
                <div
                    className="score-fill"
                    style={{ width: `${percentage}%`, backgroundColor: color }}
                />
            </div>
            <div className="score-value">{score.toFixed(1)}</div>
        </div>
    );
}

export default function CountryPanel({ country, onClose, t, lang, viewMode }) {
    if (!country) {
        return (
            <div className="country-panel country-panel--empty">
                <p>{t?.panel?.placeholder || 'SELECT A COUNTRY'}</p>
            </div>
        );
    }

    const alertLabel = t?.alertLabels?.[country.alert_level] || country.alert_level.toUpperCase();

    // Get localized name and summary based on language
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

    const getAlertColor = () => {
        if (viewMode === 'surge' && country.surge) {
            if (country.surge.rank <= 10) return 'var(--color-red)';
            if (country.surge.rank <= 20) return 'var(--color-orange)';
            if (country.surge.rank <= 40) return 'var(--color-yellow)';
            return '#3d4654';
        }
        if (viewMode === 'index' && country.index) {
            const level = country.index.level.toLowerCase();
            return `var(--color-${level})`;
        }
        return `var(--color-${country.alert_level})`;
    };

    const getAlertText = () => {
        if (viewMode === 'surge' && country.surge) {
            if (country.surge.rank <= 10) return 'TOP 10';
            if (country.surge.rank <= 20) return 'TOP 20';
            if (country.surge.rank <= 40) return 'TOP 40';
            return 'STABLE';
        }
        if (viewMode === 'index' && country.index) {
            return country.index.level.toUpperCase();
        }
        return alertLabel;
    };

    return (
        <div className="country-panel">
            <div className="country-header">
                <div className="country-title">
                    <h2>{getName()}</h2>
                    {lang !== 'en' && <span className="country-name-en">{country.name_en}</span>}
                </div>
                <span
                    className={`alert-badge`}
                    style={{
                        backgroundColor: getAlertColor(),
                        color: (viewMode === 'surge' && country.surge?.rank > 20 && country.surge?.rank <= 40) || (viewMode === 'raw' && (country.alert_level || '').toLowerCase() === 'yellow') || (viewMode === 'index' && (country.index?.level || '').toLowerCase() === 'yellow') ? '#000' : '#fff'
                    }}
                >
                    {getAlertText()}
                </span>
            </div>

            <div className="country-scores">
                <h3>{viewMode === 'surge_r'
                    ? `RISK SCORE (R-INDEX): Max Ratio ${country.surge_r?.max_ratio_active?.toFixed(1) || '0.0'}`
                    : `${t?.panel?.riskScores || 'RISK SCORES'} (${viewMode === 'surge' ? t?.viewMode?.surge : (viewMode === 'index' ? t?.viewMode?.index : (viewMode === 'adj' ? t?.viewMode?.adj : t?.viewMode?.raw))})`
                }</h3>
                {(() => {
                    // [P0] HIDE TOP BARS for surge_r (User Request)
                    if (viewMode === 'surge_r') return null;

                    let displayScores = {};
                    let labelMap = {};

                    if (viewMode === 'raw') {
                        displayScores = country.r_scores_raw || country.r_scores || {};
                    } else {
                        // 'index', 'adj', 'surge' (trending), or default
                        displayScores = country.r_scores_adj || country.r_scores || {};
                    }

                    // Labels mapping if needed, otherwise defaults in ScoreBar prop
                    // Note: R1-R4 Labels are passed as props to ScoreBar below.

                    return (
                        <>
                            <ScoreBar label={t?.panel?.r1 || 'R1 Security'} score={parseFloat(displayScores.R1 || 0)} />
                            <ScoreBar label={t?.panel?.r2 || 'R2 Infrastructure'} score={parseFloat(displayScores.R2 || 0)} />
                            <ScoreBar label={t?.panel?.r3 || 'R3 Governance'} score={parseFloat(displayScores.R3 || 0)} />
                            <ScoreBar label={t?.panel?.r4 || 'R4 Economy'} score={parseFloat(displayScores.R4 || 0)} />
                        </>
                    );
                })()}

                {viewMode === 'index' && country.index && (
                    <div style={{ marginTop: '0.8rem', padding: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <span style={{ fontSize: '0.7rem', color: '#888' }}>INDEX SCORE:</span>
                            <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{country.index.score.toFixed(1)}</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '0.65rem', color: '#666' }}>
                            <span>Raw (B*{country.index.bundle_count}): {country.index.rawScore}</span>
                            <span>Surge Score: {country.index.surgeScore}</span>
                        </div>
                        <div style={{ marginTop: '6px', fontSize: '0.6rem', color: '#555', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '4px', fontStyle: 'italic' }}>
                            INDEX = (bundle_count×2.5) × max(R1..R4 surge) / 10
                        </div>
                    </div>
                )}

                <div className="composite-score">
                    {t?.panel?.composite || 'Composite Score'}: <strong>{country.composite_score?.toFixed(1)}</strong> / 10
                </div>
            </div>

            <div className="country-summary">
                <h3>{t?.panel?.summary || 'SITUATION SUMMARY'}</h3>
                <p>{getSummary()}</p>
            </div>

            {country.sources && country.sources.length > 0 && (
                <div className="country-sources">
                    <h3>{t?.panel?.sources || 'KEY SOURCES'}</h3>
                    <ul className="sources-list">
                        {country.sources.map((src, idx) => (
                            <li key={idx}>
                                <a href={src.url} target="_blank" rel="noopener noreferrer">
                                    <span className="source-title">{src.title}</span>
                                    <span className="source-name">{src.source}</span>
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
