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

    const imageInput = page.locator(
      'input[type="file"][accept*="image/jpeg"]'
    ).first();

    await imageInput.waitFor({
      state: 'attached',
      timeout: 15000
    });

    console.log('[translate] Image input found');

    await imageInput.setInputFiles({
      name: 'screenshot.jpg',
      mimeType: 'image/jpeg',
      buffer: imageBuffer
    });

    console.log('[translate] Image uploaded');

    await page.getByText(
      'Image translation results available',
      { exact: true }
    ).waitFor({
      state: 'visible',
      timeout: 30000
    });

    console.log(
      '[translate] Translation result is available'
    );

    // Give Google's result rendering a little time to finish.
    await page.waitForTimeout(2000);

    /*
     * Google renders part of the translated result as a blob-backed
     * <img>. We want that image directly instead of using Google's
     * "Download translation" button, which is currently returning
     * the original uploaded image in Playwright.
     */

    const blobImages = await page.locator(
      'img[src^="blob:"]'
    ).evaluateAll(images =>
      images.map((img, index) => {
        const rect = img.getBoundingClientRect();

        return {
          index,
          src: img.src,
          width: rect.width,
          height: rect.height,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          className:
            typeof img.className === 'string'
              ? img.className
              : null
        };
      })
    );

    console.log(
      '[translate] Blob images:',
      JSON.stringify(blobImages, null, 2)
    );

    if (blobImages.length === 0) {
      throw new Error(
        'No blob-backed result image found'
      );
    }

    /*
     * Prefer a visible blob image with the largest area.
     * This avoids accidentally selecting tiny UI images.
     */
    const candidates = blobImages
      .filter(img =>
        img.width > 50 &&
        img.height > 50 &&
        img.naturalWidth > 50 &&
        img.naturalHeight > 50
      )
      .sort(
        (a, b) =>
          (b.width * b.height) -
          (a.width * a.height)
      );

    if (candidates.length === 0) {
      throw new Error(
        'Blob images were found, but none looked like a result image'
      );
    }

    const target = candidates[0];

    console.log(
      '[translate] Using blob image:',
      JSON.stringify(target)
    );

    /*
     * Fetch the blob from inside the Google Translate page.
     * This is important because the blob URL belongs to the page's
     * browser context.
     */
    const imageData = await page.evaluate(async (src) => {
      const response = await fetch(src);

      if (!response.ok) {
        throw new Error(
          `Blob fetch failed: HTTP ${response.status}`
        );
      }

      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();

      return {
        type: blob.type,
        bytes: Array.from(new Uint8Array(arrayBuffer))
      };
    }, target.src);

    const buffer = Buffer.from(imageData.bytes);

    console.log(
      '[translate] Extracted blob image:',
      buffer.length,
      'bytes',
      'type:',
      imageData.type
    );

    if (buffer.length === 0) {
      throw new Error(
        'Extracted blob image was empty'
      );
    }

    /*
     * Save a diagnostic screenshot of the Google result page.
     * This is only logged for debugging and is not returned.
     */
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true
    });

    console.log(
      '[translate] Result page screenshot:',
      screenshot.length,
      'bytes'
    );

    let filename = 'translated.png';

    if (imageData.type === 'image/jpeg') {
      filename = 'translated.jpg';
    } else if (imageData.type === 'image/webp') {
      filename = 'translated.webp';
    }

    return {
      buffer,
      filename
    };

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