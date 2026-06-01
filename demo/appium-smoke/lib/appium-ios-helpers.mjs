import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

export const APPIUM_BASE_URL = process.env.APPIUM_BASE_URL ?? 'http://127.0.0.1:4723';
export const WDA_BASE_URL = process.env.WDA_BASE_URL ?? 'http://127.0.0.1:8100';
export const APPIUM_REQUEST_TIMEOUT_MS = Number(process.env.APPIUM_REQUEST_TIMEOUT_MS ?? '12000');
export const APPIUM_SESSION_REQUEST_TIMEOUT_MS = Number(process.env.APPIUM_SESSION_REQUEST_TIMEOUT_MS ?? '180000');
export const TARGET = process.env.TARGET ?? 'simulator';
export const SIM_NAME = process.env.SIM_NAME ?? 'iPhone 17';
export const SIM_UDID = process.env.SIM_UDID ?? '';
export const SIM_OS = process.env.SIM_OS ?? '';
export const DEVICE_NAME = process.env.DEVICE_NAME ?? SIM_NAME;
export const DEVICE_UDID = process.env.DEVICE_UDID ?? SIM_UDID;
export const DEVICE_OS = process.env.DEVICE_OS ?? SIM_OS;
export const APP_BUNDLE_ID = process.env.APP_BUNDLE_ID ?? 'com.hunantv.imgotv';
export const APP_BUNDLE_ID_CANDIDATES = uniqueValues([
  APP_BUNDLE_ID,
  ...(process.env.APP_BUNDLE_ID_FALLBACKS ?? '').split(',').map((item) => item.trim()),
  'com.hunantv.imgotv',
  'com.hunantv.imgotv.international',
]);
export const APP_NAME = process.env.APP_NAME ?? '芒果TV';
export const XCODE_ORG_ID = process.env.XCODE_ORG_ID ?? '';
export const XCODE_SIGNING_ID = process.env.XCODE_SIGNING_ID ?? 'Apple Development';
export const UPDATED_WDA_BUNDLE_ID = process.env.UPDATED_WDA_BUNDLE_ID ?? '';
export const WDA_LOCAL_PORT = Number(process.env.WDA_LOCAL_PORT ?? '8100');
export const WDA_DERIVED_DATA_PATH = process.env.WDA_DERIVED_DATA_PATH ?? '';
export const WDA_AGENT_PATH = process.env.WDA_AGENT_PATH ?? '';
export const PREBUILT_WDA_PATH = process.env.PREBUILT_WDA_PATH ?? '';
export const ALLOW_PROVISIONING_DEVICE_REGISTRATION =
  /^(1|true|yes)$/i.test(process.env.ALLOW_PROVISIONING_DEVICE_REGISTRATION ?? '');
export const USE_PREINSTALLED_WDA = /^(1|true|yes)$/i.test(process.env.USE_PREINSTALLED_WDA ?? '');
export const USE_NEW_WDA = /^(1|true|yes)$/i.test(process.env.USE_NEW_WDA ?? '');
export const ARTIFACT_DIR = path.resolve(process.env.ARTIFACT_DIR ?? './artifacts');
let activeAppBundleId = APP_BUNDLE_ID;

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function joinUrl(baseUrl, pathname) {
  return new URL(pathname, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureArtifactDir() {
  await mkdir(ARTIFACT_DIR, {recursive: true});
}

export async function request(pathname, {method = 'GET', body} = {}) {
  const timeoutMs =
    pathname === '/session' ? APPIUM_SESSION_REQUEST_TIMEOUT_MS : Number(arguments[1]?.timeoutMs ?? APPIUM_REQUEST_TIMEOUT_MS);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(joinUrl(APPIUM_BASE_URL, pathname), {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${method} ${pathname} failed: ${JSON.stringify(payload)}`);
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${method} ${pathname} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function requestWithRetry(pathname, options = {}, retryOptions = {}) {
  const retries = retryOptions.retries ?? 3;
  const delayMs = retryOptions.delayMs ?? 1500;
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await request(pathname, options);
    } catch (error) {
      lastError = error;
      const message = String(error?.message ?? error);
      const retryable =
        message.includes('socket hang up') ||
        message.includes('Could not proxy command to the remote server') ||
        message.includes('Empty reply from server') ||
        message.includes('timed out after') ||
        message.includes('fetch failed') ||
        message.includes('ECONNRESET') ||
        message.includes('ECONNREFUSED');
      if (!retryable || attempt === retries) {
        throw error;
      }
      console.warn(
        `Retrying ${options.method ?? 'GET'} ${pathname} after transient WDA error (${attempt}/${retries}): ${message}`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

export function buildCapabilities(bundleId = APP_BUNDLE_ID) {
  const capabilities = {
    alwaysMatch: {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:deviceName': DEVICE_NAME,
      'appium:bundleId': bundleId,
      'appium:noReset': true,
      'appium:newCommandTimeout': 120,
    },
    firstMatch: [{}],
  };

  if (DEVICE_UDID) {
    capabilities.alwaysMatch['appium:udid'] = DEVICE_UDID;
  }
  if (DEVICE_OS) {
    capabilities.alwaysMatch['appium:platformVersion'] = DEVICE_OS;
  }

  if (TARGET === 'real-device') {
    capabilities.alwaysMatch['appium:wdaLocalPort'] = WDA_LOCAL_PORT;
    capabilities.alwaysMatch['appium:showXcodeLog'] = true;
    capabilities.alwaysMatch['appium:wdaLaunchTimeout'] = 120000;
    capabilities.alwaysMatch['appium:wdaStartupRetries'] = 2;
    capabilities.alwaysMatch['appium:wdaStartupRetryInterval'] = 20000;
    capabilities.alwaysMatch['appium:useNewWDA'] = USE_NEW_WDA;
    if (USE_PREINSTALLED_WDA) {
      capabilities.alwaysMatch['appium:usePreinstalledWDA'] = true;
      if (PREBUILT_WDA_PATH) {
        capabilities.alwaysMatch['appium:prebuiltWDAPath'] = PREBUILT_WDA_PATH;
      }
    }
    if (XCODE_ORG_ID) {
      capabilities.alwaysMatch['appium:xcodeOrgId'] = XCODE_ORG_ID;
    }
    if (XCODE_SIGNING_ID) {
      capabilities.alwaysMatch['appium:xcodeSigningId'] = XCODE_SIGNING_ID;
    }
    if (UPDATED_WDA_BUNDLE_ID) {
      capabilities.alwaysMatch['appium:updatedWDABundleId'] = UPDATED_WDA_BUNDLE_ID;
    }
    if (WDA_DERIVED_DATA_PATH) {
      capabilities.alwaysMatch['appium:derivedDataPath'] = WDA_DERIVED_DATA_PATH;
    }
    if (WDA_AGENT_PATH) {
      capabilities.alwaysMatch['appium:agentPath'] = WDA_AGENT_PATH;
    }
    if (ALLOW_PROVISIONING_DEVICE_REGISTRATION) {
      capabilities.alwaysMatch['appium:allowProvisioningDeviceRegistration'] = true;
    }
  } else {
    capabilities.alwaysMatch['appium:webDriverAgentUrl'] = WDA_BASE_URL;
  }

  return capabilities;
}

export async function createSession() {
  await ensureArtifactDir();

  console.log(
    `Creating Appium session for ${APP_NAME} (${APP_BUNDLE_ID}) on ${DEVICE_NAME}${DEVICE_OS ? ` (${DEVICE_OS})` : ''} [${TARGET}]...`
  );

  let sessionResponse;
  let selectedBundleId = APP_BUNDLE_ID;
  let lastError;
  for (const bundleId of APP_BUNDLE_ID_CANDIDATES) {
    try {
      sessionResponse = await request('/session', {
        method: 'POST',
        body: {
          capabilities: buildCapabilities(bundleId),
        },
      });
      selectedBundleId = bundleId;
      break;
    } catch (error) {
      lastError = error;
      if (!String(error?.message ?? error).includes('bundle identifier')) {
        throw error;
      }
      console.warn(`App bundle ${bundleId} is not available on this device, trying next candidate...`);
    }
  }

  if (!sessionResponse) {
    throw lastError;
  }

  const sessionId =
    sessionResponse.sessionId ??
    sessionResponse.value?.sessionId ??
    sessionResponse.value?.capabilities?.sessionId;

  if (!sessionId) {
    throw new Error(`Could not determine session id: ${JSON.stringify(sessionResponse)}`);
  }

  activeAppBundleId = selectedBundleId;
  return sessionId;
}

export async function deleteSession(sessionId) {
  try {
    await request(`/session/${sessionId}`, {method: 'DELETE'});
  } catch (err) {
    console.warn(`Failed to delete session ${sessionId}: ${err.message}`);
  }
}

export async function getWindowRect(sessionId) {
  return (await requestWithRetry(`/session/${sessionId}/window/rect`)).value;
}

export async function getSource(sessionId) {
  return (await requestWithRetry(`/session/${sessionId}/source`)).value;
}

export async function getScreenshotBase64(sessionId) {
  return (await requestWithRetry(`/session/${sessionId}/screenshot`)).value;
}

export async function saveSource(sessionId, filename) {
  const source = await getSource(sessionId);
  const outputPath = path.join(ARTIFACT_DIR, filename);
  await writeFile(outputPath, source, 'utf8');
  return {outputPath, source};
}

export async function saveScreenshot(sessionId, filename) {
  const base64 = await getScreenshotBase64(sessionId);
  const outputPath = path.join(ARTIFACT_DIR, filename);
  await writeFile(outputPath, Buffer.from(base64, 'base64'));
  return outputPath;
}

export async function findElement(sessionId, using, value) {
  const response = await request(`/session/${sessionId}/element`, {
    method: 'POST',
    body: {using, value},
  });
  return response.value.ELEMENT ?? response.value['element-6066-11e4-a52e-4f735466cecf'];
}

export async function findElements(sessionId, using, value) {
  const response = await request(`/session/${sessionId}/elements`, {
    method: 'POST',
    body: {using, value},
  });
  return (response.value ?? [])
    .map((item) => item.ELEMENT ?? item['element-6066-11e4-a52e-4f735466cecf'])
    .filter(Boolean);
}

export async function findOptionalElement(sessionId, using, value) {
  try {
    return await findElement(sessionId, using, value);
  } catch {
    return null;
  }
}

export async function getElementRect(sessionId, elementId) {
  return (await request(`/session/${sessionId}/element/${elementId}/rect`)).value;
}

export async function clickElement(sessionId, elementId) {
  await request(`/session/${sessionId}/element/${elementId}/click`, {
    method: 'POST',
    body: {},
  });
}

export async function clearElement(sessionId, elementId) {
  await request(`/session/${sessionId}/element/${elementId}/clear`, {
    method: 'POST',
    body: {},
  });
}

export async function clickAccessibilityId(sessionId, value) {
  const elementId = await findElement(sessionId, 'accessibility id', value);
  await clickElement(sessionId, elementId);
  return elementId;
}

export async function tap(sessionId, x, y) {
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
    throw new Error(`Invalid tap point: x=${x}, y=${y}`);
  }
  await request(`/session/${sessionId}/actions`, {
    method: 'POST',
    body: {
      actions: [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: {pointerType: 'touch'},
          actions: [
            {type: 'pointerMove', duration: 0, x, y},
            {type: 'pointerDown', button: 0},
            {type: 'pause', duration: 120},
            {type: 'pointerUp', button: 0},
          ],
        },
      ],
    },
  });
}

export function pointFromPercent(rect, xPercent, yPercent) {
  const width = Number(rect?.width);
  const height = Number(rect?.height);
  const x = Number(rect?.x ?? 0);
  const y = Number(rect?.y ?? 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid window rect: ${JSON.stringify(rect)}`);
  }
  return {
    x: Math.round(width * Number(xPercent) + x),
    y: Math.round(height * Number(yPercent) + y),
  };
}

export async function doubleTap(sessionId, x, y, options = {}) {
  const tapDurationMs = Number(options.tapDurationMs ?? 70);
  const gapMs = Number(options.gapMs ?? 90);
  await request(`/session/${sessionId}/actions`, {
    method: 'POST',
    body: {
      actions: [
        {
          type: 'pointer',
          id: `double-tap-${Date.now()}`,
          parameters: {pointerType: 'touch'},
          actions: [
            {type: 'pointerMove', duration: 0, x, y},
            {type: 'pointerDown', button: 0},
            {type: 'pause', duration: tapDurationMs},
            {type: 'pointerUp', button: 0},
            {type: 'pause', duration: gapMs},
            {type: 'pointerDown', button: 0},
            {type: 'pause', duration: tapDurationMs},
            {type: 'pointerUp', button: 0},
          ],
        },
      ],
    },
  });
}

export async function doubleTapPercent(sessionId, xPercent, yPercent, options = {}) {
  const rect = await getWindowRect(sessionId);
  const point = pointFromPercent(rect, xPercent, yPercent);
  await doubleTap(sessionId, point.x, point.y, options);
}

export async function longPressPercent(sessionId, xPercent, yPercent, options = {}) {
  const rect = await getWindowRect(sessionId);
  const point = pointFromPercent(rect, xPercent, yPercent);
  await request(`/session/${sessionId}/actions`, {
    method: 'POST',
    body: {
      actions: [
        {
          type: 'pointer',
          id: `long-press-${Date.now()}`,
          parameters: {pointerType: 'touch'},
          actions: [
            {type: 'pointerMove', duration: 0, x: point.x, y: point.y},
            {type: 'pointerDown', button: 0},
            {type: 'pause', duration: Number(options.durationMs ?? 800)},
            {type: 'pointerUp', button: 0},
          ],
        },
      ],
    },
  });
}

export async function dragPercent(sessionId, from, to, options = {}) {
  const rect = await getWindowRect(sessionId);
  const start = pointFromPercent(rect, from?.x ?? 0.25, from?.y ?? 0.84);
  const end = pointFromPercent(rect, to?.x ?? 0.75, to?.y ?? 0.84);
  await request(`/session/${sessionId}/actions`, {
    method: 'POST',
    body: {
      actions: [
        {
          type: 'pointer',
          id: `drag-${Date.now()}`,
          parameters: {pointerType: 'touch'},
          actions: [
            {type: 'pointerMove', duration: 0, x: start.x, y: start.y},
            {type: 'pointerDown', button: 0},
            {type: 'pause', duration: Number(options.holdMs ?? 180)},
            {
              type: 'pointerMove',
              duration: Number(options.durationMs ?? 650),
              x: end.x,
              y: end.y,
            },
            {type: 'pointerUp', button: 0},
          ],
        },
      ],
    },
  });
}

export async function typeValue(sessionId, elementId, text) {
  await request(`/session/${sessionId}/element/${elementId}/value`, {
    method: 'POST',
    body: {
      text,
      value: [...text],
    },
  });
}

export function getActiveAppBundleId() {
  return activeAppBundleId;
}

export async function terminateApp(sessionId, bundleId = activeAppBundleId) {
  await request(`/session/${sessionId}/appium/device/terminate_app`, {
    method: 'POST',
    body: {bundleId},
  });
}

export async function activateApp(sessionId, bundleId = activeAppBundleId) {
  await request(`/session/${sessionId}/appium/device/activate_app`, {
    method: 'POST',
    body: {bundleId},
  });
}

export async function backgroundApp(sessionId, seconds = 3) {
  await request(`/session/${sessionId}/appium/app/background`, {
    method: 'POST',
    body: {seconds},
  });
}

export async function setOrientation(sessionId, orientation = 'PORTRAIT') {
  await request(`/session/${sessionId}/orientation`, {
    method: 'POST',
    body: {orientation},
  });
}

export async function waitForCondition(checker, {timeoutMs = 15000, intervalMs = 800} = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await checker();
    if (result) {
      return result;
    }
    await sleep(intervalMs);
  }
  return null;
}

export async function waitForText(sessionId, text, options = {}) {
  return waitForCondition(async () => {
    const source = await getSource(sessionId);
    return source.includes(text) ? source : null;
  }, options);
}

const CLOSE_BUTTON_LABELS = ['X', 'x', '×', '✕', '✖', '关闭', '关闭按钮', 'Close', 'close'];
const BACK_BUTTON_LABELS = ['返回', '返回按钮', 'Back', 'back', 'nav back', 'backButton', '返回上一页'];

function isHomeSource(source) {
  return (
    ['找片', '首页测试', '刷片'].some((text) => source.includes(text)) ||
    (source.includes('标签页栏') &&
      source.includes('首页') &&
      (source.includes('searchBar_icon_v25') || source.includes('searchBar_icon') || source.includes('好片')))
  );
}

function isSearchSource(source) {
  return ['搜索', '热搜榜', '猜你想搜这些', 'NewSearchView', 'search_textField', '相关影视作品'].some((text) =>
    source.includes(text)
  );
}

function isVodSource(source) {
  return ['选集', '简介', '猜你喜欢', '追剧', '缓存', '评论', '分享', '更多'].some((text) => source.includes(text));
}

function isVodReadySource(source, keyword = '') {
  return isVodSource(source) && source.includes('选集') && (!keyword || source.includes(keyword));
}

function classifySource(source) {
  if (!source) {
    return 'unknown';
  }
  if (isHomeSource(source)) {
    return 'home';
  }
  if (isSearchSource(source)) {
    return 'search';
  }
  if (isVodSource(source)) {
    return 'vod';
  }
  if (['暂停', '全屏', '倍速', '清晰度', '弹幕', '选集'].some((text) => source.includes(text))) {
    return 'player';
  }
  if (source.includes('XCUIElementTypeWebView')) {
    if (
      ['乘风2026·姐的主场', '活动规则', '立即参与', '限时兑换中', '填写地址', '会员限时特惠'].some((text) =>
        source.includes(text)
      )
    ) {
      return 'activity-webview';
    }
    return 'webview';
  }
  if (['会员限时特惠', '立享更多宝藏内容', '收银台', '连续包月', '确认支付'].some((text) => source.includes(text))) {
    return 'paywall';
  }
  if (['广告', '跳过', '会员免广告', '倒计时'].some((text) => source.includes(text))) {
    return 'ad';
  }
  return 'unknown';
}

export async function dismissCommonPopups(sessionId) {
  const candidateButtons = ['我知道了', '知道了', '同意并继续', '同意', '允许', '暂不', '稍后', '关闭', '跳过'];
  const source = await getSource(sessionId).catch((error) => {
    const message = String(error?.message ?? error);
    if (
      message.includes('Could not proxy command to the remote server') ||
      message.includes('ECONNREFUSED') ||
      message.includes('socket hang up') ||
      message.includes('fetch failed') ||
      message.includes('timed out after')
    ) {
      throw error;
    }
    return '';
  });
  const pageKind = classifySource(source);
  const hasKnownPopupText =
    candidateButtons.some((label) => source.includes(label)) ||
    source.includes('未成年人') ||
    pageKind === 'ad' ||
    pageKind === 'paywall';

  if (!hasKnownPopupText && ['activity-webview', 'webview', 'search', 'vod', 'player'].includes(pageKind)) {
    return null;
  }

  for (const label of candidateButtons) {
    const elementId = await findOptionalElement(sessionId, 'accessibility id', label);
    if (elementId) {
      await clickElement(sessionId, elementId);
      await sleep(1000);
      return label;
    }
  }

  const chromeControl = await clickCloseOrBackControl(sessionId, {
    includeBack: false,
    fallback: false,
  });
  if (chromeControl) {
    return chromeControl;
  }

  if (source.includes('未成年人')) {
    await tap(sessionId, 203, 807);
    await sleep(1000);
    return '未成年人守护模式';
  }

  return null;
}

export async function clickCloseOrBackControl(sessionId, options = {}) {
  const includeClose = options.includeClose !== false;
  const includeBack = options.includeBack !== false;

  if (includeBack && options.preferTopLeft !== false) {
    const source =
      options.source ??
      (await getSource(sessionId).catch((error) => {
        const message = String(error?.message ?? error);
        if (
          message.includes('Could not proxy command to the remote server') ||
          message.includes('ECONNREFUSED') ||
          message.includes('socket hang up') ||
          message.includes('fetch failed') ||
          message.includes('timed out after')
        ) {
          throw error;
        }
        return '';
      }));
    const topLeftPoint = extractTopLeftBackPointFromSource(source);
    if (topLeftPoint) {
      await tap(sessionId, topLeftPoint.x, topLeftPoint.y).catch(() => {});
      await sleep(options.waitMs ?? 900);
      return '返回';
    }
  }

  const candidates = [];
  if (includeClose) {
    candidates.push(...(await findChromeControls(sessionId, CLOSE_BUTTON_LABELS, '关闭/X')));
  }
  if (includeBack) {
    candidates.push(...(await findChromeControls(sessionId, BACK_BUTTON_LABELS, '返回')));
  }

  const ranked = candidates
    .filter((item) => item.rect && item.rect.y <= (options.maxY ?? 180))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const target = ranked[0] ?? candidates[0];
  if (target) {
    await clickElement(sessionId, target.elementId);
    await sleep(options.waitMs ?? 900);
    return target.type;
  }

  if (options.fallback === false) {
    return null;
  }

  if (includeBack) {
    await request(`/session/${sessionId}/back`, {method: 'POST', body: {}}).catch(() => {});
    await sleep(options.waitMs ?? 900);
    return '系统返回';
  }
  return null;
}

async function findChromeControls(sessionId, labels, type) {
  const found = new Map();
  const fuzzyPredicate = chromeControlPredicate(labels);
  const fuzzyElements = await findElements(sessionId, '-ios predicate string', fuzzyPredicate).catch(() => []);
  for (const elementId of fuzzyElements) {
    if (!found.has(elementId)) {
      found.set(elementId, {elementId, type, rect: await getElementRect(sessionId, elementId).catch(() => null)});
    }
  }
  return [...found.values()];
}

async function findTopLeftBackCandidates(sessionId) {
  const candidates = [];
  for (const className of ['XCUIElementTypeButton', 'XCUIElementTypeImage']) {
    const elements = await findElements(sessionId, 'class name', className).catch(() => []);
    for (const elementId of elements) {
      const rect = await getElementRect(sessionId, elementId).catch(() => null);
      if (!rect) {
        continue;
      }
      const width = Number(rect.width ?? 0);
      const height = Number(rect.height ?? 0);
      if (rect.x <= 70 && rect.y <= 120 && width >= 12 && height >= 12 && width <= 48 && height <= 48) {
        candidates.push({elementId, rect, className});
      }
    }
  }
  return candidates.sort((a, b) => {
    const classPriority = ['XCUIElementTypeButton', 'XCUIElementTypeImage'];
    return (
      a.rect.y - b.rect.y ||
      a.rect.x - b.rect.x ||
      classPriority.indexOf(a.className) - classPriority.indexOf(b.className)
    );
  });
}

function exactTextPredicate(text) {
  const escaped = escapePredicateValue(text);
  return `name == '${escaped}' OR label == '${escaped}' OR value == '${escaped}'`;
}

function chromeControlPredicate(labels) {
  const textPredicates = labels
    .map((label) => {
      const escaped = escapePredicateValue(label);
      return `name CONTAINS[c] '${escaped}' OR label CONTAINS[c] '${escaped}' OR value CONTAINS[c] '${escaped}'`;
    })
    .join(' OR ');
  return `(type == 'XCUIElementTypeButton' OR type == 'XCUIElementTypeImage') AND (${textPredicates})`;
}

function escapePredicateValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function extractTopLeftBackPointFromSource(source) {
  if (!source) {
    return null;
  }

  if (!source.includes('XCUIElementTypeWebView')) {
    return null;
  }

  const pattern =
    /<XCUIElementType(?:Button|Image|Other)\b[^>]*\bx="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="(\d+)"[^>]*\/?>/g;
  const candidates = [];
  let match;
  while ((match = pattern.exec(source))) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const width = Number(match[3]);
    const height = Number(match[4]);
    if (x <= 70 && y >= 30 && y <= 120 && width >= 16 && height >= 16 && width <= 40 && height <= 40) {
      candidates.push({x, y, width, height});
    }
    if (candidates.length >= 6) {
      break;
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const target = candidates.sort((a, b) => a.y - b.y || a.x - b.x)[0];
  return {
    x: Math.round(target.x + target.width / 2),
    y: Math.round(target.y + target.height / 2),
  };
}

function extractHomeSearchPointFromSource(source) {
  if (!source) {
    return null;
  }

  const tagPattern = /<XCUIElementType(?:Image|Button|Other)\b[^>]*>/g;
  let match;
  while ((match = tagPattern.exec(source))) {
    const tag = match[0];
    if (!tag.includes('searchBar_icon_v25') && !tag.includes('searchBar_icon')) {
      continue;
    }
    const rectMatch = tag.match(/\bx="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="(\d+)"/);
    if (!rectMatch) {
      continue;
    }
    const x = Number(rectMatch[1]);
    const y = Number(rectMatch[2]);
    const width = Number(rectMatch[3]);
    const height = Number(rectMatch[4]);
    if (x < 320 || y < 30 || y > 120 || width < 8 || height < 20) {
      continue;
    }
    return {
      x: Math.round(x + width / 2),
      y: Math.round(y + height / 2),
    };
  }

  return null;
}

async function waitForSearchField(sessionId, options = {}) {
  return waitForCondition(async () => {
    const field = await findOptionalElement(sessionId, 'accessibility id', 'search_textField');
    if (field) {
      return field;
    }
    return null;
  }, options);
}

async function tapHomeSearchHotspot(sessionId, source = '') {
  const predicate = "name == 'searchBar_icon_v25' OR label == 'searchBar_icon_v25' OR name == 'searchBar_icon' OR label == 'searchBar_icon'";
  const searchIcon =
    (await findOptionalElement(sessionId, 'accessibility id', 'searchBar_icon_v25')) ??
    (await findOptionalElement(sessionId, 'accessibility id', 'searchBar_icon')) ??
    (await findOptionalElement(sessionId, '-ios predicate string', predicate));
  if (searchIcon) {
    await clickElement(sessionId, searchIcon).catch(async () => {
      const point = extractHomeSearchPointFromSource(source);
      if (point) {
        await tap(sessionId, point.x, point.y);
        return;
      }
      await tap(sessionId, 386, 72);
    });
    return;
  }

  const point = extractHomeSearchPointFromSource(source);
  if (point) {
    await tap(sessionId, point.x, point.y);
    return;
  }

  await tap(sessionId, 386, 72);
}

export async function relaunchToHome(sessionId) {
  await reviveAppToForeground(sessionId);

  let source = await waitForHomeSource(sessionId, {timeoutMs: 4500, intervalMs: 900});
  if (source) {
    return source;
  }

  for (let index = 0; index < 5; index += 1) {
    source = await getSource(sessionId);
    const pageKind = classifySource(source);
    const recovered = await recoverPageTowardsHome(sessionId, pageKind, source);
    if (!recovered) {
      await fallbackRelaunch(sessionId, {hard: index >= 2}).catch(() => {});
    }
    await dismissCommonPopups(sessionId).catch(() => {});
    source = await waitForHomeSource(sessionId, {timeoutMs: 2200, intervalMs: 550});
    if (source) {
      return source;
    }
  }

  await fallbackRelaunch(sessionId, {hard: true});
  source = await waitForHomeSource(sessionId, {timeoutMs: 5500, intervalMs: 1000});
  if (source) {
    return source;
  }

  throw new Error('Could not return to MGTV home page.');
}

async function tapTopLeftBackHotspot(sessionId, source = '') {
  const sourcePoint = extractTopLeftBackPointFromSource(source);
  if (sourcePoint) {
    await tap(sessionId, sourcePoint.x, sourcePoint.y);
    return;
  }

  const candidates = await findTopLeftBackCandidates(sessionId).catch(() => []);
  if (candidates.length > 0) {
    await clickElement(sessionId, candidates[0].elementId).catch(async () => {
      const rect = candidates[0].rect;
      await tap(sessionId, Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
    });
    return;
  }

  const rect = await getWindowRect(sessionId);
  const point = pointFromPercent(rect, 0.07, 0.08);
  await tap(sessionId, point.x, point.y);
}

export async function openSearchPage(sessionId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let source = await getSource(sessionId).catch(() => '');
    let pageKind = classifySource(source);

    if (pageKind === 'search') {
      const existingField = await waitForSearchField(sessionId, {timeoutMs: 2000, intervalMs: 400});
      if (existingField) {
        return existingField;
      }
    }

    if (pageKind !== 'home') {
      await recoverPageTowardsHome(sessionId, pageKind, source).catch(() => {});
      await dismissCommonPopups(sessionId).catch(() => {});
      source = (await waitForHomeSource(sessionId, {timeoutMs: 2200, intervalMs: 500})) ?? (await getSource(sessionId).catch(() => ''));
      pageKind = classifySource(source);
      if (pageKind !== 'home') {
        await relaunchToHome(sessionId);
        source = await getSource(sessionId).catch(() => '');
        pageKind = classifySource(source);
      }
    }

    if (pageKind === 'home') {
      await tapHomeSearchHotspot(sessionId, source);
      const searchReady = await waitForSearchField(sessionId, {timeoutMs: 5000, intervalMs: 500});
      if (searchReady) {
        return searchReady;
      }
    }
  }

  throw new Error('Could not open the search page.');
}

async function waitForHomeSource(sessionId, options = {}) {
  return waitForCondition(async () => {
    const source = await getSource(sessionId);
    if (isHomeSource(source)) {
      return source;
    }
    return null;
  }, options);
}

async function reviveAppToForeground(sessionId) {
  await activateApp(sessionId).catch(() => {});
  await setOrientation(sessionId, 'PORTRAIT').catch(() => {});
  await sleep(2500);
  await dismissCommonPopups(sessionId).catch(() => {});
}

async function fallbackRelaunch(sessionId, options = {}) {
  if (options.hard) {
    await terminateApp(sessionId).catch(() => {});
    await sleep(1200);
  } else {
    await backgroundApp(sessionId, 1).catch(() => {});
  }
  await reviveAppToForeground(sessionId);
}

async function recoverPageTowardsHome(sessionId, pageKind, source = '') {
  switch (pageKind) {
    case 'home':
      return 'home';
    case 'activity-webview':
      await recoverActivityWebView(sessionId, source);
      return 'activity-webview';
    case 'webview':
      await tapTopLeftBackHotspot(sessionId, source).catch(() => {});
      await sleep(1200);
      await clickCloseOrBackControl(sessionId, {
        includeClose: false,
        includeBack: true,
        fallback: true,
        waitMs: 700,
        maxY: 240,
        preferTopLeft: false,
      }).catch(() => {});
      return 'webview';
    case 'paywall':
    case 'ad':
      await dismissCommonPopups(sessionId).catch(() => {});
      await clickCloseOrBackControl(sessionId, {
        includeClose: true,
        includeBack: false,
        fallback: false,
        waitMs: 700,
        maxY: 260,
      }).catch(() => {});
      return pageKind;
    case 'search':
    case 'vod':
    case 'player':
      await clickCloseOrBackControl(sessionId, {
        includeClose: true,
        includeBack: true,
        fallback: true,
        waitMs: pageKind === 'player' ? 900 : 700,
        maxY: 240,
      }).catch(() => {});
      return pageKind;
    default:
      await clickCloseOrBackControl(sessionId, {
        includeClose: true,
        includeBack: true,
        fallback: true,
        waitMs: 700,
        maxY: 240,
      }).catch(() => {});
      return null;
  }
}

async function recoverActivityWebView(sessionId, source = '') {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await tapTopLeftBackHotspot(sessionId, source).catch(() => {});
    await sleep(1000);
    source = await getSource(sessionId);
    if (classifySource(source) !== 'activity-webview') {
      return;
    }
  }
  await fallbackRelaunch(sessionId, {hard: true});
}

export async function searchKeyword(sessionId, keyword) {
  const field = await openSearchPage(sessionId);
  await clickElement(sessionId, field);
  await clearElement(sessionId, field).catch(() => {});
  await typeValue(sessionId, field, keyword);
  await sleep(800);
  await clickAccessibilityId(sessionId, ' 搜索');

  const isResultPageReady = (source) =>
    source.includes(keyword) &&
    (source.includes('播放') ||
      source.includes('缓存') ||
      source.includes('相关影视作品') ||
      source.includes('选集'));

  let source = await waitForCondition(async () => {
    const currentSource = await getSource(sessionId);
    if (isResultPageReady(currentSource) || isVodReadySource(currentSource, keyword)) {
      return currentSource;
    }
    return null;
  }, {timeoutMs: 12000, intervalMs: 1000});

  if (!source) {
    const currentSource = await getSource(sessionId);
    if (
      currentSource.includes('热搜榜') ||
      currentSource.includes('猜你想搜这些') ||
      currentSource.includes('NewSearchView') ||
      currentSource.includes('search_textField')
    ) {
      await clickAccessibilityId(sessionId, ' 搜索');
      source = await waitForCondition(async () => {
        const retrySource = await getSource(sessionId);
        if (isResultPageReady(retrySource) || isVodReadySource(retrySource, keyword)) {
          return retrySource;
        }
        return null;
      }, {timeoutMs: 12000, intervalMs: 1000});
    }
  }

  if (!source) {
    throw new Error(`Search results for "${keyword}" did not become ready.`);
  }
  return source;
}

export async function openVodDetailFromResults(sessionId, keyword) {
  let source = await getSource(sessionId).catch(() => '');
  if (isVodReadySource(source, keyword)) {
    return source;
  }

  await clickAccessibilityId(sessionId, keyword).catch(() => null);
  source = await waitForCondition(async () => {
    const currentSource = await getSource(sessionId);
    return isVodReadySource(currentSource, keyword) ? currentSource : null;
  }, {timeoutMs: 15000, intervalMs: 1000});
  if (!source) {
    throw new Error(`Could not enter the VOD detail page for "${keyword}".`);
  }
  return source;
}

export async function switchEpisode(sessionId, episodeNumber) {
  const episodeLabel = String(episodeNumber);
  const episodeElement = await findOptionalElement(sessionId, 'accessibility id', episodeLabel);
  if (episodeElement) {
    await clickElement(sessionId, episodeElement);
    await sleep(1200);
  } else {
    const x = 40 + Math.max(0, episodeNumber - 1) * 58;
    await tap(sessionId, x, 724);
    await sleep(1200);
  }

  const targetText = `第${episodeNumber}集`;
  let source = await waitForText(sessionId, targetText, {timeoutMs: 10000, intervalMs: 1200});

  if (!source) {
    source = await getSource(sessionId);
  }

  if (!source.includes(targetText) && !source.includes(`"${episodeLabel}"`)) {
    throw new Error(`Episode ${episodeNumber} did not become active.`);
  }
  return source;
}
