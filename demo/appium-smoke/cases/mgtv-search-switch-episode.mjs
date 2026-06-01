import {
  APP_BUNDLE_ID,
  APP_NAME,
  createSession,
  deleteSession,
  dismissCommonPopups,
  getWindowRect,
  openVodDetailFromResults,
  relaunchToHome,
  saveScreenshot,
  saveSource,
  searchKeyword,
  switchEpisode,
} from '../lib/appium-ios-helpers.mjs';

const KEYWORD = process.env.KEYWORD ?? '我的人间烟火';
const TARGET_EPISODE = Number(process.env.TARGET_EPISODE ?? '2');

async function main() {
  const sessionId = await createSession();

  try {
    const windowRect = await getWindowRect(sessionId);
    console.log(`Session created: ${sessionId}`);
    console.log(`Window rect: ${JSON.stringify(windowRect)}`);
    console.log(`Target app: ${APP_NAME} (${APP_BUNDLE_ID})`);
    console.log(`Keyword: ${KEYWORD}`);
    console.log(`Target episode: ${TARGET_EPISODE}`);

    await relaunchToHome(sessionId);
    console.log('Returned to the home page.');
    await saveScreenshot(sessionId, 'mgtv-home.png');
    await saveSource(sessionId, 'mgtv-home.xml');

    const dismissedPopup = await dismissCommonPopups(sessionId);
    if (dismissedPopup) {
      console.log(`Dismissed popup: ${dismissedPopup}`);
      await saveScreenshot(sessionId, 'mgtv-popup-dismissed.png');
    } else {
      console.log('No blocking popup detected on the home page.');
    }

    const resultSource = await searchKeyword(sessionId, KEYWORD);
    await saveScreenshot(sessionId, 'mgtv-search-results.png');
    await saveSource(sessionId, 'mgtv-search-results.xml');
    if (!resultSource.includes('播放')) {
      throw new Error('The search result page is missing the expected play entry.');
    }
    console.log('Search results loaded successfully.');

    const detailSource = await openVodDetailFromResults(sessionId, KEYWORD);
    if (!detailSource.includes('选集')) {
      throw new Error('The VOD detail page is missing the episode section.');
    }
    console.log('Entered the VOD detail page.');
    await saveScreenshot(sessionId, 'mgtv-vod-detail.png');
    await saveSource(sessionId, 'mgtv-vod-detail.xml');

    const switchedSource = await switchEpisode(sessionId, TARGET_EPISODE);
    if (!switchedSource.includes(`第${TARGET_EPISODE}集`)) {
      throw new Error(`Episode ${TARGET_EPISODE} was not selected.`);
    }
    console.log(`Switched to episode ${TARGET_EPISODE}.`);
    await saveScreenshot(sessionId, `mgtv-episode-${TARGET_EPISODE}.png`);
    await saveSource(sessionId, `mgtv-episode-${TARGET_EPISODE}.xml`);

    console.log('MGTV search-and-switch-episode case passed.');
  } finally {
    await deleteSession(sessionId);
  }
}

await main();
