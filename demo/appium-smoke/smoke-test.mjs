import {
  APP_BUNDLE_ID,
  APP_NAME,
  ARTIFACT_DIR,
  createSession,
  deleteSession,
  getSource,
  getWindowRect,
  saveScreenshot,
} from './lib/appium-ios-helpers.mjs';

const SCREENSHOT_BASENAME = `${APP_BUNDLE_ID.replace(/[^a-zA-Z0-9._-]+/g, '_')}-home.png`;

async function main() {
  const sessionId = await createSession();

  try {
    const windowRect = await getWindowRect(sessionId);
    const source = await getSource(sessionId);
    const screenshotPath = await saveScreenshot(sessionId, SCREENSHOT_BASENAME);

    console.log(`Session created: ${sessionId}`);
    console.log(`Window rect: ${JSON.stringify(windowRect)}`);
    console.log(`Source size: ${source.length} characters`);
    console.log(`Target app: ${APP_NAME} (${APP_BUNDLE_ID})`);
    console.log(`Screenshot saved to: ${screenshotPath}`);
    console.log('Smoke test passed.');
  } finally {
    await deleteSession(sessionId);
  }
}

await main();
