import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import MapView from './components/MapView';
import GlobalPanel from './components/GlobalPanel';
import CountryModal from './components/CountryModal';
import Header from './components/Header';
import CountryDetailView from './components/CountryDetailView';
import { translations, languages } from './i18n';
import './App.css';

// Reusable Dashboard Component (The original content of App)
function Dashboard({ lang, setLang, t }) {
    const [riskData, setRiskData] = useState(null);
    const [selectedCountry, setSelectedCountry] = useState(null);
    const [hoveredCountry, setHoveredCountry] = useState(null);
    const [selectedSignal, setSelectedSignal] = useState(null);
    const [hoveredSignal, setHoveredSignal] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [popupSide, setPopupSide] = useState('left');
    const [availableDates, setAvailableDates] = useState([]);
    const [viewMode, setViewMode] = useState(() => localStorage.getItem('rw_view_mode') || 'surge_r');
    const [historyIndex, setHistoryIndex] = useState({});
    const [regressionReport, setRegressionReport] = useState(null);

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
        fetch(`./data/available_dates.json?t=${new Date().getTime()}`)
            .then(res => res.json())
            .then(dates => {
                setAvailableDates(dates);
                if (dates.length > 0) fetchData(dates[0]);
                else fetchData('latest_v4');
            })
            .catch(() => fetchData('latest_v4'));

        // Load history index once for visibility checks (Tier B country series)
        fetch('./data/weekly/countries/index.json')
            .then(res => res.json())
            .then(idx => {
                console.log("Loaded Weekly History Index:", idx);
                setHistoryIndex(idx?.countries || {});
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
        const fileName = dateKey.includes('-') ? `${dateKey}.json` : `${dateKey}.json`;
        fetch(`./data/${fileName}`)
            .then(res => {
                if (!res.ok) throw new Error("Data load failed");
                return res.json();
            })
            .then(data => {
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

    const getAlertCounts = () => {
        if (!enrichedRiskData?.countries) return { red: 0, orange: 0, yellow: 0 };
        const countries = Object.values(enrichedRiskData.countries);

        if (viewMode === 'surge') {
            return {
                red: countries.filter(c => c.surge?.rank >= 1 && c.surge?.rank <= 10).length,
                orange: countries.filter(c => c.surge?.rank >= 11 && c.surge?.rank <= 20).length,
                yellow: countries.filter(c => c.surge?.rank >= 21 && c.surge?.rank <= 40).length
            };
        }

        if (viewMode === 'surge_r') {
            return {
                red: countries.filter(c => c.surge_r?.level?.toLowerCase() === 'red').length,
                orange: countries.filter(c => c.surge_r?.level?.toLowerCase() === 'orange').length,
                yellow: countries.filter(c => c.surge_r?.level?.toLowerCase() === 'yellow').length
            };
        }

        if (viewMode === 'index') {
            return {
                red: countries.filter(c => c.index?.level?.toLowerCase() === 'red').length,
                orange: countries.filter(c => c.index?.level?.toLowerCase() === 'orange').length,
                yellow: countries.filter(c => c.index?.level?.toLowerCase() === 'yellow').length
            };
        }

        return {
            red: countries.filter(c => c.alert_level === 'red').length,
            orange: countries.filter(c => c.alert_level === 'orange').length,
            yellow: countries.filter(c => c.alert_level === 'yellow').length
        };
    };

    const alertCounts = getAlertCounts();

    /* Logic for Modal Data selection */
    const selectedData = useMemo(() => {
        const targetIso = selectedCountry || hoveredCountry;
        if (!targetIso || !enrichedRiskData?.countries) return null;
        const countryData = enrichedRiskData.countries[targetIso];
        if (!countryData) return null;
        return { iso2: targetIso, ...countryData };
    }, [selectedCountry, hoveredCountry, enrichedRiskData]);

    if (loading) return <div className="app app--loading"><div className="loading-spinner">{t.loading}</div></div>;
    if (error) return <div className="app app--error"><div className="error-message">{t.error}: {error}</div></div>;

    return (
        <div className="app">
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
            />

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
                    />
                    <div className="legend">
                        <div className="legend-item"><span className="legend-color legend-color--red"></span><span>Critical</span></div>
                        <div className="legend-item"><span className="legend-color legend-color--orange"></span><span>Warning</span></div>
                        <div className="legend-item"><span className="legend-color legend-color--yellow"></span><span>Watch</span></div>
                        <div className="legend-item"><span className="legend-color legend-color--green"></span><span>Stable</span></div>
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
                    signals={{
                        gt: enrichedRiskData?.air?.countries?.[selectedData.iso2]?.top20_terms || [],
                        pm: (enrichedRiskData?.polymarket || []).filter(s => s.iso2 === selectedData.iso2),
                        xt: enrichedRiskData?.air?.countries?.[selectedData.iso2] || null
                    }}
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

    useEffect(() => {
        localStorage.setItem('rw_lang', lang);
    }, [lang]);

    const t = translations[lang];

    return (
        <HashRouter>
            <Routes>
                <Route path="/" element={<Dashboard lang={lang} setLang={setLang} t={t} />} />
                <Route path="/country/:iso2" element={<CountryDetailView lang={lang} t={t} />} />
            </Routes>
        </HashRouter>
    );
}

export default App;
