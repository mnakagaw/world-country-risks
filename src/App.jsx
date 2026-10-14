import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import MapView from './components/MapView';
import GlobalPanel from './components/GlobalPanel';
import CountryModal from './components/CountryModal';
import Header from './components/Header';
import CountryDetailView from './components/CountryDetailView';
import { translations, languages } from './i18n';
import { alertCounts as countAlerts,greenLabel } from './display';
import './Styles.css';

// Reusable Dashboard Component
function Dashboard({ lang, setLang, t, theme, toggleTheme }) {
    const [riskData, setRiskData] = useState(null);
    const [selectedCountry, setSelectedCountry] = useState(null);
    const [hoveredCountry, setHoveredCountry] = useState(null);
    const [selectedSignal, setSelectedSignal] = useState(null);
    const [hoveredSignal, setHoveredSignal] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [popupSide, setPopupSide] = useState('left');
    const [availableDates, setAvailableDates] = useState([]);
    const [viewMode, setViewMode] = useState(() => {const saved=localStorage.getItem('rw_view_mode');return ['surge_r','raw','monitoring'].includes(saved)?saved:saved?'monitoring':'surge_r';});
    const [historyIndex, setHistoryIndex] = useState({});
    const [regressionReport, setRegressionReport] = useState(null);
    const v2Manifest = useRef({});

    useEffect(() => {
        localStorage.setItem('rw_view_mode', viewMode);
    }, [viewMode]);

    // Compute surge ranks and index fallback whenever riskData changes
    const enrichedRiskData = useMemo(() => {
        if (!riskData?.countries) return riskData;

        const countriesArr = Object.entries(riskData.countries).map(([iso2, data]) => {
            const scores = data.r_scores_adj || data.r_scores || {};
            const surgeScore = Math.max(
                parseFloat(scores.R1 || 0),
                parseFloat(scores.R2 || 0),
                parseFloat(scores.R3 || 0),
                parseFloat(scores.R4 || 0)
            );

            // Fetch anomalies from regression report
            const anomalies = regressionReport?.countries?.[iso2]?.anomalies || [];

            return {
                iso2,
                ...data,
                surgeScore,
                anomalies
            };
        });

        countriesArr.sort((a, b) => {
            if (b.surgeScore !== a.surgeScore) return b.surgeScore - a.surgeScore;
            return a.iso2.localeCompare(b.iso2);
        });

        const newCountries = { ...riskData.countries };
        countriesArr.forEach((c, idx) => {
            newCountries[c.iso2] = {
                ...newCountries[c.iso2],
                surge: {
                    score: c.surgeScore,
                    rank: idx + 1
                }
            };

            if (!newCountries[c.iso2].index) {
                const bundleCount = newCountries[c.iso2].v4_scoring?.bundles || 0;
                const rawScore = Math.min(10, bundleCount * 2.5);
                const indexScore = (rawScore * c.surgeScore) / 10;
                let level = 'Green';
                if (indexScore >= 8) level = 'Red';
                else if (indexScore >= 4) level = 'Orange';
                else if (indexScore >= 2) level = 'Yellow';

                newCountries[c.iso2].index = {
                    score: parseFloat(indexScore.toFixed(1)),
                    level,
                    rawScore: parseFloat(rawScore.toFixed(1)),
                    surgeScore: parseFloat(c.surgeScore.toFixed(1)),
                    bundle_count: bundleCount
                };
            }
        });

        return { ...riskData, countries: newCountries };
    }, [riskData, regressionReport]);


    useEffect(() => {
        Promise.all([
            fetch('./data/v2/manifest.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}),
            fetch('./data/available_dates.json', { cache: 'no-store' }).then(r => r.json())
        ]).then(([v2, legacy]) => {
                v2Manifest.current = v2;
                const dates = [...new Set([...Object.keys(v2), ...legacy])].sort().reverse();
                setAvailableDates(dates);
                if (Object.keys(v2).length) fetchData(Object.keys(v2).sort().reverse()[0]);
                else if (dates.length > 0) fetchData(dates[0]);
                else fetchData('latest_v4');
            })
            .catch(() => fetchData('latest_v4'));

        // Load history index once for visibility checks (Tier B country series)
        fetch('./data/history/weekly_5y/index.json')
            .then(res => res.json())
            .then(idx => {
                console.log("Loaded Weekly History Index:", idx);
                setHistoryIndex(Object.fromEntries((idx?.countries || []).map(c => [c.iso2, c])));
            })
            .catch(err => console.error("Weekly History Index Load Error:", err));

        // Load regression report for data quality indicators
        fetch('./data/weekly/_regression_report.json')
            .then(res => res.json())
            .then(report => {
                console.log("Loaded Regression Report:", report);
                setRegressionReport(report);
            })
            .catch(err => console.warn("Regression Report Load Error (Data quality badges disabled):", err));
    }, []);

    const fetchData = (dateKey) => {
        setLoading(true);
        const fileName = v2Manifest.current[dateKey]?.path ? `v2/${v2Manifest.current[dateKey].path}` : `${dateKey}.json`;
        fetch(`./data/${fileName}`)
            .then(res => {
                if (!res.ok) throw new Error("Data load failed");
                return res.json();
            })
            .then(data => {
                setError(null);
                setRiskData(data);
                setLoading(false);
            })
            .catch(err => {
                console.error("Fetch Error:", err);
                setError(err.message);
                setLoading(false);
            });
    };

    const handleCountrySelect = useCallback((iso2, meta) => {
        setSelectedCountry(iso2);
        setSelectedSignal(null);
        if (meta?.side) setPopupSide(meta.side);
    }, []);

    const handleCountryHover = useCallback((iso2, meta) => {
        setSelectedCountry(prev => {
            if (prev) return prev; // If pinned, do nothing to hovered state
            setHoveredCountry(iso2);
            if (meta?.side) setPopupSide(meta.side);
            return prev;
        });
    }, []);

    const handleCountryLeave = useCallback(() => {
        setHoveredCountry(null);
    }, []);

    const handleSignalSelect = useCallback((signal) => {
        setSelectedSignal(signal);
        setSelectedCountry(null);
    }, []);

    const handleCloseModal = useCallback(() => {
        setSelectedCountry(null);
        setHoveredCountry(null);
    }, []);

    const handleDateChange = useCallback((newDate) => {
        fetchData(newDate);
    }, []);

    const alertCounts = countAlerts(enrichedRiskData?.countries, viewMode);

    /* Logic for Modal Data selection */
    const selectedData = useMemo(() => {
        const targetIso = selectedCountry || hoveredCountry;
        if (!targetIso || !enrichedRiskData?.countries) return null;
        const countryData = enrichedRiskData.countries[targetIso];
        if (!countryData) return null;
        return { iso2: targetIso, ...countryData, snapshot_id:enrichedRiskData.snapshot_id };
    }, [selectedCountry, hoveredCountry, enrichedRiskData]);

    if (loading) return <div className="app app--loading"><div className="loading-spinner">{t.loading}</div></div>;
    if (error) return <div className="app app--error"><div className="error-message">{t.error}: {error}</div></div>;

    return (
        <div className="app" data-snapshot-id={riskData?.snapshot_id} data-view-mode={viewMode}>
            <Header
                t={t}
                alertCounts={alertCounts}
                date={riskData?.date || riskData?.week}
                availableDates={availableDates}
                languages={languages}
                currentLang={lang}
                onSetLang={setLang}
                onDateChange={handleDateChange}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                theme={theme}
                toggleTheme={toggleTheme}
            />

            <div className="engine-data-status" role="status">
                <strong>{riskData?.engine_version ? `Engine v${riskData.engine_version}` : 'Legacy engine'}</strong>
                {' · '}締切 / Cutoff: {riskData?.cutoff_utc || riskData?.date || 'Unknown'}
                {' · '}データ / Data: {riskData?.source_status || 'legacy; coverage unverified'}
                {riskData?.coverage && ` · ${riskData.coverage.available_slots}/${riskData.coverage.expected_slots} slots`}
                {' · '}{Date.now() - Date.parse(riskData?.cutoff_utc || riskData?.date) > 36 * 3600000 ? 'Stale / 更新期限超過' : '固定版 / Fixed snapshot'}
                {' · '}<a href="./country-interest/">各国の検索関心 / Search interest</a>
                <span className="source-edition-binding" data-source-edition={riskData?.upstream_sync?.execbrief_release||'legacy-05-v1'}>{riskData?.upstream_sync ? `ExecBrief ${riskData.upstream_sync.date} · ${riskData.upstream_sync.execbrief_edition} · ${riskData.upstream_sync.execbrief_release}` : riskData?.cutoff_utc?.endsWith('20:00:00Z') ? '旧05:00 JST固定版 / Original05:00 JST snapshot' : 'Legacy / ExecBrief edition not bound'}</span>
                <span>{t.global.scopeNote}</span>
                {riskData?.countries && Object.values(riskData.countries).some(country=>country.evaluation) && <span>{t.global.primaryColorNote}</span>}
            </div>
            <div className="app-main">
                <div className="map-container">
                    <MapView
                        riskData={enrichedRiskData}
                        onCountrySelect={handleCountrySelect}
                        onCountryHover={handleCountryHover}
                        onCountryLeave={handleCountryLeave}
                        selectedCountry={selectedCountry}
                        hoveredCountry={hoveredCountry}
                        selectedSignal={selectedSignal}
                        onSignalSelect={handleSignalSelect}
                        onSignalHover={setHoveredSignal}
                        displayMode={viewMode === 'surge' ? 'bento' : viewMode}
                        viewMode={viewMode}
                        theme={theme}
                    />
                    <div className="legend" data-title={t.legend.title}>
                        <div className="legend-item"><span className="legend-color legend-color--red"></span><span>{t.legend.critical}</span></div>
                        <div className="legend-item"><span className="legend-color legend-color--orange"></span><span>{t.legend.warning}</span></div>
                        <div className="legend-item"><span className="legend-color legend-color--yellow"></span><span>{t.legend.watch}</span></div>
                        <div className="legend-item"><span className="legend-color legend-color--green"></span><span>{greenLabel(viewMode,t)}</span></div>
                        <div className="legend-item"><span className="legend-color legend-color--unknown"></span><span>{t.legend.unknown}</span></div>
                    </div>
                </div>

                <aside className="sidebar" style={{ flexShrink: 0 }}>
                    <GlobalPanel
                        riskData={enrichedRiskData}
                        onCountrySelect={(c) => { setPopupSide('left'); setSelectedCountry(c); }}
                        selectedCountry={selectedCountry}
                        onSignalSelect={handleSignalSelect}
                        selectedSignal={selectedSignal}
                        hoveredSignal={hoveredSignal}
                        hoveredCountry={hoveredCountry}
                        t={t}
                        lang={lang}
                        viewMode={viewMode}
                        onViewModeChange={setViewMode}
                    />
                </aside>
            </div>

            {selectedData && (
                <CountryModal
                    country={selectedData}
                    onClose={handleCloseModal}
                    t={t}
                    lang={lang}
                    isPinned={!!selectedCountry}
                    hasHistory={!!historyIndex[selectedData.iso2]}
                    side={popupSide}
                    viewMode={viewMode}
                    theme={theme}
                    editionDate={riskData?.upstream_sync?.date || riskData?.date}
                    signals={{pm: (enrichedRiskData?.polymarket || []).filter(s => s.iso2 === selectedData.iso2)}}
                />
            )}
        </div>
    );
}

// MAIN ENTRY POINT
function App() {
    const [lang, setLang] = useState(() => {
        const saved = localStorage.getItem('rw_lang');
        if (saved) return saved;
        if (typeof navigator !== 'undefined') {
            const browserLang = navigator.language || navigator.userLanguage || 'en';
            if (browserLang.startsWith('ja')) return 'ja';
            if (browserLang.startsWith('es')) return 'es';
        }
        return 'en';
    });

    const [theme, setTheme] = useState(() => localStorage.getItem('rw_theme') || 'dark');

    useEffect(() => {
        localStorage.setItem('rw_theme', theme);
        if (theme === 'light') {
            document.body.classList.add('light-mode');
        } else {
            document.body.classList.remove('light-mode');
        }
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
    };

    useEffect(() => {
        localStorage.setItem('rw_lang', lang);
    }, [lang]);

    const t = translations[lang];

    return (
        <HashRouter>
            <Routes>
                <Route path="/" element={<Dashboard lang={lang} setLang={setLang} t={t} theme={theme} toggleTheme={toggleTheme} />} />
                <Route path="/country/:iso2" element={<CountryDetailView lang={lang} t={t} theme={theme} />} />
            </Routes>
        </HashRouter>
    );
}

export default App;
