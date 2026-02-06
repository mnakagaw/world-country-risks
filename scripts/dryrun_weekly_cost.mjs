import fs from "fs";
import path from "path";
import { BigQuery } from "@google-cloud/bigquery";
import { buildRCondition } from "./gdelt_bigquery.js";

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith("--")) {
            const key = a.slice(2);
            const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
            out[key] = val;
        }
    }
    return out;
}

function toTiB(bytes) {
    // BigQuery pricing uses tebibytes (2^40) in many references; we use TiB = 2^40 bytes.
    return bytes / (1024 ** 4);
}

function usd(n) {
    return `$${n.toFixed(2)}`;
}

async function main() {
    const args = parseArgs(process.argv);
    const start = args.start;
    const end = args.end;
    const weeks = Number(args.weeks || 52);
    const pricePerTiB = Number(args.price || 6.25); // on-demand USD per TiB
    const freeTiB = Number(args.free_tib || 1); // optional illustrative free tier

    if (!start || !end) {
        console.error("Usage: node scripts/dryrun_weekly_cost.mjs --start YYYY-MM-DD --end YYYY-MM-DD [--weeks 52] [--price 6.25] [--free_tib 1]");
        process.exit(1);
    }

    const sqlPath = path.join(process.cwd(), "scripts", "weekly_query.sql");
    if (!fs.existsSync(sqlPath)) {
        console.error("SQL file not found:", sqlPath);
        process.exit(1);
    }
    const queryRaw = fs.readFileSync(sqlPath, "utf8");
    const rDefsPath = path.join(process.cwd(), "config", "r_definitions.json");
    const rDefs = JSON.parse(fs.readFileSync(rDefsPath, "utf8"));

    const query = queryRaw
        .replace(/\${R1_CONDITION}/g, buildRCondition(rDefs.R1))
        .replace(/\${R2_CONDITION}/g, buildRCondition(rDefs.R2))
        .replace(/\${R3_CONDITION}/g, buildRCondition(rDefs.R3))
        .replace(/\${R4_CONDITION}/g, buildRCondition(rDefs.R4));

    const keyPath = path.join(process.cwd(), 'credentials', 'gcp-service-account.json');
    const BQ_PROJECT_ID = process.env.BQ_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'countryrisks-prod';

    const bigquery = new BigQuery({
        projectId: BQ_PROJECT_ID,
        keyFilename: keyPath
    });

    const options = {
        query,
        dryRun: true,
        useQueryCache: false,
        parameterMode: "NAMED",
        queryParameters: [
            { name: "start_date", parameterType: { type: "DATE" }, parameterValue: { value: start } },
            { name: "end_date", parameterType: { type: "DATE" }, parameterValue: { value: end } },
        ],
    };

    const [job] = await bigquery.createQueryJob(options);
    const bytes = Number(job.metadata?.statistics?.totalBytesProcessed || 0);

    const tibWeek = toTiB(bytes);
    const tibAll = tibWeek * weeks;

    const costAll = tibAll * pricePerTiB;
    const tibAfterFree = Math.max(0, tibAll - freeTiB);
    const costAfterFree = tibAfterFree * pricePerTiB;

    console.log(`Dry run bytes (1 week): ${bytes}`);
    console.log(`TiB (1 week): ${tibWeek.toFixed(4)}`);
    console.log(`Est TiB (${weeks} weeks): ${tibAll.toFixed(4)}`);
    console.log(`Est cost (${weeks}w) @ ${usd(pricePerTiB)}/TiB: ${usd(costAll)}`);
    console.log(`Est cost minus ${freeTiB} TiB (if applicable): ${usd(costAfterFree)} (NOTE: free tier depends on billing/account)`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
