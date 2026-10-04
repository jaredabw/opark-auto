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

    const imageInput = page.locator(
      'input[type="file"][accept*="image/jpeg"]'
    ).first();

    await imageInput.waitFor({
      state: 'attached',
      timeout: 15000
    });

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

    await page.waitForTimeout(2000);

    /*
     * Find the uploaded image.
     */
    const uploadedImageInfo = await page.locator(
      'img.Jmlpdc'
    ).first().evaluate(img => {
      const result = [];

      let el = img;

      for (let i = 0; i < 8 && el; i++, el = el.parentElement) {
        const rect = el.getBoundingClientRect();

        result.push({
          level: i,
          tag: el.tagName,
          id: el.id || null,
          className:
            typeof el.className === 'string'
              ? el.className
              : null,
          width: rect.width,
          height: rect.height,
          text: (el.innerText || '').trim().slice(0, 300),
          outerHTML: el.outerHTML.slice(0, 3000)
        });
      }

      return result;
    });

    console.log(
      '[translate] UPLOADED IMAGE PARENTS:',
      JSON.stringify(uploadedImageInfo, null, 2)
    );

    /*
     * Inspect every reasonably large element around the result.
     *
     * We are specifically looking for something approximately
     * the same size as the uploaded image, or something containing
     * canvas/background-image/content.
     */
    const largeElements = await page.evaluate(() => {
      const result = [];

      for (const el of document.querySelectorAll('*')) {
        const rect = el.getBoundingClientRect();

        if (rect.width < 100 || rect.height < 40) {
          continue;
        }

        const style = getComputedStyle(el);

        const hasBackground =
          style.backgroundImage &&
          style.backgroundImage !== 'none';

        const hasCanvas =
          el.querySelector('canvas') !== null;

        const hasImage =
          el.querySelector('img') !== null;

        if (!hasBackground && !hasCanvas && !hasImage) {
          continue;
        }

        result.push({
          tag: el.tagName,
          id: el.id || null,
          className:
            typeof el.className === 'string'
              ? el.className
              : null,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          backgroundImage:
            hasBackground
              ? style.backgroundImage.slice(0, 1000)
              : null,
          canvasCount:
            el.querySelectorAll('canvas').length,
          imageCount:
            el.querySelectorAll('img').length,
          text:
            (el.innerText || '').trim().slice(0, 200)
        });
      }

      return result;
    });

    console.log(
      '[translate] LARGE RESULT ELEMENTS:',
      JSON.stringify(largeElements, null, 2)
    );

    /*
     * Also inspect all canvases directly.
     */
    const canvases = await page.evaluate(() => {
      return [...document.querySelectorAll('canvas')].map(
        (canvas, index) => {
          const rect = canvas.getBoundingClientRect();

          return {
            index,
            width: canvas.width,
            height: canvas.height,
            displayWidth: rect.width,
            displayHeight: rect.height,
            x: rect.x,
            y: rect.y,
            className:
              typeof canvas.className === 'string'
                ? canvas.className
                : null,
            outerHTML:
              canvas.outerHTML.slice(0, 1000)
          };
        }
      );
    });

    console.log(
      '[translate] CANVASES:',
      JSON.stringify(canvases, null, 2)
    );

    /*
     * Save the whole translated page screenshot as a diagnostic.
     */
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true
    });

    console.log(
      '[translate] RESULT PAGE SCREENSHOT:',
      screenshot.length,
      'bytes'
    );

    /*
     * For now return the page screenshot.
     *
     * This is intentionally temporary. The next log output will
     * tell us exactly which element contains the translated image.
     */
    return {
      buffer: screenshot,
      filename: 'translated-page.png'
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