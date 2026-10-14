export const INTEREST_API = 'https://securitywatch.jp/world-alert/country-interest.php';

export function interestQuery(country, day) {
    if (!/^[A-Z]{2}$/.test(country) || !/^20\d{2}-\d{2}-\d{2}$/.test(day)) throw Error('Invalid interest edition');
    return INTEREST_API + '?' + new URLSearchParams({view:'cards', mode:'daily', country, day, limit:'1'});
}

// The popup follows the displayed edition. Never substitute a live or later seal.
export function selectedInterest(value, country, day) {
    const end = Date.parse(day + 'T00:00:00Z') - 6 * 3600000;
    if (value.schema !== 'country-interest-v1' || value.producer !== 'securitywatch-general15' ||
        value.mode !== 'daily' || value.delivery_state !== 'sealed' ||
        !/^[a-f0-9]{64}$/.test(value.snapshot_id || '') ||
        Date.parse(value.window?.end_utc) !== end || Date.parse(value.window?.start_utc) !== end - 86400000 ||
        value.cards?.length !== 1 || value.cards[0].country !== country) throw Error('Interest edition mismatch');
    return {...value, card:{...value.cards[0], top5:(value.cards[0].top5 || []).slice(0,5)}};
}

export function interestHistoryLink(country, day) {
    return 'https://execbrief.net/country-interest/?' + new URLSearchParams({country, day});
}
