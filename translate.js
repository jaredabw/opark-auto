const { chromium } = require('playwright');

const GOOGLE_URL =
  'https://translate.google.com/?sl=auto&tl=en&op=images&hl=en';

let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) {
    return browser;
  }

  browser = await chromium.launch({
    headless: true
  });

  return browser;
}

async function translateImage(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new Error('No image data received');
  }

  const browser = await getBrowser();

  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 1000
    },

    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/140.0.0.0 Safari/537.36',

    locale: 'en-US'
  });

  const page = await context.newPage();

  try {
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    console.log('[translate] Opening Google Translate...');

    await page.goto(GOOGLE_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('[translate] Page loaded');

    // Find the image-upload input.
    const imageInput = page.locator(
      'input[type="file"][accept*="image/jpeg"]'
    ).first();

    await imageInput.waitFor({
      state: 'attached',
      timeout: 15000
    });

    console.log('[translate] Image input found');

    // This is a genuine Playwright file upload.
    await imageInput.setInputFiles({
      name: 'screenshot.jpg',
      mimeType: 'image/jpeg',
      buffer: imageBuffer
    });

    console.log('[translate] Image uploaded');

    // Give Google a chance to process the upload.
    //
    // We don't assume a particular final URL because Google
    // can rewrite the Translate URL.
    await page.waitForTimeout(3000);

    console.log(
      '[translate] URL after upload:',
      page.url()
    );

    // Wait for the image-translation UI to change.
    //
    // We're deliberately not depending on a very specific
    // Google class name here because those are frequently
    // generated/changed.
    await page.waitForFunction(() => {
      const text = document.body
        ? document.body.innerText || ''
        : '';

      return (
        text.includes('Translated') ||
        text.includes('Original') ||
        document.querySelectorAll('img').length > 6
      );
    }, {
      timeout: 15000
    }).catch(() => {
      // Don't fail solely because Google's UI text changed.
      console.log(
        '[translate] Result detection timed out; taking page screenshot anyway'
      );
    });

    console.log('[translate] Taking result screenshot');

    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true
    });

    return screenshot;

  } finally {
    await context.close();
  }
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

module.exports = {
  translateImage,
  closeBrowser
};