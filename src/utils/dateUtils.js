/**
 * dateUtils.js
 * Shared utilities for date and week calculations matching BigQuery logic (%G-W%V).
 */


/**
 * Returns the ISO week string (YYYY-Www) for a given date.
 * Based on ISO 8601 definition (week starts on Monday, first week has >=4 days).
 * @param {Date|string} dateInput 
 * @returns {string} e.g. "2021-W05"
 */
export function getIsoWeek(dateInput) {
    // Reusing the robust logic from formatIsoWeekKey
    return formatIsoWeekKey(dateInput);
}

/**
 * Robust ISO Week formatter (Polyfill-like)
 * Uses native logic to match BigQuery '%G-W%V'
 */
export function formatIsoWeekKey(dateInput) {
    const d = new Date(dateInput);
    d.setHours(0, 0, 0, 0);
    // Set to nearest Thursday: current date + 4 - current day number
    // Make Sunday's day number 7
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Converts "YYYY-Www" to integer YYYYWW for safe comparison.
 * e.g. "2021-W05" -> 202105
 * @param {string} weekKey 
 * @returns {number}
 */
export function weekKeyToInt(weekKey) {
    if (!weekKey) return 0;
    // Ensure weekKey is a string before splitting
    const keyStr = String(weekKey);
    const parts = keyStr.split('-W');
    if (parts.length !== 2) return 0;
    return parseInt(parts[0]) * 100 + parseInt(parts[1]);
}

/**
 * Enum definitions for Range
 */
export const RANGE_ENUMS = {
    '12w': 12,
    '26w': 26,
    '52w': 52,
    '3y': 156,
    '5y': 260
};

export const DEFAULT_RANGE_ENUM = '52w';

export function getWeeksFromEnum(enumKey) {
    return RANGE_ENUMS[enumKey] || 52;
}

export function getEnumFromWeeks(weeks) {
    return Object.keys(RANGE_ENUMS).find(key => RANGE_ENUMS[key] === weeks) || '52w';
}
