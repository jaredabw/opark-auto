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

    await page.getByText('Image translation results available').waitFor({
    state: 'visible',
    timeout: 30000
    });

    console.log('[translate] Translation result is available');

    const showOriginal = page.getByRole(
    'button',
    { name: 'Show original' }
    );

    const downloadTranslation = async (label) => {
    const downloadButton = page.getByRole(
        'button',
        { name: 'Download translation' }
    );

    await downloadButton.waitFor({
        state: 'visible',
        timeout: 10000
    });

    const downloadPromise = page.waitForEvent('download', {
        timeout: 15000
    });

    await downloadButton.click();

    const download = await downloadPromise;
    const filename = download.suggestedFilename();

    const stream = await download.createReadStream();

    if (!stream) {
        throw new Error(`No download stream for ${label}`);
    }

    const chunks = [];

    for await (const chunk of stream) {
        chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);

    console.log(
        `[translate] ${label}: ${filename}, ${buffer.length} bytes`
    );

    return {
        buffer,
        filename
    };
    };


    // We should currently be showing the translation.
    console.log(
    '[translate] Show original state:',
    await showOriginal.getAttribute('aria-checked')
    );

    const translatedDownload = await downloadTranslation(
    'TRANSLATED VIEW'
    );


    // Now switch to original.
    await showOriginal.click();

    await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
        .find(b => b.getAttribute('aria-label') === 'Show original');

    return button &&
        button.getAttribute('aria-checked') === 'true';
    });

    console.log('[translate] Switched to original view');

    const originalDownload = await downloadTranslation(
    'ORIGINAL VIEW'
    );


    // Put it back into translated view.
    await showOriginal.click();

    await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
        .find(b => b.getAttribute('aria-label') === 'Show original');

    return button &&
        button.getAttribute('aria-checked') === 'false';
    });

    console.log('[translate] Switched back to translated view');

    console.log(
    '[translate] Download sizes:',
    {
        translated: translatedDownload.buffer.length,
        original: originalDownload.buffer.length
    }
    );

    const same =
    translatedDownload.buffer.equals(originalDownload.buffer);

    console.log(
    '[translate] Downloads byte-identical:',
    same
    );

    if (same) {
    throw new Error(
        'Google returned identical files for translated and original views'
    );
    }

    return translatedDownload;
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