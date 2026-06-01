import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {
  APP_BUNDLE_ID,
  APP_NAME,
  ARTIFACT_DIR,
  clickCloseOrBackControl,
  clickElement,
  createSession,
  deleteSession,
  dismissCommonPopups,
  doubleTapPercent,
  dragPercent,
  findOptionalElement,
  getSource,
  longPressPercent,
  openVodDetailFromResults,
  relaunchToHome,
  request,
  saveScreenshot,
  searchKeyword,
  sleep,
  tap,
} from './lib/appium-ios-helpers.mjs';

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const reportPrefix = `app-explore/${runId}`;
const reportDir = path.join(ARTIFACT_DIR, reportPrefix);

const report = {
  runId,
  appName: APP_NAME,
  appBundleId: APP_BUNDLE_ID,
  startedAt: new Date().toISOString(),
  finishedAt: '',
  guardrails: [
    '不输入账号、密码、验证码',
    '不点击确认支付/立即支付/提交订单',
    '只点击已知安全入口和播放器安全区域',
  ],
  steps: [],
  observations: {},
};

const onlyIndex = process.argv.indexOf('--only');
const onlySections =
  onlyIndex >= 0 && process.argv[onlyIndex + 1]
    ? new Set(process.argv[onlyIndex + 1].split(',').map((item) => item.trim()).filter(Boolean))
    : new Set();

async function main() {
  await mkdir(reportDir, {recursive: true});
  const sessionId = await createSession();
  try {
    await maybeRecord('home', '首页启动与弹窗清理', async () => {
      await relaunchToHome(sessionId);
      await dismissCommonPopups(sessionId).catch(() => {});
      await capture(sessionId, 'home');
    });

    await maybeRecord('tabs', '首页 Tab 与推荐流安全巡检', async () => {
      const tabs = ['刷片', '首页测试', '找片', '短剧', '综艺', '电视剧', '电影'];
      const visited = [];
      for (const tab of tabs) {
        const clicked = await clickAnyText(sessionId, [tab]);
        if (!clicked) {
          continue;
        }
        visited.push(tab);
        await sleep(800);
        await dragPercent(sessionId, {x: 0.54, y: 0.78}, {x: 0.54, y: 0.34}, {durationMs: 200});
        await sleep(350);
      }
      report.observations.homeTabs = visited;
      await capture(sessionId, 'home-tabs');
    });

    await maybeRecord('search', '搜索关键词批量观察', async () => {
      const keywords = ['歌手', '乘风', '大侦探'];
      const observed = [];
      const failures = [];
      for (const keyword of keywords) {
        try {
          const homeReady = await resilientHome(sessionId);
          if (!homeReady) {
            throw new Error('Could not recover to MGTV home page before search.');
          }
          await searchKeyword(sessionId, keyword);
          observed.push(keyword);
          await capture(sessionId, `search-${safeName(keyword)}`);
        } catch (error) {
          failures.push({keyword, error: String(error?.message ?? error)});
        } finally {
          await resilientHome(sessionId);
        }
      }
      report.observations.searchKeywords = observed;
      if (failures.length) {
        report.observations.searchFailures = failures;
      }
      if (observed.length === 0) {
        throw new Error(`No search keyword completed: ${JSON.stringify(failures)}`);
      }
    });

    await maybeRecord('player', '点播详情与播放器核心手势', async () => {
      await relaunchToHome(sessionId);
      await searchKeyword(sessionId, '我的人间烟火');
      await openVodDetailFromResults(sessionId, '我的人间烟火');
      await capture(sessionId, 'vod-detail');
      await clickAnyText(sessionId, ['播放', '立即播放', '继续播放']);
      await sleep(2500);
      await clickAnyText(sessionId, ['跳过', '跳过广告', '关闭'], {maxAttempts: 1});
      await tapPlayerCenter(sessionId);
      await doubleTapPercent(sessionId, 0.72, 0.5);
      await sleep(700);
      await doubleTapPercent(sessionId, 0.28, 0.5);
      await sleep(700);
      await longPressPercent(sessionId, 0.5, 0.5, {durationMs: 800});
      await sleep(700);
      await dragPercent(sessionId, {x: 0.32, y: 0.84}, {x: 0.68, y: 0.84}, {durationMs: 650});
      await capture(sessionId, 'player-gestures');
      await safeBack(sessionId);
    });

    await maybeRecord('vip', '会员页与收银台只读观察', async () => {
      await relaunchToHome(sessionId);
      const entered = await clickAnyText(sessionId, ['开通会员', '会员', 'VIP']);
      if (!entered) {
        report.observations.vip = '未找到会员入口';
        return;
      }
      await sleep(1800);
      await capture(sessionId, 'vip-page');
      const cashierEntry = await clickAnyText(sessionId, ['立即开通', '开通会员', '会员免广告', 'VIP']);
      if (cashierEntry) {
        await sleep(1800);
        await capture(sessionId, 'cashier-readonly');
        report.observations.cashierEntry = cashierEntry;
      }
      await safeBack(sessionId);
      await safeBack(sessionId);
    });
  } finally {
    report.finishedAt = new Date().toISOString();
    report.durationMs = new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime();
    await writeFile(path.join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await deleteSession(sessionId);
  }

  console.log(`Explorer report: ${path.join(reportDir, 'report.json')}`);
}

async function maybeRecord(key, name, fn) {
  if (onlySections.size > 0 && !onlySections.has(key)) {
    return;
  }
  await record(name, fn);
}

async function record(name, fn) {
  const startedAt = new Date().toISOString();
  const step = {name, status: 'passed', startedAt, finishedAt: '', durationMs: 0};
  const started = Date.now();
  try {
    await fn();
  } catch (error) {
    step.status = 'failed';
    step.error = String(error?.message ?? error);
  } finally {
    step.finishedAt = new Date().toISOString();
    step.durationMs = Date.now() - started;
    report.steps.push(step);
    console.log(`${step.status === 'passed' ? '✓' : '✕'} ${name}`);
  }
}

async function capture(sessionId, name) {
  const filename = `${reportPrefix}/${name}`;
  await saveScreenshot(sessionId, `${filename}.png`).catch(() => null);
  const source = await getSource(sessionId).catch(() => '');
  await writeFile(path.join(reportDir, `${name}.xml`), source, 'utf8').catch(() => null);
  return source;
}

async function clickAnyText(sessionId, texts, options = {}) {
  for (let attempt = 0; attempt < (options.maxAttempts ?? 2); attempt += 1) {
    for (const text of texts) {
      const elementId =
        (await findOptionalElement(sessionId, 'accessibility id', text)) ??
        (await findOptionalElement(sessionId, '-ios predicate string', exactTextPredicate(text)));
      if (elementId) {
        await clickElement(sessionId, elementId);
        await sleep(options.waitMs ?? 900);
        return text;
      }
    }
    await sleep(300);
  }
  return null;
}

async function tapPlayerCenter(sessionId) {
  const rect = (await request(`/session/${sessionId}/window/rect`)).value;
  await tap(sessionId, Math.round(rect.x + rect.width * 0.5), Math.round(rect.y + rect.height * 0.5));
  await sleep(600);
}

async function safeBack(sessionId) {
  await clickCloseOrBackControl(sessionId, {
    includeClose: true,
    includeBack: true,
    fallback: true,
    waitMs: 900,
  }).catch(() => null);
}

async function resilientHome(sessionId) {
  try {
    await relaunchToHome(sessionId);
    return true;
  } catch {
    // Some MGTV views restore into search/results after relaunch; unwind visibly before retrying.
  }

  for (let index = 0; index < 7; index += 1) {
    await clickAnyText(sessionId, ['取消', '首页测试', '刷片', '找片'], {maxAttempts: 1, waitMs: 700});
    await dismissCommonPopups(sessionId).catch(() => {});
    const source = await getSource(sessionId).catch(() => '');
    if (source.includes('找片') || source.includes('首页测试') || source.includes('刷片')) {
      return true;
    }
    await safeBack(sessionId);
  }

  try {
    await relaunchToHome(sessionId);
    return true;
  } catch {
    return false;
  }
}

function exactTextPredicate(text) {
  const escaped = String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `name == '${escaped}' OR label == '${escaped}' OR value == '${escaped}'`;
}

function safeName(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

await main();
