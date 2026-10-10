// Opark daily parking auto-renew
// Run via cron shortly after 5:00am (with jitter — see scheduling notes at bottom).

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.opark-credentials') });

const USERNAME = process.env.OPARK_USERNAME;
const PASSWORD = process.env.OPARK_PASSWORD;
const VEHICLE = process.env.OPARK_VEHICLE;
const LOCATION = process.env.OPARK_LOCATION;
const ZONE = process.env.OPARK_ZONE;

if (!USERNAME || !PASSWORD || !VEHICLE || !LOCATION || !ZONE) {
  console.error('Missing OPARK_USERNAME / OPARK_PASSWORD / OPARK_VEHICLE / OPARK_LOCATION / OPARK_ZONE in .opark-credentials');
  process.exit(1);
}

const LOG_FILE = path.join(__dirname, 'renew.log');
const SCREENSHOT_ON_FAIL = path.join(__dirname, 'last-failure.png');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(line.trim());
}

async function ntfy(message) {
  const NTFY_TOPIC = process.env.OPARK_NTFY_TOPIC;
  if (!NTFY_TOPIC) return;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
        method: 'POST',
        body: message,
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return;
      log(`ntfy attempt ${i} got HTTP ${res.status}`);
    } catch (err) {
      log(`ntfy attempt ${i} failed: ${err.message} ${err.cause?.code ?? ''}`);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
}
async function gotoWithRetry(page, url, attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return;
    } catch (err) {
      log(`goto attempt ${i}/${attempts} failed: ${err.message.split('\n')[0]}`);
      if (i === attempts) throw err;
      await new Promise(r => setTimeout(r, 60000)); // wait 1 min between tries
    }
  }
}


async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('requestfailed', r => log(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.url().startsWith('https://portal.opark.com.au')) log(`response: ${r.status()} ${r.url()}`); });

  try {
    log('Starting run');

    log('Navigating to portal.opark.com.au');
    await gotoWithRetry(page, 'https://portal.opark.com.au');
    log('Portal loaded successfully');

    // --- Login (two-step: username -> Continue -> password) ---
    log('Entering username');
    await page.getByRole('textbox', { name: 'Username' }).click();
    await page.getByRole('textbox', { name: 'Username' }).fill(USERNAME);
    log('Clicking Continue button');
    await page.getByRole('button', { name: 'Continue' }).click();

    log('Entering password');
    await page.getByRole('textbox', { name: 'Password' }).click();
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    log('Clicking Login button');
    await page.getByRole('button', { name: 'Login' }).click();

    // Wait for dashboard to load and vehicle dropdown to be populated
    log('Waiting for dashboard to load');
    await page.waitForURL('**/dashboard**', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('text=Select Vehicle', { timeout: 15000 });
    // Wait for the dropdown options to actually be populated via API
    await page.waitForTimeout(3000);

    // --- Start parking session ---
    log(`Selecting vehicle: ${VEHICLE}`);
    await page.getByText('Select Vehicle').click();
    await page.waitForSelector('[role="option"]', { timeout: 10000 });
    const vehicleOptions = await page.getByRole('option').allTextContents();
    log(`Vehicle options: ${vehicleOptions.join(', ')}`);
    await page.getByRole('option', { name: VEHICLE }).click();

    log(`Selecting location: ${LOCATION}`);
    await page.getByText('Select Location').click();
    const locationOptions = await page.getByRole('option').allTextContents();
    log(`Location options: ${locationOptions.join(', ')}`);
    await page.getByText(LOCATION).click();

    log(`Selecting zone: ${ZONE}`);
    await page.getByText('Select Zone').click();
    const zoneOptions = await page.getByRole('option').allTextContents();
    log(`Zone options: ${zoneOptions.join(', ')}`);
    await page.getByText(ZONE).click();

    log('Clicking Start Parking button');
    await page.getByRole('button', { name: 'Start Parking' }).click();
    log('Confirming parking');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.getByRole('button', { name: 'Confirm Parking' }).click();

    // Confirm it actually started before declaring success.
    log('Waiting for parking session to start (looking for PRESS TO STOP button)');
    await page.waitForSelector('text=PRESS TO STOP', { timeout: 15000 });

    log('Session started successfully');
    await ntfy(`Opark auto-renew SUCCESS: Parking session started successfully. Zone: ${ZONE}`);
  } catch (err) {
    log(`FAILED: ${err.message}`);
    try {
      await page.screenshot({ path: SCREENSHOT_ON_FAIL, fullPage: true });
      log(`Saved failure screenshot to ${SCREENSHOT_ON_FAIL}`);
    } catch (_) {}

    await ntfy(`Opark auto-renew FAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
