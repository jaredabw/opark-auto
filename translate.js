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

    /*
     * Google displays this text once the image translation
     * has actually been produced.
     */
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

    /*
     * Give Google's result UI a moment to finish rendering.
     */
    await page.waitForTimeout(2000);

    /*
     * Diagnostic: inspect the result controls.
     */
    const resultInfo = await page.evaluate(() => {
      const elements = [...document.querySelectorAll('*')];

      return elements
        .filter(el => {
          const text = (el.innerText || '').trim();

          return (
            text === 'Show original' ||
            text === 'Download translation' ||
            text === 'Copy text' ||
            text === 'Image translation results available'
          );
        })
        .map(el => ({
          tag: el.tagName,
          text: (el.innerText || '').trim(),
          ariaLabel: el.getAttribute('aria-label'),
          role: el.getAttribute('role'),
          jsname: el.getAttribute('jsname'),
          className:
            typeof el.className === 'string'
              ? el.className
              : null,
          outerHTML: el.outerHTML.slice(0, 1500)
        }));
    });

    console.log(
      '[translate] RESULT CONTROLS:',
      JSON.stringify(resultInfo, null, 2)
    );

    /*
     * Diagnostic: inspect visible images/canvases/SVGs.
     */
    const visualElements = await page.evaluate(() => {
      const result = [];

      for (const el of document.querySelectorAll(
        'img, canvas, svg, [style*="background-image"]'
      )) {
        const rect = el.getBoundingClientRect();

        if (rect.width < 20 || rect.height < 20) {
          continue;
        }

        result.push({
          tag: el.tagName,
          width: rect.width,
          height: rect.height,
          naturalWidth: el.naturalWidth || null,
          naturalHeight: el.naturalHeight || null,
          src: el.src || null,
          className:
            typeof el.className === 'string'
              ? el.className
              : null,
          outerHTML: el.outerHTML.slice(0, 1000)
        });
      }

      return result;
    });

    console.log(
      '[translate] VISUAL ELEMENTS:',
      JSON.stringify(visualElements, null, 2)
    );

    /*
     * Find Google's actual Download translation button.
     *
     * getByRole avoids accidentally selecting the hidden
     * tooltip that also contains the words "Download translation".
     */
    const downloadButton = page.getByRole(
      'button',
      { name: 'Download translation' }
    );

    await downloadButton.waitFor({
      state: 'visible',
      timeout: 10000
    });

    console.log(
      '[translate] Download translation button found'
    );

    /*
     * Ask Google to download the translated image.
     */
    const downloadPromise = page.waitForEvent('download', {
      timeout: 15000
    });

    await downloadButton.click();

    const download = await downloadPromise;

    const filename = download.suggestedFilename();

    console.log(
      '[translate] Download started:',
      filename
    );

    const stream = await download.createReadStream();

    if (!stream) {
      throw new Error(
        'Google download stream was not available'
      );
    }

    const chunks = [];

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);

    console.log(
      '[translate] Downloaded translated image:',
      buffer.length,
      'bytes'
    );

    /*
     * Take a screenshot as well. This isn't returned; it's just
     * useful if we need to debug what Google showed.
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