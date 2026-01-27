import fs from 'fs';

const PATH = 'f:/Downloads/20260113 world.countryrisks.org/public/geo/countries.geojson';
const geoData = JSON.parse(fs.readFileSync(PATH, 'utf8'));

const updates = {
    'france': 'FR',
    'norway': 'NO',
    'kosovo': 'XK',
    'somaliland': 'SO',
    'akrotiri sovereign base area': 'GB',
    'dhekelia sovereign base area': 'GB',
    'cyprus no mans land': 'CY',
    'clipperton island': 'FR',
    'usnb guantanamo bay': 'US',
    'u.s.nb guantanamo bay': 'US',
    'us naval base guantanamo bay': 'US'
};

let modifiedCount = 0;

geoData.features.forEach((f, idx) => {
    const names = [
        f.properties.NAME,
        f.properties.name,
        f.properties.ADMIN,
        f.properties.SOVEREIGNT,
        f.properties.NAME_LONG
    ].filter(Boolean).map(n => n.toString().toLowerCase().trim());

    let matchedCode = null;
    for (const n of names) {
        if (updates[n]) {
            matchedCode = updates[n];
            break;
        }
    }

    if (matchedCode) {
        const currentCode = f.properties['ISO3166-1-Alpha-2'];
        if (currentCode !== matchedCode) {
            console.log(`[${idx}] Updating match "${names[0]}": ${currentCode} -> ${matchedCode}`);
            f.properties['ISO3166-1-Alpha-2'] = matchedCode;
            modifiedCount++;
        }
    }
});

if (modifiedCount > 0) {
    fs.writeFileSync(PATH, JSON.stringify(geoData, null, 2)); // Add indentation for readability during debugging
    console.log(`\nSuccessfully updated ${modifiedCount} features.`);
} else {
    console.log('\nNo features needed updating.');
}
