import 'dotenv/config';
import * as ftp from 'basic-ftp';
import path from 'path';
import fs from 'fs';

const CANDIDATE_DIRS = ['dist', 'dist_prod', 'dist_prod_v2', 'dist_prod_v3'];
let BUILD_DIR = null;

for (const dir of CANDIDATE_DIRS) {
    if (fs.existsSync(dir)) {
        BUILD_DIR = dir;
        break;
    }
}

const REMOTE_ROOT = process.env.FTP_REMOTE_ROOT || '/public_html';

async function deploy() {
    const client = new ftp.Client();
    // client.ftp.verbose = true;

    const host = process.env.FTP_HOST;
    const user = process.env.FTP_USER;
    const password = process.env.FTP_PASS;

    if (!host || !user || !password) {
        console.error("❌ Error: Missing FTP credentials in .env file.");
        console.error("Please ensure FTP_HOST, FTP_USER, and FTP_PASS are set.");
        process.exit(1);
    }

    if (!BUILD_DIR) {
        console.error(`❌ Error: No build directory found. Checked: ${CANDIDATE_DIRS.join(', ')}`);
        process.exit(1);
    }

    try {
        console.log(`🔌 Connecting to ${host} as ${user}...`);
        await client.access({
            host,
            user,
            password,
            secure: false // Set to true for explicit FTPS, or 'implicit'
        });

        console.log(`📂 Remote root: ${REMOTE_ROOT}`);
        await client.ensureDir(REMOTE_ROOT);

        console.log(`🚀 Starting upload from '${BUILD_DIR}'...`);

        // uploadFromDir automatically uploads the contents of a local directory to the current remote directory.
        // It's efficient but blindly overwrites by default. 
        // For a true "diff" we could manually walk, but basic-ftp is fast enough for 400 files.
        // We will stick to standard upload for reliability first.

        await client.uploadFromDir(BUILD_DIR);

        console.log("✅ Deployment complete!");

    } catch (err) {
        console.error("❌ Deployment failed:", err);
        process.exit(1);
    } finally {
        client.close();
    }
}

deploy();
