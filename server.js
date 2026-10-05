// Opark on-demand scheduler.
// Trigger this from your phone (see iOS Shortcut instructions below).
// It schedules exactly ONE run for the next 5:00am Australia/Melbourne time,
// then goes back to idle. Trigger it again tomorrow (or automate the trigger too).

const express = require('express');
const { DateTime } = require('luxon');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');

const execAsync = promisify(exec);

require('dotenv').config({ path: path.join(__dirname, '.opark-credentials') });

const AUTH_TOKEN = process.env.OPARK_SCHEDULER_TOKEN;
const PORT = process.env.PORT || 3000;
const TZ = 'Australia/Melbourne';

if (!AUTH_TOKEN) {
  console.error('Set OPARK_SCHEDULER_TOKEN in .opark-credentials — a long random string.');
  process.exit(1);
}

const LOG_FILE = path.join(__dirname, 'scheduler.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  fs.appendFileSync(LOG_FILE, line + '\n');
  console.log(line);
}

let scheduledFor = null; // ISO string of the currently pending run, or null
let timer = null;

function nextFiveAm() {
  const now = DateTime.now().setZone(TZ);
  let target = now.set({ hour: 5, minute: 0, second: 0, millisecond: 0 });
  if (target <= now) target = target.plus({ days: 1 });
  // Small random jitter (0-4 min) so it's not a suspiciously exact trigger every time.
  target = target.plus({ minutes: Math.floor(Math.random() * 5) });
  return target;
}

function runRenewal() {
  log('Firing scheduled renewal now');
  scheduledFor = null;
  execFile('node', [path.join(__dirname, 'renew.js')], (err, stdout, stderr) => {
    if (err) {
      log(`renew.js exited with error: ${err.message}`);
    } else {
      log('renew.js completed');
    }
    if (stdout) log(`stdout: ${stdout.trim()}`);
    if (stderr) log(`stderr: ${stderr.trim()}`);
  });
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  const target = nextFiveAm();
  const msUntil = target.toMillis() - Date.now();
  scheduledFor = target.toISO();
  timer = setTimeout(runRenewal, msUntil);
  log(`Scheduled next run for ${scheduledFor} (in ${Math.round(msUntil / 60000)} min)`);
  return target;
}

const app = express();
app.use(express.json());

function checkAuth(req, res, next) {
  const token = req.get('x-auth-token');
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// Call this from your phone after you park.
app.post('/schedule', checkAuth, (req, res) => {
  const target = scheduleNext();
  res.json({ status: 'scheduled', for: target.toISO() });
});

// Check what's currently pending.
app.get('/status', checkAuth, (req, res) => {
  res.json({ scheduledFor });
});

// Manual immediate trigger, handy for testing.
app.post('/run-now', checkAuth, (req, res) => {
  runRenewal();
  res.json({ status: 'triggered' });
});

// Cancel a pending scheduled run.
app.post('/cancel', checkAuth, (req, res) => {
  if (timer) clearTimeout(timer);
  timer = null;
  scheduledFor = null;
  log('Cancelled pending run');
  res.json({ status: 'cancelled' });
});

// Translate an image using Python OCR + translation pipeline.
//
// Request body:
//   raw image/jpeg bytes
//
// Response:
//   image/png with translated text overlaid
app.post(
  '/translate-image',
  checkAuth,
  express.raw({
    type: [
      'image/jpeg',
      'image/png',
      'image/webp'
    ],
    limit: '15mb'
  }),
  async (req, res) => {
    let inputPath = null;
    let outputPath = null;

    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({
          error: 'No image received'
        });
      }

      log(
        `Image translation requested (${req.body.length} bytes)`
      );

      // Write input image to temp file
      const tempDir = os.tmpdir();
      const inputFilename = `img-translate-${Date.now()}-input.png`;
      const outputFilename = `img-translate-${Date.now()}-output.png`;
      inputPath = path.join(tempDir, inputFilename);
      outputPath = path.join(tempDir, outputFilename);

      fs.writeFileSync(inputPath, req.body);

      // Call Python script with paths relative to server.js
      const imgTranslateDir = path.resolve(__dirname, '../img-translate');
      const pythonScript = path.join(imgTranslateDir, 'main.py');
      const venvPython = path.join(imgTranslateDir, '.venv/bin/python');

      // Use venv python if it exists, otherwise find system python
      let pythonCmd = venvPython;
      if (!fs.existsSync(venvPython)) {
        // Try common Python locations
        const pythonPaths = [
          '/usr/bin/python3',
          '/usr/local/bin/python3',
          '/opt/homebrew/bin/python3',
          'python3',
          'python'
        ];
        pythonCmd = pythonPaths.find(p => {
          try {
            return fs.existsSync(p) || p === 'python3' || p === 'python';
          } catch {
            return false;
          }
        }) || 'python3';
      }

      log(`Running Python translation: ${pythonCmd} ${pythonScript}`);
      log(`venv exists: ${fs.existsSync(venvPython)}, using: ${pythonCmd}`);

      const cmd = `"${pythonCmd}" "${pythonScript}" "${inputPath}" --output "${outputPath}"`;
      log(`Executing: ${cmd}`);
      
      const { stdout, stderr } = await execAsync(cmd, {
        cwd: imgTranslateDir,
        timeout: 120000,
        env: {
          ...process.env,
          AZURE_CV_KEY: process.env.AZURE_CV_KEY || process.env.AZURE_API_KEY,
          AZURE_CV_ENDPOINT: process.env.AZURE_CV_ENDPOINT || process.env.AZURE_ENDPOINT,
          GOOGLE_API_KEY: process.env.GOOGLE_API_KEY
        }
      });

      if (stdout) log(`Python stdout: ${stdout.trim()}`);
      if (stderr) log(`Python stderr: ${stderr.trim()}`);

      // Read output image
      if (!fs.existsSync(outputPath)) {
        throw new Error('Python script did not produce output file');
      }

      const resultBuffer = fs.readFileSync(outputPath);

      log(`Returning translated image (${resultBuffer.length} bytes)`);

      res.type('png');
      res.send(resultBuffer);

      log('Image translation completed');

    } catch (err) {
      log(
        `Image translation failed: ${err.stack || err.message}`
      );

      res.status(500).json({
        error: 'image translation failed',
        message: err.message
      });
    } finally {
      // Clean up temp files
      if (inputPath && fs.existsSync(inputPath)) {
        fs.unlinkSync(inputPath);
      }
      if (outputPath && fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
    }
  }
);

app.listen(PORT, () => log(`Scheduler listening on port ${PORT}`));
