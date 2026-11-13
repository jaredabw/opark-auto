// Opark on-demand scheduler.
// Trigger this from your phone (see iOS Shortcut instructions below).
// It schedules exactly ONE run for the next 5:00am Australia/Melbourne time,
// then goes back to idle. Trigger it again tomorrow (or automate the trigger too).

const express = require('express');
const { DateTime } = require('luxon');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

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
let scheduledZone = null; // Zone for the currently pending run, or null
let timer = null;

function nextFiveAm() {
  const now = DateTime.now().setZone(TZ);
  let target = now.set({ hour: 5, minute: 0, second: 0, millisecond: 0 });
  if (target <= now) target = target.plus({ days: 1 });
  // Small random jitter (0-4 min) so it's not a suspiciously exact trigger every time.
  target = target.plus({ minutes: Math.floor(Math.random() * 5) });
  return target;
}

function runRenewal(zone = process.env.OPARK_ZONE) {
  log('Firing scheduled renewal now');
  scheduledFor = null;
  scheduledZone = null;
  execFile('node', [path.join(__dirname, 'renew.js')], {
    env: { ...process.env, OPARK_ZONE: zone },
  }, (err, stdout, stderr) => {
    if (err) {
      log(`renew.js exited with error: ${err.message}`);
    } else {
      log('renew.js completed');
    }
    if (stdout) log(`stdout: ${stdout.trim()}`);
    if (stderr) log(`stderr: ${stderr.trim()}`);
  });
}

function scheduleNext(zone = process.env.OPARK_ZONE) {
  if (timer) clearTimeout(timer);
  const target = nextFiveAm();
  const msUntil = target.toMillis() - Date.now();
  scheduledFor = target.toISO();
  scheduledZone = zone;
  timer = setTimeout(() => runRenewal(zone), msUntil);
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

function checkZone(req, res, next) {
  const zone = req.get('x-opark-zone');
  if (zone !== undefined && (typeof zone !== 'string' || !zone.trim())) {
    return res.status(400).json({ error: 'x-opark-zone must be a non-empty string' });
  }
  next();
}

// Call this from your phone after you park.
app.post('/schedule', checkAuth, checkZone, (req, res) => {
  const target = scheduleNext(req.get('x-opark-zone'));
  res.json({ status: 'scheduled', for: target.toFormat('HH:mm dd/LL/yy'), zone: scheduledZone });
});

// Check what's currently pending.
app.get('/status', checkAuth, (req, res) => {
  res.json({
    scheduledFor: scheduledFor
      ? DateTime.fromISO(scheduledFor).setZone(TZ).toFormat('HH:mm dd/LL/yy')
      : null,
    zone: scheduledZone,
  });
});

// Manual immediate trigger, handy for testing.
app.post('/run-now', checkAuth, checkZone, (req, res) => {
  runRenewal(req.get('x-opark-zone'));
  res.json({ status: 'triggered' });
});

// Cancel a pending scheduled run.
app.post('/cancel', checkAuth, (req, res) => {
  if (timer) clearTimeout(timer);
  timer = null;
  scheduledFor = null;
  scheduledZone = null;
  log('Cancelled pending run');
  res.json({ status: 'cancelled' });
});

app.listen(PORT, () => log(`Scheduler listening on port ${PORT}`));
