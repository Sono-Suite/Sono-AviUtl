const { execSync } = require('child_process');
const fs = require('fs');

const { CONFIG_NAME, OUTPUT_EXE } = require('./config.js')

const startTime = Date.now();

function runBuild() {
    console.log('[INFO] Starting the compiler...');

    try {
        // Generate a standardized config layout pointing directly to your output name
        console.log('[INFO] Generating the config file.');
        const configContent = {
            main: 'index.js',
            output: OUTPUT_EXE,
            disableExperimentalSEAWarning: true
        };
        fs.writeFileSync(CONFIG_NAME, JSON.stringify(configContent, null, 2));

        // Delete the previous EXE file
        if (fs.existsSync(OUTPUT_EXE)) {
            console.log('[INFO] Deleting Previous EXE file');
            fs.unlinkSync(OUTPUT_EXE);
        }

        // 3. RUN NATIVE COMPILER PASS
        // Node 26 handles creating the file, copying the execution frame, and writing resources natively
        console.log(`[INFO] Creating the EXE file (through --build-sea)`);
        execSync(`node --build-sea ${CONFIG_NAME}`, { stdio: 'inherit' });

        console.log(`[INFO] This project has been compiled into an EXE: ${OUTPUT_EXE}`);

    } catch (error) {
        console.error(`[INFO] Project Compilation failed: ${error.message}`);
    } finally {
        // 4. Cleanup temporary configuration setup files
        console.log('[INFO] Deleting the temporary config file.');
        if (fs.existsSync(CONFIG_NAME)) {
            fs.unlinkSync(CONFIG_NAME);
        }
        console.log(`[INFO] All tasks have been completed in ${(Date.now() - startTime) / 1000} seconds.\n`);
    }
}

runBuild();