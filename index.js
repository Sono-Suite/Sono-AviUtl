const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const readline = require('readline');

// Target Directories & Config Paths
const AVIUTL_DIR = 'C:\\ProgramData\\aviutl2';
const PLUGIN_DIR = path.join(AVIUTL_DIR, 'Plugin');
const LANG_DIR = path.join(AVIUTL_DIR, 'Language');
const CONFIG_PATH = path.join(AVIUTL_DIR, 'aviutl2.conf');
const WORKSPACE_TMP = path.join(__dirname, 'tmp_installer');

let forceUpdate = false;

// Utility to recursively locate binary files inside nested extraction paths
function findFileRecursive(dir, targetFile) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(fullPath, targetFile);
      if (found) return found;
    } else if (entry.name.toLowerCase() === targetFile.toLowerCase()) {
      return fullPath;
    }
  }
  return null;
}

const PLUGINS_MANIFEST = [
  {
    name: 'L-SMASH Works',
    type: 'github',
    repo: 'Mr-Ojii/L-SMASH-Works-Auto-Builds',
    binary: 'lwinput.aui2',
    getPattern: () => '.zip',
    extract: (tmp, destDir) => {
      execSync(`powershell -Command "Expand-Archive -Path '${tmp}' -DestinationPath '${destDir}' -Force"`);
      const found = findFileRecursive(destDir, 'lwinput.aui2');
      if (!found) throw new Error("Could not locate lwinput.aui2 inside extracted archive.");
      return found;
    }
  },
  {
    name: 'MP4Exporter',
    type: 'direct',
    url: 'https://apps.esugo.net/aviutl2-mp4exporter/releases/MP4Exporter_1.0.1.zip',
    binary: 'MP4Exporter.auo2',
    extract: (tmp, destDir) => {
      execSync(`powershell -Command "Expand-Archive -Path '${tmp}' -DestinationPath '${destDir}' -Force"`);
      const found = findFileRecursive(destDir, 'MP4Exporter.auo2');
      if (!found) throw new Error("Could not locate MP4Exporter.auo2 inside extracted archive.");
      return found;
    }
  }
];

// --- Input Management ---
const askQuestion = (query) => new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (ans) => { rl.close(); resolve(ans.trim().toLowerCase()); });
});

// --- Zero-Dependency IO Network Engine ---
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        if (!dest || typeof dest !== 'string') {
            return reject(new Error('Destination path must be a valid string.'));
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch (err) {
            return reject(new Error(`Invalid URL provided: ${url}`));
        }

        const file = fs.createWriteStream(dest);
        const requestOptions = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            headers: { 'User-Agent': 'NodeJS-AviUtl-Installer' }
        };

        https.get(requestOptions, (response) => {
            // Handle HTTP Redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                let redirectUrl = response.headers.location;
                if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
                    redirectUrl = new URL(redirectUrl, 'https://github.com').href;
                }
                file.close(() => {
                    fs.unlink(dest, () => {
                        downloadFile(redirectUrl, dest).then(resolve).catch(reject);
                    });
                });
                return;
            }

            if (response.statusCode !== 200) {
                file.close(() => {
                    fs.unlink(dest, () => {
                        reject(new Error(`Server responded with status: ${response.statusCode}`));
                    });
                });
                return;
            }

            const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
            let downloadedBytes = 0;

            response.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                
                if (totalBytes > 0) {
                    const percentage = ((downloadedBytes / totalBytes) * 100).toFixed(1);
                    const width = 30;
                    const filled = Math.round((width * downloadedBytes) / totalBytes);
                    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
                    const currentMB = (downloadedBytes / (1024 * 1024)).toFixed(2);
                    const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);

                    readline.clearLine(process.stdout, 0);
                    readline.cursorTo(process.stdout, 0);
                    process.stdout.write(`📥 Downloading: [${bar}] ${percentage}% (${currentMB} / ${totalMB} MB)`);
                } else {
                    readline.clearLine(process.stdout, 0);
                    readline.cursorTo(process.stdout, 0);
                    process.stdout.write(`📥 Downloading: ${(downloadedBytes / (1024 * 1024)).toFixed(2)} MB received...`);
                }
            });

            response.pipe(file);

            file.on('finish', () => {
                process.stdout.write('\n');
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

function fetchLatestGitHubReleaseUrl(repo, searchPattern) {
    return new Promise((resolve, reject) => {
        const apiOptions = {
            hostname: 'api.github.com',
            path: `/repos/${repo}/releases/latest`,
            headers: {
                'User-Agent': 'NodeJS-AviUtl-Installer',
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        https.get(apiOptions, (res) => {
            let data = '';

            if (res.statusCode === 403) return reject(new Error('GitHub API Rate Limit Exceeded (403).'));
            if (res.statusCode !== 200) return reject(new Error(`GitHub API returned status ${res.statusCode}`));

            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const releaseInfo = JSON.parse(data);
                    if (!releaseInfo.assets || !Array.isArray(releaseInfo.assets)) {
                        return reject(new Error('Invalid release asset payload schema.'));
                    }

                    const asset = releaseInfo.assets.find(a => 
                        a && a.name && a.name.toLowerCase().includes(searchPattern.toLowerCase())
                    );

                    if (!asset || !asset.browser_download_url) {
                        return reject(new Error(`Could not locate asset pattern: "${searchPattern}"`));
                    }

                    resolve(asset.browser_download_url);
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', reject);
    });
}

// --- Configuration Setup ---
function injectSystemSettingsProfile() {
    console.log('[Config Engine] Setting properties to English & 60 FPS...');
    const targetProperties = ['Language="English [Edit]"', 'FPS=60'];

    if (!fs.existsSync(CONFIG_PATH)) {
        fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
        fs.writeFileSync(CONFIG_PATH, `[aviutl2]\n${targetProperties.join('\n')}\n`, 'utf8');
        console.log('✔ Generated fresh aviutl2.conf');
        return;
    }

    let configText = fs.readFileSync(CONFIG_PATH, 'utf8');
    targetProperties.forEach(property => {
        const key = property.split('=')[0];
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (configText.match(regex)) {
            configText = configText.replace(regex, property);
        } else {
            configText = configText.replace('[aviutl2]', `[aviutl2]\n${property}`);
        }
    });

    fs.writeFileSync(CONFIG_PATH, configText, 'utf8');
    console.log('✔ Configuration updated successfully.');
}

// --- Main Execution Flow ---
async function executeInstallationPipeline() {
    const tmpDir = WORKSPACE_TMP;
    try {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        // 1. Download & Execute Core setup.exe
        const coreExe = path.join(AVIUTL_DIR, 'aviutl2.exe');
        if (!fs.existsSync(coreExe) || forceUpdate) {
            console.log('\n--- Fetching AviUtl Setup Package ---');
            const setupExePath = path.join(tmpDir, 'AviUtl2_setup.exe');
            
            await downloadFile('https://spring-fragrance.mints.ne.jp/aviutl/AviUtl2_v2.1.9_setup.exe', setupExePath);
            
            console.log('Running installer silently...');
            execSync(`"${setupExePath}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`, { stdio: 'inherit' });
            console.log('✔ AviUtl setup core installed.');
        }

        // 2. Setup System Paths & Configuration
        [PLUGIN_DIR, LANG_DIR].forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); });
        injectSystemSettingsProfile();

        // 3. Plugin Deployment Loop
        for (const plugin of PLUGINS_MANIFEST) {
            const destinationPath = path.join(PLUGIN_DIR, plugin.binary);
            if (!fs.existsSync(destinationPath) || forceUpdate) {
                console.log(`\n--- Deploying Plugin: ${plugin.name} ---`);
                const zipPath = path.join(tmpDir, `${plugin.name}.zip`);
                const outPath = path.join(tmpDir, `${plugin.name}_extracted`);
                
                try {
                    let downloadUrl = '';
                    if (plugin.type === 'github') {
                        const searchPattern = plugin.getPattern();
                        downloadUrl = await fetchLatestGitHubReleaseUrl(plugin.repo, searchPattern);
                    } else if (plugin.type === 'direct') {
                        downloadUrl = plugin.url;
                    }

                    await downloadFile(downloadUrl, zipPath);
                    const binaryPath = plugin.extract(zipPath, outPath);

                    if (binaryPath && fs.existsSync(binaryPath)) {
                        fs.copyFileSync(binaryPath, destinationPath);
                        console.log(`✔ Successfully deployed ${plugin.name}`);
                    } else {
                        console.error(`\x1b[31mCould not locate output binary file for: ${plugin.name}\x1b[0m`);
                    }
                } catch (err) {
                    console.error(`\x1b[31mFailed to deploy ${plugin.name}: ${err.message}\x1b[0m`);
                }
            }
        }
        console.log('\n🎉 AviUtl setup sequence completed successfully!');
        
        // Pause after installation completes
        await askQuestion('\nPress Enter to return to main menu...');
    } catch (err) {
        console.error(`\n\x1b[31mExecution pipeline failed: ${err.message}\x1b[0m`);
    } finally {
        if (tmpDir && typeof tmpDir === 'string' && fs.existsSync(tmpDir)) {
            try {
                fs.rmSync(tmpDir, { 
                    recursive: true, 
                    force: true, 
                    maxRetries: 5, 
                    retryDelay: 1000 
                });
            } catch (cleanupErr) {
                console.warn(`[Warning] Could not immediately delete ${tmpDir} (File locked by Windows). It will be cleaned up on next run.`);
            }
        }
    }
}

// --- Entry Point ---
async function main() {
    try {
        const runInstall = await askQuestion('Run full AviUtl + Plugins installation? (yes/no): ');
        if (['y', 'yes'].includes(runInstall)) {
            const forceCheck = await askQuestion('Force overwrite existing files? (yes/no): ');
            if (['y', 'yes'].includes(forceCheck)) forceUpdate = true;

            await executeInstallationPipeline();
        } else {
            console.log('Installation canceled.');
        }
    } catch (err) {
        console.error('\nAn unexpected error occurred:', err);
    } finally {
        await askQuestion('\nProcess finished. Press Enter to exit...');
    }
}

main();