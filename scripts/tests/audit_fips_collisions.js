
import { FIPS_TO_ISO2, fipsToIso2, iso2ToFips } from '../fips_to_iso2.js';

/**
 * Audit ISO vs FIPS Collisions
 * 
 * Identifies countries where querying with the ISO code directly (as a FIPS code)
 * would return data for a DIFFERENT country.
 * 
 * Logic:
 * 1. For each ISO code that exists / we care about (derived from FIPS_TO_ISO2 values + common knowns).
 * 2. Check if that ISO code string exists as a Key in FIPS_TO_ISO2 (or is a valid FIPS code).
 * 3. If it is a valid FIPS code, check which ISO it maps to.
 * 4. If Mapped_ISO != Original_ISO, it's a Collision.
 */

// Invert FIPS_TO_ISO2 to get "Canonical FIPS" for each ISO
const isoToFipsMap = {};
Object.entries(FIPS_TO_ISO2).forEach(([fips, iso]) => {
    // FIPS 'RI' -> ISO 'RS' (Serbia)
    if (!isoToFipsMap[iso]) isoToFipsMap[iso] = fips;
});

// We also need to consider Identity mappings (US -> US) that are NOT in FIPS_TO_ISO2 explicitly?
// FIPS_TO_ISO2 only lists differences.
// But we want to check ALL ISO codes. 
// Let's generate a set of All ISOs from the values of FIPS_TO_ISO2.
const allIsos = new Set(Object.values(FIPS_TO_ISO2));

console.log("=== ISO-FIPS COLLISION AUDIT ===");
console.log("Checking for cases where ISO code != FIPS code, AND ISO code is valid for ANOTHER country...");

const collisions = [];

for (const iso of allIsos) {
    // 1. What is the correct FIPS for this ISO?
    // If not in inverted map, assume Identity (ISO=FIPS)
    const correctFips = isoToFipsMap[iso] || iso;

    // 2. What happens if we use ISO as FIPS?
    // Look up FIPS=iso in FIPS_TO_ISO2
    // If 'iso' is not in FIPS_TO_ISO2 keys, then FIPS 'iso' maps to ISO 'iso' (Identity) (unless it's invalid/unknown)
    // Actually, we need to know if FIPS 'iso' *exists* and what it means.

    // Using the library's fipsToIso2 function
    const interpretations = fipsToIso2(iso);
    // interpreting the ISO string as a FIPS code.

    // Result
    const interpretedIso = interpretations.iso2;
    const status = interpretations.status;

    // If interpretedIso is NULL/Unknown, then using the ISO code returns nothing (Safe, just no data).
    // If interpretedIso == iso, then it's safe (Identity).
    // If interpretedIso != iso, then it's a COLLISION.

    if (interpretedIso && interpretedIso !== iso) {
        collisions.push({
            Country: iso,
            CorrectFIPS: correctFips,
            UsedISO: iso,
            InterpretedAsFIPS_For: interpretedIso,
            Msg: `[${iso}] uses FIPS [${correctFips}]. But query [${iso}] gets [${interpretedIso}] data!`
        });
    }
}

// Specific Check for known ones if missing from loop
// (The loop only covers ISOs that appear as *values* in the mapping file, i.e., those with non-standard FIPS)
// We should check widely.

console.log(`Found ${collisions.length} collisions among mapped countries:`);
collisions.forEach(c => console.log(c.Msg));

// Additional manual check for common codes
const extraChecks = ['US', 'JP', 'CN', 'ID', 'IN', 'GB', 'AU', 'AT', 'CH', 'SE', 'DK', 'ZA', 'RS', 'RU'];
extraChecks.forEach(iso => {
    // Only check if not already reported
    if (collisions.find(c => c.Country === iso)) return;

    const correctFips = iso2ToFips(iso); // uses our cache
    const { iso2: interpreted } = fipsToIso2(iso); // treat iso string as FIPS

    if (interpreted && interpreted !== iso) {
        console.log(`[MANUAL CHECK] [${iso}] uses FIPS [${correctFips}]. Query [${iso}] gets [${interpreted}] data!`);
    }
});
