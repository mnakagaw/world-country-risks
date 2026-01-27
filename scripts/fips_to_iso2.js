/**
 * FIPS to ISO2 Country Code Conversion
 * 
 * GDELT uses FIPS 10-4 codes, while our UI/GeoJSON uses ISO 3166-1 Alpha-2.
 * This module provides a single source of truth for code conversion.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// FIPS 10-4 to ISO 3166-1 Alpha-2 mapping
// Sources: https://en.wikipedia.org/wiki/FIPS_10-4
export const FIPS_TO_ISO2 = {
    // Standard mappings where FIPS differs from ISO2
    'AF': 'AF', // Afghanistan
    'AL': 'AL', // Albania
    'AG': 'DZ', // Algeria (FIPS: AG, ISO: DZ)
    'AQ': 'AS', // American Samoa (FIPS: AQ, ISO: AS)
    'AN': 'AD', // Andorra (FIPS: AN, ISO: AD)
    'AO': 'AO', // Angola
    'AV': 'AI', // Anguilla (FIPS: AV, ISO: AI)
    'AY': 'AQ', // Antarctica (FIPS: AY, ISO: AQ)
    'AC': 'AG', // Antigua and Barbuda (FIPS: AC, ISO: AG)
    'AR': 'AR', // Argentina
    'AM': 'AM', // Armenia
    'AA': 'AW', // Aruba (FIPS: AA, ISO: AW)
    'AS': 'AU', // Australia (FIPS: AS, ISO: AU) ★
    'AU': 'AT', // Austria (FIPS: AU, ISO: AT) ★
    'AJ': 'AZ', // Azerbaijan (FIPS: AJ, ISO: AZ)
    'BF': 'BS', // Bahamas (FIPS: BF, ISO: BS)
    'BA': 'BH', // Bahrain (FIPS: BA, ISO: BH)
    'BG': 'BD', // Bangladesh (FIPS: BG, ISO: BD) ★
    'BB': 'BB', // Barbados
    'BO': 'BY', // Belarus (FIPS: BO, ISO: BY) ★
    'BE': 'BE', // Belgium
    'BH': 'BZ', // Belize (FIPS: BH, ISO: BZ)
    'BN': 'BJ', // Benin (FIPS: BN, ISO: BJ) ★ (NOT Brunei!)
    'BD': 'BM', // Bermuda (FIPS: BD, ISO: BM)
    'BT': 'BT', // Bhutan
    'BL': 'BO', // Bolivia (FIPS: BL, ISO: BO)
    'BK': 'BA', // Bosnia (FIPS: BK, ISO: BA)
    'BC': 'BW', // Botswana (FIPS: BC, ISO: BW)
    'BR': 'BR', // Brazil
    'BX': 'BN', // Brunei (FIPS: BX, ISO: BN) ★
    'BU': 'BG', // Bulgaria (FIPS: BU, ISO: BG) ★
    'UV': 'BF', // Burkina Faso (FIPS: UV, ISO: BF)
    'BM': 'MM', // Myanmar/Burma (FIPS: BM, ISO: MM) ★
    'BY': 'BI', // Burundi (FIPS: BY, ISO: BI)
    'CB': 'KH', // Cambodia (FIPS: CB, ISO: KH) ★
    'CM': 'CM', // Cameroon
    'CA': 'CA', // Canada
    'CV': 'CV', // Cape Verde
    'CJ': 'KY', // Cayman Islands (FIPS: CJ, ISO: KY)
    'CT': 'CF', // Central African Rep (FIPS: CT, ISO: CF)
    'CD': 'TD', // Chad (FIPS: CD, ISO: TD) ★
    'CI': 'CL', // Chile (FIPS: CI, ISO: CL)
    'CH': 'CN', // China (FIPS: CH, ISO: CN) ★
    'CO': 'CO', // Colombia
    'CN': 'KM', // Comoros (FIPS: CN, ISO: KM)
    'CF': 'CG', // Congo (FIPS: CF, ISO: CG)
    'CG': 'CD', // DRC (FIPS: CG, ISO: CD) ★
    'CW': 'CK', // Cook Islands (FIPS: CW, ISO: CK)
    'CS': 'CR', // Costa Rica (FIPS: CS, ISO: CR)
    'IV': 'CI', // Côte d'Ivoire (FIPS: IV, ISO: CI)
    'HR': 'HR', // Croatia
    'CU': 'CU', // Cuba
    'CY': 'CY', // Cyprus
    'EZ': 'CZ', // Czech Republic (FIPS: EZ, ISO: CZ) ★
    'DA': 'DK', // Denmark (FIPS: DA, ISO: DK) ★
    'DJ': 'DJ', // Djibouti
    'DO': 'DM', // Dominica (FIPS: DO, ISO: DM)
    'DR': 'DO', // Dominican Republic (FIPS: DR, ISO: DO) ★
    'EC': 'EC', // Ecuador
    'EG': 'EG', // Egypt
    'ES': 'SV', // El Salvador (FIPS: ES, ISO: SV) ★
    'EK': 'GQ', // Equatorial Guinea (FIPS: EK, ISO: GQ)
    'ER': 'ER', // Eritrea
    'EN': 'EE', // Estonia (FIPS: EN, ISO: EE)
    'ET': 'ET', // Ethiopia
    'FK': 'FK', // Falkland Islands
    'FO': 'FO', // Faroe Islands
    'FJ': 'FJ', // Fiji
    'FI': 'FI', // Finland
    'FR': 'FR', // France
    'FP': 'PF', // French Polynesia (FIPS: FP, ISO: PF)
    'GB': 'GA', // Gabon (FIPS: GB, ISO: GA) ★
    'GA': 'GM', // Gambia (FIPS: GA, ISO: GM) ★
    'GZ': 'PS', // Gaza Strip → Palestine (FIPS: GZ, ISO: PS) ★
    'GG': 'GE', // Georgia (FIPS: GG, ISO: GE) ★
    'GM': 'DE', // Germany (FIPS: GM, ISO: DE) ★
    'GH': 'GH', // Ghana
    'GI': 'GI', // Gibraltar
    'GR': 'GR', // Greece
    'GL': 'GL', // Greenland
    'GJ': 'GD', // Grenada (FIPS: GJ, ISO: GD) ★
    'GQ': 'GU', // Guam (FIPS: GQ, ISO: GU)
    'GT': 'GT', // Guatemala
    'GV': 'GN', // Guinea (FIPS: GV, ISO: GN)
    'PU': 'GW', // Guinea-Bissau (FIPS: PU, ISO: GW)
    'GY': 'GY', // Guyana
    'HA': 'HT', // Haiti (FIPS: HA, ISO: HT) ★
    'HO': 'HN', // Honduras (FIPS: HO, ISO: HN) ★
    'HK': 'HK', // Hong Kong
    'HU': 'HU', // Hungary
    'IC': 'IS', // Iceland (FIPS: IC, ISO: IS)
    'IN': 'IN', // India
    'ID': 'ID', // Indonesia
    'IR': 'IR', // Iran
    'IZ': 'IQ', // Iraq (FIPS: IZ, ISO: IQ) ★
    'EI': 'IE', // Ireland (FIPS: EI, ISO: IE)
    'IS': 'IL', // Israel (FIPS: IS, ISO: IL) ★
    'IT': 'IT', // Italy
    'JM': 'JM', // Jamaica
    'JA': 'JP', // Japan (FIPS: JA, ISO: JP) ★
    'JO': 'JO', // Jordan
    'KZ': 'KZ', // Kazakhstan
    'KE': 'KE', // Kenya
    'KR': 'KI', // Kiribati (FIPS: KR, ISO: KI)
    'KN': 'KP', // North Korea (FIPS: KN, ISO: KP) ★
    'KS': 'KR', // South Korea (FIPS: KS, ISO: KR) ★
    'KV': 'XK', // Kosovo (FIPS: KV, ISO: XK - user assigned)
    'KU': 'KW', // Kuwait (FIPS: KU, ISO: KW)
    'KG': 'KG', // Kyrgyzstan
    'LA': 'LA', // Laos
    'LG': 'LV', // Latvia (FIPS: LG, ISO: LV) ★
    'LE': 'LB', // Lebanon (FIPS: LE, ISO: LB) ★
    'LT': 'LS', // Lesotho (FIPS: LT, ISO: LS)
    'LI': 'LR', // Liberia (FIPS: LI, ISO: LR)
    'LY': 'LY', // Libya
    'LS': 'LI', // Liechtenstein (FIPS: LS, ISO: LI)
    'LH': 'LT', // Lithuania (FIPS: LH, ISO: LT) ★
    'LU': 'LU', // Luxembourg
    'MC': 'MO', // Macau (FIPS: MC, ISO: MO)
    'MK': 'MK', // North Macedonia
    'MA': 'MG', // Madagascar (FIPS: MA, ISO: MG)
    'MI': 'MW', // Malawi (FIPS: MI, ISO: MW) ★
    'MY': 'MY', // Malaysia
    'MV': 'MV', // Maldives
    'ML': 'ML', // Mali
    'MT': 'MT', // Malta
    'RM': 'MH', // Marshall Islands (FIPS: RM, ISO: MH)
    'MR': 'MR', // Mauritania
    'MP': 'MU', // Mauritius (FIPS: MP, ISO: MU)
    'MX': 'MX', // Mexico
    'FM': 'FM', // Micronesia
    'MD': 'MD', // Moldova
    'MN': 'MC', // Monaco (FIPS: MN, ISO: MC)
    'MG': 'MN', // Mongolia (FIPS: MG, ISO: MN) ★
    'MJ': 'ME', // Montenegro (FIPS: MJ, ISO: ME)
    'MO': 'MA', // Morocco (FIPS: MO, ISO: MA) ★
    'MZ': 'MZ', // Mozambique
    'WA': 'NA', // Namibia (FIPS: WA, ISO: NA) ★
    'NR': 'NR', // Nauru
    'NP': 'NP', // Nepal
    'NL': 'NL', // Netherlands
    'NC': 'NC', // New Caledonia
    'NZ': 'NZ', // New Zealand
    'NU': 'NI', // Nicaragua (FIPS: NU, ISO: NI) ★
    'NG': 'NE', // Niger (FIPS: NG, ISO: NE) ★
    'NI': 'NG', // Nigeria (FIPS: NI, ISO: NG) ★
    'NO': 'NO', // Norway
    'MU': 'OM', // Oman (FIPS: MU, ISO: OM)
    'PK': 'PK', // Pakistan
    'PS': 'PW', // Palau (FIPS: PS, ISO: PW)
    'PM': 'PA', // Panama (FIPS: PM, ISO: PA)
    'PP': 'PG', // Papua New Guinea (FIPS: PP, ISO: PG)
    'PA': 'PY', // Paraguay (FIPS: PA, ISO: PY) ★
    'PE': 'PE', // Peru
    'RP': 'PH', // Philippines (FIPS: RP, ISO: PH) ★
    'PL': 'PL', // Poland
    'PO': 'PT', // Portugal (FIPS: PO, ISO: PT) ★
    'RQ': 'PR', // Puerto Rico (FIPS: RQ, ISO: PR)
    'QA': 'QA', // Qatar
    'RO': 'RO', // Romania
    'RS': 'RU', // Russia (FIPS: RS, ISO: RU) ★
    'RW': 'RW', // Rwanda
    'SC': 'KN', // Saint Kitts (FIPS: SC, ISO: KN)
    'ST': 'LC', // Saint Lucia (FIPS: ST, ISO: LC)
    'VC': 'VC', // Saint Vincent
    'WS': 'WS', // Samoa
    'SM': 'SM', // San Marino
    'TP': 'ST', // São Tomé (FIPS: TP, ISO: ST)
    'SA': 'SA', // Saudi Arabia
    'SG': 'SN', // Senegal (FIPS: SG, ISO: SN)
    'RI': 'RS', // Serbia (FIPS: RI, ISO: RS)
    'SE': 'SC', // Seychelles (FIPS: SE, ISO: SC)
    'SL': 'SL', // Sierra Leone
    'SN': 'SG', // Singapore (FIPS: SN, ISO: SG) ★
    'LO': 'SK', // Slovakia (FIPS: LO, ISO: SK)
    'SI': 'SI', // Slovenia
    'BP': 'SB', // Solomon Islands (FIPS: BP, ISO: SB)
    'SO': 'SO', // Somalia
    'SF': 'ZA', // South Africa (FIPS: SF, ISO: ZA) ★
    'OD': 'SS', // South Sudan (FIPS: OD, ISO: SS) ★
    'SP': 'ES', // Spain (FIPS: SP, ISO: ES) ★
    'CE': 'LK', // Sri Lanka (FIPS: CE, ISO: LK)
    'SU': 'SD', // Sudan (FIPS: SU, ISO: SD) ★
    'NS': 'SR', // Suriname (FIPS: NS, ISO: SR)
    'WZ': 'SZ', // Eswatini/Swaziland (FIPS: WZ, ISO: SZ)
    'SW': 'SE', // Sweden (FIPS: SW, ISO: SE) ★
    'SZ': 'CH', // Switzerland (FIPS: SZ, ISO: CH) ★
    'SY': 'SY', // Syria
    'TW': 'TW', // Taiwan
    'TI': 'TJ', // Tajikistan (FIPS: TI, ISO: TJ)
    'TZ': 'TZ', // Tanzania
    'TH': 'TH', // Thailand
    'TT': 'TL', // Timor-Leste (FIPS: TT, ISO: TL)
    'TO': 'TG', // Togo (FIPS: TO, ISO: TG)
    'TN': 'TO', // Tonga (FIPS: TN, ISO: TO)
    'TD': 'TT', // Trinidad (FIPS: TD, ISO: TT)
    'TS': 'TN', // Tunisia (FIPS: TS, ISO: TN) ★
    'TU': 'TR', // Turkey (FIPS: TU, ISO: TR) ★
    'TX': 'TM', // Turkmenistan (FIPS: TX, ISO: TM)
    'TV': 'TV', // Tuvalu
    'UG': 'UG', // Uganda
    'UP': 'UA', // Ukraine (FIPS: UP, ISO: UA) ★
    'AE': 'AE', // UAE
    'UK': 'GB', // United Kingdom (FIPS: UK, ISO: GB) ★
    'US': 'US', // United States
    'UY': 'UY', // Uruguay
    'UZ': 'UZ', // Uzbekistan
    'NH': 'VU', // Vanuatu (FIPS: NH, ISO: VU)
    'VT': 'VA', // Vatican (FIPS: VT, ISO: VA)
    'VE': 'VE', // Venezuela
    'VM': 'VN', // Vietnam (FIPS: VM, ISO: VN) ★
    'VI': 'VG', // British Virgin Islands (FIPS: VI, ISO: VG)
    'VQ': 'VI', // US Virgin Islands (FIPS: VQ, ISO: VI)
    'WE': 'PS', // West Bank → Palestine (FIPS: WE, ISO: PS) ★
    'YM': 'YE', // Yemen (FIPS: YM, ISO: YE) ★
    'ZA': 'ZM', // Zambia (FIPS: ZA, ISO: ZM)
    'ZI': 'ZW', // Zimbabwe (FIPS: ZI, ISO: ZW)
};

// Territories and special codes to EXCLUDE from main country map
export const EXCLUDED_CODES = new Set([
    'AY', // Antarctica
    'BV', // Bouvet Island
    'IO', // British Indian Ocean Territory
    'HM', // Heard and McDonald Islands
    'TF', // French Southern Territories
    'GS', // South Georgia
    'UM', // US Minor Outlying Islands
    'XX', // Unknown
    '--', // Unknown
]);

/**
 * Convert FIPS code to ISO2
 * @param {string} fipsCode - FIPS 10-4 country code
 * @returns {{iso2: string|null, status: 'mapped'|'identity'|'excluded'|'unknown'}}
 */
export function fipsToIso2(fipsCode) {
    if (!fipsCode || fipsCode.length !== 2) {
        return { iso2: null, status: 'unknown' };
    }

    const upper = fipsCode.toUpperCase();

    if (EXCLUDED_CODES.has(upper)) {
        return { iso2: null, status: 'excluded' };
    }

    if (FIPS_TO_ISO2[upper]) {
        return {
            iso2: FIPS_TO_ISO2[upper],
            status: upper === FIPS_TO_ISO2[upper] ? 'identity' : 'mapped'
        };
    }

    // Unknown code - might be valid ISO2 already or truly unknown
    return { iso2: null, status: 'unknown' };
}

// Reverse mapping cache
let ISO_TO_FIPS_CACHE = null;

/**
 * Convert ISO2 code to FIPS 10-4
 * Use this when querying GDELT ActionGeo_CountryCode with ISO inputs
 * @param {string} iso2 
 * @returns {string|null} FIPS code or null if not found
 */
export function iso2ToFips(iso2) {
    if (!iso2) return null;
    const upper = iso2.toUpperCase();

    if (!ISO_TO_FIPS_CACHE) {
        ISO_TO_FIPS_CACHE = {};
        // Invert FIPS_TO_ISO2
        for (const [fips, iso] of Object.entries(FIPS_TO_ISO2)) {
            // If multiple FIPS map to same ISO, we might have issues.
            // But usually there is a "canonical" FIPS for the country.
            // For Serbia (RS), FIPS_TO_ISO2 has 'RI': 'RS'.
            // For Russia (RU), FIPS_TO_ISO2 has 'RS': 'RU'.
            // We blindly take the first one or override if needed.
            if (!ISO_TO_FIPS_CACHE[iso]) {
                ISO_TO_FIPS_CACHE[iso] = fips;
            }
        }
        // Manual Overrides / Identity check
        // If an ISO code is NOT in FIPS_TO_ISO2 values, it might be an Identity mapping (US -> US)
        // We should add identity mappings for cases where FIPS code == ISO code but not explicitly listed?
        // Actually FIPS_TO_ISO2 only lists *differences*.
        // The file says: "Standard mappings where FIPS differs from ISO2".
        // So if not in list, assume Identity?
        // Verification: 'RI': 'RS' (Serbia) is in list.
        // 'RS': 'RU' (Russia) is in list.
        // 'US' is NOT in list. FIPS 'US' = ISO 'US'.
    }

    if (ISO_TO_FIPS_CACHE[upper]) return ISO_TO_FIPS_CACHE[upper];

    // Fallback: Assume Identity if not in exclusion list?
    // But checked EXCLUDED_CODES are FIPS.
    // If we assume identity:
    // RS (Serbia) -> is mapped to RI in cache. So we return RI. Correct.
    // RU (Russia) -> mapped to RS in cache. Return RS. Correct.
    // US -> not in cache. Return US. Correct.
    return upper;
}

/**
 * Aggregate data by ISO2, merging duplicates
 * @param {Object} fipsData - Object keyed by FIPS codes
 * @returns {{data: Object, stats: Object}}
 */
export function aggregateToIso2(fipsData) {
    const iso2Data = {};
    const stats = {
        mapped: 0,
        identity: 0,
        excluded: 0,
        unknown: [],
        duplicates: []
    };

    for (const [fips, data] of Object.entries(fipsData)) {
        const { iso2, status } = fipsToIso2(fips);

        if (status === 'excluded') {
            stats.excluded++;
            continue;
        }

        if (status === 'unknown') {
            stats.unknown.push(fips);
            continue;
        }

        if (status === 'mapped') stats.mapped++;
        if (status === 'identity') stats.identity++;

        // Merge if duplicate
        if (iso2Data[iso2]) {
            stats.duplicates.push({ fips, iso2 });
            const existing = iso2Data[iso2];

            // Generic merge for numerical fields and specific handling for known ones
            const merged = { ...existing };

            // Sum basic counts
            merged.event_count = (existing.event_count || 0) + (data.event_count || 0);
            merged.r1_security = (existing.r1_security || 0) + (data.r1_security || 0);
            merged.r2_living_count = (existing.r2_living_count || 0) + (data.r2_living_count || 0);
            merged.r3_governance = (existing.r3_governance || 0) + (data.r3_governance || 0);
            merged.r4_fiscal_count = (existing.r4_fiscal_count || 0) + (data.r4_fiscal_count || 0);
            merged.domestic_event_count = (existing.domestic_event_count || 0) + (data.domestic_event_count || 0);

            // Average for ratios and tone
            merged.avg_tone = ((existing.avg_tone || 0) + (data.avg_tone || 0)) / 2;

            // Recalculate domestic_ratio from merged counts
            merged.domestic_ratio = merged.event_count > 0
                ? merged.domestic_event_count / merged.event_count
                : (existing.domestic_ratio ?? data.domestic_ratio ?? 1.0);

            // Merge baseline fields (prefixed with _)
            Object.keys(data).filter(k => k.startsWith('_')).forEach(k => {
                if (typeof data[k] === 'number') {
                    merged[k] = (existing[k] || 0) + data[k];
                }
            });

            merged._merged_from = [...(existing._merged_from || [existing._fips || fips]), fips];
            iso2Data[iso2] = merged;
        } else {
            iso2Data[iso2] = { ...data, _fips: fips };
        }
    }

    return { data: iso2Data, stats };
}

/**
 * Log conversion stats
 */
export function logConversionStats(stats) {
    console.log(`[CODE CONVERSION]`);
    console.log(`  Mapped:     ${stats.mapped}`);
    console.log(`  Identity:   ${stats.identity}`);
    console.log(`  Excluded:   ${stats.excluded}`);

    if (stats.duplicates.length > 0) {
        console.warn(`  [WARN] Duplicates: ${stats.duplicates.map(d => `${d.fips}→${d.iso2}`).join(', ')}`);
    }

    if (stats.unknown.length > 0) {
        console.warn(`  [WARN] Unknown codes: ${stats.unknown.join(', ')}`);
    }
}

/**
 * Load country name map from GeoJSON with manual overrides
 * @returns {Object} { iso2: name_en }
 */
export function loadCountryNameMap() {
    const geoPath = path.resolve(__dirname, '../public/geo/countries.geojson');
    if (!fs.existsSync(geoPath)) {
        console.warn(`[WARN] GeoJSON not found at ${geoPath}`);
        return {};
    }

    const geoData = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
    const nameMap = {};

    geoData.features.forEach(f => {
        const code = f.properties['ISO3166-1-Alpha-2'];
        const name = f.properties['name'] || f.properties['ADMIN'];
        if (code && name) {
            // Fill if empty, but we'll apply overrides after
            if (!nameMap[code]) nameMap[code] = name;
        }
    });

    // Manual Overrides for known territory collisions in our patched GeoJSON
    nameMap['FR'] = 'France';
    nameMap['NO'] = 'Norway';
    nameMap['GB'] = 'United Kingdom';

    return nameMap;
}
