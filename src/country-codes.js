export function geoCountryCode(properties) {
    const code = properties?.['ISO3166-1-Alpha-2'];
    if (code === 'CN-TW') return 'TW';
    if (/^[A-Z]{2}$/.test(code || '')) return code;
    if (properties?.name === 'Kosovo' || properties?.ADMIN === 'Kosovo') return 'XK';
    if (properties?.name === 'Somaliland') return 'SO';
    return null;
}

export function countryName(code, lang = 'en', fallback = code) {
    if (!/^[A-Z]{2}$/.test(code || '')) return fallback;
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || fallback;
}
