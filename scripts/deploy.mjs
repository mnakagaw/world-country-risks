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
            secure: false
        });

        console.log(`📂 Remote root: ${REMOTE_ROOT}`);
        await client.ensureDir(REMOTE_ROOT);

        console.log(`🚀 Starting incremental upload from '${BUILD_DIR}'...`);
        const stats = { uploaded: 0, skipped: 0 };

        async function uploadDirRecursive(localDirPath, remoteDirPath) {
            await client.ensureDir(remoteDirPath);
            const localFiles = fs.readdirSync(localDirPath, { withFileTypes: true });
            const remoteFiles = await client.list(remoteDirPath);
            const remoteMap = new Map(remoteFiles.map(f => [f.name, f]));

            for (const file of localFiles) {
                const localPath = path.join(localDirPath, file.name);
                const remotePath = path.posix.join(remoteDirPath, file.name);

                if (file.isDirectory()) {
                    await uploadDirRecursive(localPath, remotePath);
                } else {
                    const localStat = fs.statSync(localPath);
                    const remoteFile = remoteMap.get(file.name);

                    if (remoteFile && remoteFile.size === localStat.size) {
                        stats.skipped++;
                    } else {
                        console.log(`  [UPLOAD] ${remotePath} (${localStat.size} bytes)`);
                        await client.uploadFrom(localPath, remotePath);
                        stats.uploaded++;
                    }
                }
            }
        }

        await uploadDirRecursive(BUILD_DIR, REMOTE_ROOT);

        console.log(`✅ Deployment complete! (Uploaded: ${stats.uploaded}, Skipped: ${stats.skipped})`);

    } catch (err) {
        console.error("❌ Deployment failed:", err);
        process.exit(1);
    } finally {
        client.close();
    }
}

deploy();
