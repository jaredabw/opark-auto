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
  // Pick a private, hard-to-guess topic name here.
  const NTFY_TOPIC = process.env.OPARK_NTFY_TOPIC;
  if (!NTFY_TOPIC) return;
  try {
    await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST',
      body: message,
    });
  } catch (_) {
    // Don't let a failed alert mask the original error in logs.
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    log('Starting run');

    log('Navigating to portal.opark.com.au');
    await page.goto('https://portal.opark.com.au');
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

    // --- Start parking session ---
    log(`Selecting vehicle: ${VEHICLE}`);
    await page.getByText('Select Vehicle').click();
    await page.getByRole('option', { name: VEHICLE }).click();

    log(`Selecting location: ${LOCATION}`);
    await page.getByText('Select Location').click();
    await page.getByText(LOCATION).click();

    log(`Selecting zone: ${ZONE}`);
    await page.getByText('Select Zone').click();
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
