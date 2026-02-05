import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Popup, Tooltip, Pane, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const SIGNAL_TYPE_CONFIG = {
    gt: { color: '#2dd4bf', selectedColor: '#5eead4', prefix: 'GT', title: 'GOOGLE TRENDS' },
    pm: { color: '#4ade80', selectedColor: '#86efac', prefix: 'PM', title: 'POLYMARKET' },
    xt: { color: '#ff7ee2', selectedColor: '#ff9ee9', prefix: 'SNS', title: 'POLITICAL SURGE' }
};

const ALERT_COLORS = {
    red: '#ee2c2c',
    orange: '#f57c00',
    yellow: '#dca01d',
    green: '#000000'
};

const ALERT_COLORS_LIGHT = {
    red: '#ee2c2c',
    orange: '#f57c00',
    yellow: '#fbc02d', // Slightly darker yellow for readability on white
    green: '#e5e7eb'   // Light Grey (Gray-200) for stable countries in light mode
};

// Component to handle map movement
function MapController({ selectedIso, centroids, selectedSignal }) {
    const map = useMap();

    useEffect(() => {
        let targetCenter = null;
        let targetZoom = Math.max(map.getZoom(), 4);

        if (selectedSignal) {
            if (selectedSignal.position) {
                targetCenter = selectedSignal.position;
                // Preserve zoom, but ensure at least 4 for visibility
                targetZoom = Math.max(map.getZoom(), 4);
            } else if (selectedSignal.geo && centroids && centroids[selectedSignal.geo]) {
                targetCenter = centroids[selectedSignal.geo];
                targetZoom = Math.max(map.getZoom(), 4);
            }
        } else if (selectedIso && centroids && centroids[selectedIso]) {
            targetCenter = centroids[selectedIso];
            // Pure centering, do not force zoom in unless very far out (e.g. 2)
            // User requested: "Click to center"
            targetZoom = Math.max(map.getZoom(), 3);
        }

        if (targetCenter) {
            map.flyTo(targetCenter, targetZoom, { duration: 1.2 });
        }
    }, [selectedIso, centroids, selectedSignal, map]);

    return null;
}

// Helper: Calculate approximate area of a polygon (Shoelace formula)
const getApproxArea = (geometry) => {
    if (!geometry) return 0;

    const calculateRingArea = (coords) => {
        let area = 0;
        const n = coords.length;
        for (let i = 0; i < n; i++) {
            const [x1, y1] = coords[i];
            const [x2, y2] = coords[(i + 1) % n];
            area += (x1 * y2) - (x2 * y1);
        }
        return Math.abs(area) / 2;
    };

    if (geometry.type === 'Polygon') {
        return calculateRingArea(geometry.coordinates[0]);
    } else if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.reduce((sum, poly) => sum + calculateRingArea(poly[0]), 0);
    }
    return 0;
};

// Helper: Calculate centroid of a GeoJSON Polygon or MultiPolygon
// Helper: Calculate centroid of a GeoJSON Polygon or MultiPolygon
const getCentroid = (geometry) => {
    if (!geometry) return null;

    const calculatePolygonCentroid = (coords) => {
        let latSum = 0;
        let lngSum = 0;
        let count = 0;
        // coords[0] is the outer ring
        coords[0].forEach(p => {
            lngSum += p[0];
            latSum += p[1];
            count++;
        });
        return [latSum / count, lngSum / count];
    };

    if (geometry.type === 'Polygon') {
        return calculatePolygonCentroid(geometry.coordinates);
    } else if (geometry.type === 'MultiPolygon') {
        // Find the largest polygon within the MultiPolygon
        let maxArea = 0;
        let bestCentroid = null;

        geometry.coordinates.forEach(poly => {
            // Calculate area of this polygon (ring 0)
            let area = 0;
            const ring = poly[0];
            const n = ring.length;
            for (let i = 0; i < n; i++) {
                const [x1, y1] = ring[i];
                const [x2, y2] = ring[(i + 1) % n];
                area += (x1 * y2) - (x2 * y1);
            }
            area = Math.abs(area) / 2;

            if (area > maxArea) {
                maxArea = area;
                bestCentroid = calculatePolygonCentroid(poly);
            }
        });
        return bestCentroid;
    }
    return null;
};

export default function MapView({ riskData, onCountrySelect, onCountryHover, onCountryLeave, selectedCountry, selectedSignal, onSignalSelect, onSignalHover, viewMode, theme }) {
    const [geoData, setGeoData] = useState(null);
    const [expandedCluster, setExpandedCluster] = useState(null); // 'US-gt' format
    const collapseTimeoutRef = useRef(null);

    const handleClusterExpand = useCallback((clusterKey) => {
        if (collapseTimeoutRef.current) clearTimeout(collapseTimeoutRef.current);
        setExpandedCluster(clusterKey);
    }, []);

    const handleClusterCollapse = useCallback(() => {
        collapseTimeoutRef.current = setTimeout(() => {
            setExpandedCluster(null);
        }, 300); // Small delay to allow moving between markers
    }, []);

    useEffect(() => {
        fetch('./geo/countries.geojson')
            .then(res => res.json())
            .then(data => setGeoData(data))
            .catch(err => console.error('Failed to load GeoJSON:', err));
    }, []);

    // Memoize country centroids to avoid recalculating on every render
    const countryCentroids = useMemo(() => {
        if (!geoData) return {};
        const centroids = {};
        // Keep track of the maximum area found so far for each ISO
        const maxAreas = {};

        geoData.features.forEach(feature => {
            const iso2 = feature.properties['ISO3166-1-Alpha-2'];
            if (iso2) {
                const area = getApproxArea(feature.geometry);

                // If this is the first time we see this ISO, or if this feature is larger than the previous one
                if (!maxAreas[iso2] || area > maxAreas[iso2]) {
                    const center = getCentroid(feature.geometry);
                    if (center) {
                        centroids[iso2] = center;
                        maxAreas[iso2] = area;
                    }
                }
            }
        });
        return centroids;
    }, [geoData]);

    const signals = useMemo(() => {
        if (!countryCentroids || !riskData) return [];
        const allSignals = [];
        const isoCounts = {};

        // Process GT
        (riskData.google_trends || riskData.air?.google_trends?.gt_top10 || []).forEach((item, idx) => {
            const iso = item.iso2 || item.geo;
            if (!iso || !countryCentroids[iso]) return;
            const count = isoCounts[iso] || 0;
            isoCounts[iso] = count + 1;

            allSignals.push({
                type: 'gt',
                id: `gt-${idx}`,
                label: item.id || `GT${(idx + 1).toString().padStart(2, '0')}`,
                data: item,
                index: idx,
                position: countryCentroids[iso],
                offsetIndex: count,
                // Check if political (default to true if undefined, but explicit false means gray)
                isPolitical: item.is_political !== false,
                color: item.is_political === false ? '#9ca3af' : '#2dd4bf', // Gray 400 vs Teal 400 (Label Match)
                selectedColor: item.is_political === false ? '#d1d5db' : '#5eead4', // Gray 300 vs Teal 300
                popupTitle: 'GOOGLE TRENDS',
                popupValue: item.term || item.title
            });
        });

        // Process PM
        (riskData.polymarket || []).forEach((item, idx) => {
            const iso = item.iso2 || item.geo || item.country;
            if (!iso || !countryCentroids[iso]) return;
            const count = isoCounts[iso] || 0;
            isoCounts[iso] = count + 1;

            allSignals.push({
                type: 'pm',
                id: `pm-${idx}`,
                label: `PM${(idx + 1).toString().padStart(2, '0')}`,
                data: item,
                index: idx,
                position: countryCentroids[iso],
                offsetIndex: count,
                color: '#4ade80', // Green 400 (Label Match)
                selectedColor: '#86efac',
                popupTitle: 'POLYMARKET',
                popupValue: item.volume_text
            });
        });

        // Process SNS (GetDayTrends Political Surge)
        (riskData.air?.sns_top10 || []).forEach((item, idx) => {
            if (!item.iso2 || !countryCentroids[item.iso2]) return;
            const count = isoCounts[item.iso2] || 0;
            isoCounts[item.iso2] = count + 1;

            allSignals.push({
                type: 'xt',
                id: `sns-${idx}`,
                label: item.id || `SNS${(idx + 1).toString().padStart(2, '0')}`,
                data: { ...item, title: item.political_terms?.[0] || 'Top Term Unknown' },
                index: idx,
                position: countryCentroids[item.iso2],
                offsetIndex: count,
                color: '#ec4899', // Pink 500 (High Saturation Label Match)
                selectedColor: '#f472b6',
                popupTitle: 'POLITICAL SURGE',
                popupValue: `PS: ${item.ps_today?.toFixed(1) || '0.0'} (Surge: ${item.surge > 0 ? '+' : ''}${item.surge || 0})`
            });
        });

        return allSignals;
    }, [riskData, countryCentroids]);

    // Group signals by country-type for clustering
    const clusteredSignals = useMemo(() => {
        const groups = {}; // { 'US-gt': [...signals], 'US-pm': [...] }
        signals.forEach(sig => {
            const iso = sig.data.iso2 || sig.data.geo || sig.data.country;
            if (!iso) return;
            const key = `${iso}-${sig.type}`;
            if (!groups[key]) groups[key] = { iso, type: sig.type, signals: [], position: sig.position };
            groups[key].signals.push(sig);
        });
        return Object.values(groups);
    }, [signals]);

    const getCountryStyle = (feature) => {
        const iso2 = feature.properties['ISO3166-1-Alpha-2'];
        const countryRisk = riskData?.countries?.[iso2];
        const isSelected = selectedCountry === iso2;

        const colors = theme === 'light' ? ALERT_COLORS_LIGHT : ALERT_COLORS;

        let color = colors.green;
        if (viewMode === 'surge') {
            const rank = countryRisk?.surge?.rank;
            if (rank) {
                if (rank <= 10) color = colors.red;
                else if (rank <= 20) color = colors.orange;
                else if (rank <= 40) color = colors.yellow;
                else color = theme === 'light' ? '#e0e0e0' : '#3d4654'; // Grey for 41+
            }
        } else if (viewMode === 'surge_r') {
            const surgeRLevel = countryRisk?.surge_r?.level?.toLowerCase() || 'green';
            color = colors[surgeRLevel] || colors.green;
        } else if (viewMode === 'index') {
            const indexLevel = countryRisk?.index?.level?.toLowerCase() || 'green';
            color = colors[indexLevel] || colors.green;
        } else {
            const alertLevel = countryRisk?.alert_level || 'green';
            color = colors[alertLevel];
        }

        return {
            fillColor: isSelected ? '#06b6d4' : color, // Cyan-500 for selection
            weight: isSelected ? 1.5 : 0.5,
            opacity: 1,
            color: isSelected ? '#ffffff' : (theme === 'light' ? '#94a3b8' : '#555555'), // Lighter border in light mode
            fillOpacity: isSelected ? 1.0 : 0.9,
            className: '' // Avoid class-based issues
        };
    };


    const geoJsonRef = useRef(null);

    // Update styles when selection changes without remounting layer
    useEffect(() => {
        if (geoJsonRef.current) {
            geoJsonRef.current.setStyle(getCountryStyle);
        }
    }, [selectedCountry, riskData, viewMode, theme]);

    const onEachCountry = (feature, layer) => {
        const iso2 = feature.properties['ISO3166-1-Alpha-2'];
        const countryName = feature.properties.name;

        // Calculate side based on longitude (Americas vs Rest)
        const center = getCentroid(feature.geometry);
        const side = (center && center[1] < -30) ? 'right' : 'left';

        layer.bindTooltip(countryName, { sticky: true });

        layer.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            onCountrySelect(iso2, { side });
        });

        layer.on('mouseover', (e) => {
            // Basic hover effect
            const layer = e.target;
            layer.setStyle({
                weight: 2,
                color: '#00d4ff',
                fillOpacity: 1
            });
            layer.bringToFront();
            if (onCountryHover) onCountryHover(iso2, { side });
        });

        layer.on('mouseout', (e) => {
            const layer = e.target;
            // Reset style to default
            layer.setStyle({
                weight: 0.5,
                color: '#1a1a2e',
                fillOpacity: 0.9
            });

            if (onCountryLeave) onCountryLeave();
        });
    };

    const googleTrends = riskData?.google_trends || [];
    const polymarket = riskData?.polymarket || [];

    if (!geoData) {
        return <div className="map-loading">Loading map...</div>;
    }

    return (
        <MapContainer
            center={[20, 0]}
            zoom={2}
            style={{ height: '100%', width: '100%' }}
            minZoom={2}
            maxBounds={[[-90, -180], [90, 180]]}
        >
            <MapController selectedIso={selectedCountry} centroids={countryCentroids} selectedSignal={selectedSignal} />
            {/* Remove TileLayer for Black/Dark theme 
            <TileLayer
                attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
            */}
            <GeoJSON
                ref={geoJsonRef}
                key={`${riskData?.date}-${selectedCountry}`} // Nuclear Option: Remount to rebinding handlers
                data={geoData}
                style={getCountryStyle}
                onEachFeature={onEachCountry}
            />

            {/* Signal Clusters (Hover to Expand) */}
            <Pane name="signals" style={{ zIndex: 600 }}>
                {clusteredSignals.map(cluster => {
                    const clusterKey = `${cluster.iso}-${cluster.type}`;
                    const isExpanded = expandedCluster === clusterKey;
                    const config = SIGNAL_TYPE_CONFIG[cluster.type] || SIGNAL_TYPE_CONFIG.gt;
                    const count = cluster.signals.length;

                    // Determine if cluster is "Gray" (if it's GT and ALL signals are non-political)
                    const isGrayCluster = cluster.type === 'gt' && cluster.signals.every(s => s.isPolitical === false);
                    const clusterColor = isGrayCluster ? '#9ca3af' : config.color;
                    const clusterFill = isGrayCluster ? '#9ca3af' : config.color;

                    const typeOffset = cluster.type === 'gt' ? -1 : (cluster.type === 'pm' ? 0 : 1);
                    // Diagonal offset: GT (Top-Left), PM (Center), SNS (Bottom-Right)
                    // Latitude increases North (Top), Longitude increases East (Right)
                    const latOffset = typeOffset * 2.5; // + for North (GT has -1 typeOffset, so we need - to flip or verify sign)
                    // Wait, typeOffset: GT=-1, PM=0, SNS=1.
                    // We want GT Top-Left -> Lat (North/+), Long (West/-).
                    // So Lat should be -typeOffset * X. Long should be typeOffset * Y.

                    const basePos = [
                        cluster.position[0] - typeOffset * 2.0, // Lat: -(-1)=+1 (North) for GT, -1 (South) for SNS
                        cluster.position[1] + typeOffset * 3.0  // Lng: -3 (West) for GT, +3 (East) for SNS
                    ];
                    // Dynamic tooltip direction: GT (left-ish) -> left, PM (center) -> bottom, SNS (right-ish) -> auto/top
                    const tooltipDir = cluster.type === 'gt' ? 'left' : (cluster.type === 'pm' ? 'bottom' : 'right');
                    const tooltipOffset = cluster.type === 'gt' ? [-5, 0] : (cluster.type === 'pm' ? [0, 5] : [5, 0]);

                    if (!isExpanded) {
                        // Collapsed: Show summary marker (e.g., "GT05")
                        return (
                            <CircleMarker
                                key={clusterKey}
                                center={basePos}
                                radius={5}
                                pathOptions={{
                                    color: clusterColor,
                                    fillColor: clusterFill,
                                    fillOpacity: 0.9,
                                    weight: 1
                                }}
                                eventHandlers={{
                                    mouseover: () => handleClusterExpand(clusterKey),
                                    mouseout: handleClusterCollapse,
                                    click: (e) => {
                                        e.originalEvent.stopPropagation();
                                        handleClusterExpand(clusterKey); // Expand on click too
                                        if (cluster.iso && onCountrySelect) {
                                            onCountrySelect(cluster.iso, { side: cluster.position[1] < -30 ? 'right' : 'left' });
                                        }
                                    }
                                }}
                            >
                                <Tooltip
                                    permanent
                                    direction={tooltipDir}
                                    className={`signal-label-tooltip signal-label-${cluster.type}${isGrayCluster ? '-gray' : ''}`}
                                    offset={tooltipOffset}
                                >
                                    {count === 1 ? cluster.signals[0].label : `${config.prefix}${count.toString().padStart(2, '0')}`}
                                </Tooltip>
                            </CircleMarker>
                        );
                    }

                    // Expanded: Show all individual signals
                    return (
                        <React.Fragment key={clusterKey}>
                            {cluster.signals.map((sig, i) => {
                                const offset = i * 2.5;
                                const pos = [basePos[0] - offset, basePos[1]];
                                const isSelected = selectedSignal?.type === sig.type && selectedSignal?.index === sig.index;

                                return (
                                    <CircleMarker
                                        key={sig.id}
                                        center={pos}
                                        radius={isSelected ? 6 : 4}
                                        pathOptions={{
                                            color: isSelected ? '#fff' : sig.color, // Use signal color (red/teal/gray)
                                            fillColor: isSelected ? sig.selectedColor : sig.color,
                                            fillOpacity: 0.9,
                                            weight: isSelected ? 2 : 1
                                        }}
                                        eventHandlers={{
                                            mouseover: (e) => {
                                                handleClusterExpand(clusterKey);
                                                e.target.openPopup();
                                                onSignalHover && onSignalHover({ type: sig.type, index: sig.index });
                                            },
                                            mouseout: (e) => {
                                                handleClusterCollapse(); // Re-use the delayed collapse
                                                e.target.closePopup();
                                                onSignalHover && onSignalHover(null);
                                            },
                                            click: (e) => {
                                                e.originalEvent.stopPropagation();
                                                const iso2 = sig.data.iso2 || sig.data.geo;
                                                const side = (sig.position && sig.position[1] < -30) ? 'right' : 'left';
                                                if (iso2 && onCountrySelect) {
                                                    onCountrySelect(iso2, { side });
                                                }
                                                onSignalSelect && onSignalSelect({ type: sig.type, index: sig.index, ...sig.data });
                                            }
                                        }}
                                    >
                                        <Tooltip
                                            permanent
                                            direction="right"
                                            className={`signal-label-tooltip signal-label-${sig.type}${sig.isPolitical === false ? '-gray' : ''}`}
                                            offset={[5, 0]}
                                        >
                                            {sig.label}
                                        </Tooltip>
                                        <Popup className="tactical-popup">
                                            <div className="popup-label">{sig.popupTitle}</div>
                                            <div className="popup-content">{sig.data.title || sig.data.query}</div>
                                            <div className="popup-value">{sig.popupValue}</div>
                                        </Popup>
                                    </CircleMarker>
                                );
                            })}
                        </React.Fragment>
                    );
                })}
            </Pane>
        </MapContainer>
    );
}
