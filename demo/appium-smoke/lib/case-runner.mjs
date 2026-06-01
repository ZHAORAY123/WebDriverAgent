import {mkdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {
  APP_BUNDLE_ID,
  APP_NAME,
  ARTIFACT_DIR,
  activateApp,
  backgroundApp,
  clickElement,
  clickCloseOrBackControl,
  createSession,
  deleteSession,
  dismissCommonPopups,
  doubleTapPercent,
  dragPercent,
  findOptionalElement,
  getSource,
  getWindowRect,
  longPressPercent,
  openVodDetailFromResults,
  relaunchToHome,
  request,
  saveScreenshot,
  saveSource,
  searchKeyword,
  sleep as baseSleep,
  switchEpisode,
  tap,
  terminateApp,
} from './appium-ios-helpers.mjs';
import {loadCases} from './case-store.mjs';
import {findImageMatchAny, performImageMatchAction} from './image-match.mjs';

const ACTIVE_SESSION_PATH = path.join(ARTIFACT_DIR, 'active-session.json');
const DEFAULT_STEP_BUDGET_MS = Number(process.env.CASE_STEP_BUDGET_MS ?? '1000');
const DEFAULT_AD_TIMEOUT_MS = Number(process.env.CASE_AD_TIMEOUT_MS ?? '6500');
const DEFAULT_SESSION_SCOPE = process.env.CASE_SESSION_SCOPE ?? 'case';
const DEFAULT_CASE_RETRY_COUNT = Number(process.env.CASE_RETRY_ON_SESSION_ERROR ?? '1');
const DIAGNOSTIC_ACTIONS = new Set(['saveScreenshot', 'saveSource', 'sleep']);
let shutdownRequested = false;

process.once('SIGTERM', () => {
  shutdownRequested = true;
});
process.once('SIGINT', () => {
  shutdownRequested = true;
});

async function sleep(ms) {
  const chunkMs = 100;
  const deadline = Date.now() + Number(ms ?? 0);
  while (Date.now() < deadline) {
    ensureNotCancelled();
    await baseSleep(Math.min(chunkMs, Math.max(0, deadline - Date.now())));
  }
  ensureNotCancelled();
}

export const SUPPORTED_ACTIONS = [
  'activateApp',
  'assertAllText',
  'assertAnyText',
  'assertCashier',
  'assertNotText',
  'assertText',
  'back',
  'clickAnyText',
  'clickOptionalTexts',
  'clickText',
  'closeAd',
  'coldStartHomeOnly',
  'closeOrBack',
  'dismissCommonPopups',
  'doubleTapPercent',
  'dragPercent',
  'dragProgressBar',
  'enterFullscreen',
  'homeTabSweep',
  'longPressPercent',
  'imageMatchAny',
  'openCashierAndAssert',
  'openVodDetailFromResults',
  'playAndAssert',
  'playerGestureSuite',
  'relaunchToHome',
  'saveScreenshot',
  'saveSource',
  'searchBatch',
  'searchKeyword',
  'sleep',
  'switchEpisode',
  'swipePercent',
  'tap',
  'tapPercent',
  'waitAndCloseAd',
  'waitForAd',
  'waitText',
  'warmStart',
];

export async function listCases() {
  return loadCases();
}

export async function runManagedCases(options = {}) {
  const baseCases = await selectCases(options);
  const repeat = normalizeRepeat(options.repeat);
  const cases = expandRepeatedCases(baseCases, repeat);
  if (cases.length === 0) {
    throw new Error('No matching cases were found.');
  }

  const startedAt = new Date();
  const runId = startedAt.toISOString().replace(/[:.]/g, '-');
  const reportDir = path.join(ARTIFACT_DIR, 'case-runs', runId);
  await mkdir(reportDir, {recursive: true});

  const results = [];
  const shared = {};
  const sessionScope = options.sessionScope ?? DEFAULT_SESSION_SCOPE;
  let sharedSessionId = '';
  let cancelled = false;

  try {
    for (const testCase of cases) {
      ensureNotCancelled();
      let sessionId = '';
      try {
        if (sessionScope === 'run') {
          if (!sharedSessionId) {
            sharedSessionId = await createSession();
          }
          sessionId = sharedSessionId;
        } else {
          sessionId = await createSession();
        }

        let result = await runCaseWithOptionalRetry(testCase, {
          runId,
          reportDir,
          sessionId,
          appBundleId: APP_BUNDLE_ID,
          appName: APP_NAME,
          shared,
        });

        if (
          result.status === 'failed' &&
          sessionScope !== 'run' &&
          shouldRetryCaseOnSessionError(result.error)
        ) {
          console.warn(`↺ ${testCase.title}: recreating session after transport failure and retrying once...`);
          await clearActiveSession(sessionId);
          await deleteSession(sessionId);
          sessionId = await createSession();
          result = await runCaseWithOptionalRetry(testCase, {
            runId,
            reportDir,
            sessionId,
            appBundleId: APP_BUNDLE_ID,
            appName: APP_NAME,
            shared,
            retryTag: 'session-retry',
          });
          if (result.status === 'passed') {
            result.retried = true;
          }
        }

        results.push(result);
      } catch (error) {
        if (isRunCancelled(error)) {
          cancelled = true;
          throw error;
        }
        if (results.length === 0 && isEnvironmentSetupError(error)) {
          throw error;
        }
        results.push(createFailedCaseResult(testCase, error));
        console.error(`✕ ${testCase.title}: ${String(error?.message ?? error)}`);
      } finally {
        if (sessionId) {
          await clearActiveSession(sessionId);
        }
        if (sessionScope !== 'run' && sessionId) {
          await deleteSession(sessionId);
        }
      }
    }
  } catch (error) {
    if (isRunCancelled(error)) {
      cancelled = true;
      console.warn('Run cancelled by user.');
    } else {
      const stepName = isEnvironmentSetupError(error) ? '环境预检' : '创建 Appium 会话';
      const affectedCases = isEnvironmentSetupError(error) ? cases.slice(0, 1) : cases;
      for (const testCase of affectedCases) {
        results.push(createFailedCaseResult(testCase, error, stepName));
      }
      console.error(`✕ 创建 Appium 会话失败: ${String(error?.message ?? error)}`);
    }
  } finally {
    if (sharedSessionId) {
      await clearActiveSession(sharedSessionId);
      await deleteSession(sharedSessionId);
    }
  }

  const report = {
    runId,
    appName: APP_NAME,
    appBundleId: APP_BUNDLE_ID,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((item) => item.status === 'passed').length,
    failed: results.filter((item) => item.status === 'failed').length,
    status: cancelled ? 'paused' : results.some((item) => item.status === 'failed') ? 'failed' : 'passed',
    repeat,
    results,
  };

  const reportPath = path.join(reportDir, 'report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return {...report, reportPath};
}

function ensureNotCancelled() {
  if (shutdownRequested) {
    throw new Error('Run cancelled.');
  }
}

function isRunCancelled(error) {
  return String(error?.message ?? error) === 'Run cancelled.';
}

async function ensureRunNotCancelled() {
  if (!RUN_CONTROL_URL) {
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(`${RUN_CONTROL_URL.replace(/\/$/, '')}/api/runs/active/state`, {
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (payload?.status === 'paused') {
      throw new Error('Run cancelled.');
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      return;
    }
  } finally {
    clearTimeout(timer);
  }
}

function normalizeRepeat(value) {
  const repeat = Number(value ?? 1);
  if (!Number.isFinite(repeat) || repeat < 1) {
    return 1;
  }
  return Math.min(10000, Math.floor(repeat));
}

function expandRepeatedCases(cases, repeat) {
  if (repeat <= 1) {
    return cases;
  }
  const expanded = [];
  for (let index = 1; index <= repeat; index += 1) {
    for (const testCase of cases) {
      expanded.push({
        ...testCase,
        id: `${testCase.id}#${index}`,
        baseId: testCase.id,
        title: `${testCase.title} · 第 ${index}/${repeat} 次`,
        repeatIndex: index,
        repeatTotal: repeat,
      });
    }
  }
  return expanded;
}

async function runCaseWithOptionalRetry(testCase, context) {
  await writeActiveSession({
    runId: context.runId,
    caseId: testCase.id,
    sessionId: context.sessionId,
    retryTag: context.retryTag ?? '',
  });
  return runSingleCase(testCase, context);
}

function createFailedCaseResult(testCase, error, stepName = '执行用例') {
  return {
    id: testCase.id,
    title: testCase.title,
    group: testCase.group,
    status: 'failed',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    error: String(error?.stack ?? error?.message ?? error),
    steps: [
      {
        name: stepName,
        status: 'failed',
        error: String(error?.message ?? error),
      },
    ],
  };
}

function shouldRetryCaseOnSessionError(message) {
  const text = String(message ?? '');
  return [
    'socket hang up',
    'Could not proxy command to the remote server',
    'fetch failed',
    'Empty reply from server',
    'ECONNRESET',
    'ECONNREFUSED',
  ].some((token) => text.includes(token));
}

function isEnvironmentSetupError(error) {
  const text = String(error?.stack ?? error?.message ?? error);
  return [
    'Developer App Certificate is not trusted',
    'No signing certificate',
    'No profiles for',
    'No Account for Team',
    'invalid code signature',
    'inadequate entitlements',
    'profile has not been explicitly trusted',
    'Unable to start WebDriverAgent session',
    'xcodebuild failed with code 65',
  ].some((token) => text.includes(token));
}

async function writeActiveSession(payload) {
  await writeFile(
    ACTIVE_SESSION_PATH,
    `${JSON.stringify({...payload, updatedAt: new Date().toISOString()}, null, 2)}\n`,
    'utf8'
  );
}

async function clearActiveSession(sessionId) {
  if (!sessionId) {
    return;
  }
  await rm(ACTIVE_SESSION_PATH, {force: true}).catch(() => {});
}

async function selectCases(options) {
  const cases = await loadCases();
  const ids = toSet(options.ids);
  const tags = toSet(options.tags);
  const groups = toSet(options.groups);

  return cases.filter((testCase) => {
    if (!options.includeDisabled && testCase.enabled === false) {
      return false;
    }
    if (ids.size > 0 && !ids.has(testCase.id)) {
      return false;
    }
    if (groups.size > 0 && !groups.has(testCase.group)) {
      return false;
    }
    if (tags.size > 0 && !testCase.tags?.some((tag) => tags.has(tag))) {
      return false;
    }
    return true;
  });
}

function toSet(value) {
  if (!value) {
    return new Set();
  }
  return new Set(Array.isArray(value) ? value.filter(Boolean) : [value]);
}

async function runSingleCase(testCase, context) {
  const caseStartedAt = new Date();
  const caseResult = {
    id: testCase.id,
    title: testCase.title,
    group: testCase.group,
    status: 'passed',
    startedAt: caseStartedAt.toISOString(),
    finishedAt: '',
    steps: [],
  };
  const caseContext = {
    ...context,
    case: testCase,
    params: testCase.params ?? {},
    stepIndex: 0,
  };

  console.log(`\n▶ ${testCase.title} [${testCase.id}]`);

  try {
    for (const step of testCase.steps ?? []) {
      caseContext.stepIndex += 1;
      const stepStartedAt = Date.now();
      const stepName = step.name || step.action;
      console.log(`  ${caseContext.stepIndex}. ${stepName}`);
      const execution = await executeStepWithRecovery(step, caseContext);
      const durationMs = Date.now() - stepStartedAt;
      const stepResult = {
        name: stepName,
        action: step.action,
        expectedResult: step.expectedResult ?? '',
        actualResult: execution.actualResult ?? buildActualResult(execution, durationMs),
        status: execution.status,
        durationMs,
      };
      if (execution.warning) {
        stepResult.warning = execution.warning;
      }
      if (execution.recovered) {
        stepResult.recovered = true;
      }
      if (execution.diagnostics) {
        stepResult.diagnostics = execution.diagnostics;
      }
      if (execution.error) {
        stepResult.error = execution.error;
      }
      caseResult.steps.push({
        ...stepResult,
      });
      if (execution.status === 'failed') {
        caseResult.status = 'failed';
        caseResult.error = execution.error;
        break;
      }
    }
  } catch (error) {
    caseResult.status = 'failed';
    caseResult.error = String(error?.stack ?? error?.message ?? error);
    caseResult.steps.push({
      name: `失败于第 ${caseContext.stepIndex} 步`,
      status: 'failed',
      error: String(error?.message ?? error),
    });
    if (testCase.saveFailureArtifacts !== false) {
      await saveFailureArtifacts(caseContext);
    }
    console.error(`  ✕ ${String(error?.message ?? error)}`);
  }

  caseResult.finishedAt = new Date().toISOString();
  console.log(caseResult.status === 'passed' ? `✓ ${testCase.title}` : `✕ ${testCase.title}`);
  return caseResult;
}

async function executeStepWithRecovery(rawStep, context) {
  const step = resolveTemplates(rawStep, context);
  const budgetMs = getStepBudgetMs(step);
  const startedAt = Date.now();
  try {
    const executionResult = await executeResolvedStep(step, context);
    const durationMs = Date.now() - startedAt;
    if (shouldDiagnoseSlowStep(step, durationMs, budgetMs)) {
      const diagnostics = await saveStepDiagnostics(context, step, {
        reason: 'slow-step',
        durationMs,
        budgetMs,
        error: `Step exceeded ${budgetMs}ms budget.`,
      });
      return {
        status: 'passed',
        actualResult: executionResult ?? undefined,
        warning: `动作耗时 ${durationMs}ms，超过 ${budgetMs}ms 预算，已截图和保存源码用于优化。`,
        diagnostics,
      };
    }
    return {status: 'passed', actualResult: executionResult ?? undefined};
  } catch (error) {
    const firstDiagnostics =
      step.saveFailureArtifacts === false
        ? null
        : await saveStepDiagnostics(context, step, {
            reason: 'step-error',
            durationMs: Date.now() - startedAt,
            budgetMs,
            error: String(error?.message ?? error),
          });
    if (step.autoRecover === false || DIAGNOSTIC_ACTIONS.has(step.action)) {
      return {
        status: step.required === false ? 'skipped' : 'failed',
        error: String(error?.message ?? error),
        diagnostics: firstDiagnostics,
      };
    }

    const recovered = await recoverExecutionPath(step, context);
    if (!recovered) {
      return {
        status: step.required === false ? 'skipped' : 'failed',
        error: String(error?.message ?? error),
        diagnostics: firstDiagnostics,
      };
    }

    const retryStartedAt = Date.now();
    try {
      const retryResult = await executeResolvedStep(step, context);
      return {
        status: 'passed',
        recovered: true,
        actualResult: retryResult ?? undefined,
        warning: `首次执行失败，已通过 ${recovered} 恢复并重试通过。`,
        diagnostics: firstDiagnostics,
      };
    } catch (retryError) {
      const retryDiagnostics = await saveStepDiagnostics(context, step, {
        reason: 'step-retry-error',
        durationMs: Date.now() - retryStartedAt,
        budgetMs,
        error: String(retryError?.message ?? retryError),
      });
      return {
        status: step.required === false ? 'skipped' : 'failed',
        error: String(retryError?.message ?? retryError),
        diagnostics: {...firstDiagnostics, retry: retryDiagnostics},
      };
    }
  }
}

async function executeStep(rawStep, context) {
  const step = resolveTemplates(rawStep, context);
  return executeResolvedStep(step, context);
}

function buildActualResult(execution, durationMs) {
  if (execution.status === 'passed') {
    return execution.recovered
      ? `执行通过，首次失败后已恢复并重试成功，耗时 ${durationMs}ms。`
      : `执行通过，耗时 ${durationMs}ms。`;
  }
  if (execution.status === 'skipped') {
    return `可选步骤未完成，已记录诊断信息。${execution.error ? `原因：${execution.error}` : ''}`;
  }
  return `执行失败，已截图并保存源码。${execution.error ? `原因：${execution.error}` : ''}`;
}

async function executeResolvedStep(step, context) {
  const sessionId = context.sessionId;

  switch (step.action) {
    case 'relaunchToHome':
      await relaunchToHome(sessionId);
      await waitAndCloseStartupAd({...step, startupType: 'cold'}, context);
      return;
    case 'warmStart':
      await warmStart(step, context);
      return;
    case 'activateApp':
      await activateApp(sessionId, step.bundleId || APP_BUNDLE_ID);
      await sleep(step.waitMs ?? 300);
      await waitAndCloseStartupAd({...step, startupType: 'activate'}, context);
      return;
    case 'dismissCommonPopups':
      await dismissCommonPopups(sessionId);
      return;
    case 'searchKeyword':
      context.shared.lastSource = await searchKeyword(sessionId, requireValue(step.keyword, 'keyword'));
      return;
    case 'searchBatch':
      await runSearchBatch(step, context);
      return;
    case 'openVodDetailFromResults':
      context.shared.lastSource = await openVodDetailFromResults(
        sessionId,
        requireValue(step.keyword, 'keyword')
      );
      return;
    case 'switchEpisode':
      context.shared.lastSource = await switchEpisode(sessionId, Number(requireValue(step.episode, 'episode')));
      return;
    case 'clickText':
      await clickText(sessionId, requireValue(step.text, 'text'));
      await sleep(step.waitMs ?? 250);
      return;
    case 'clickAnyText':
      await clickAnyText(sessionId, step.texts ?? [], {required: step.required !== false});
      await sleep(step.waitMs ?? 250);
      return;
    case 'clickOptionalTexts':
      await clickOptionalTexts(step, context);
      return;
    case 'closeOrBack':
      await closeOrBack(step, context);
      return;
    case 'tap':
      await tap(sessionId, Number(step.x), Number(step.y));
      await sleep(step.waitMs ?? 150);
      return;
    case 'tapPercent':
      await tapPercent(sessionId, Number(step.x), Number(step.y));
      await sleep(step.waitMs ?? 150);
      return;
    case 'doubleTapPercent':
      await doubleTapPercent(sessionId, step.x ?? 0.5, step.y ?? 0.5, step);
      await sleep(step.waitMs ?? 250);
      return;
    case 'longPressPercent':
      await longPressPercent(sessionId, step.x ?? 0.5, step.y ?? 0.5, step);
      await sleep(step.waitMs ?? 250);
      return;
    case 'dragPercent':
      await dragPercent(sessionId, step.from, step.to, step);
      await sleep(step.waitMs ?? 250);
      return;
    case 'swipePercent':
      await swipePercent(sessionId, step);
      await sleep(step.waitMs ?? 250);
      return;
    case 'homeTabSweep':
      await homeTabSweep(step, context);
      return;
    case 'enterFullscreen':
      await enterFullscreen(step, context);
      return;
    case 'playAndAssert':
      await playAndAssert(step, context);
      return;
    case 'playerGestureSuite':
      await playerGestureSuite(step, context);
      return;
    case 'dragProgressBar':
      await dragProgressBar(step, context);
      return;
    case 'imageMatchAny': {
      const match = await findImageMatchAny(sessionId, step);
      if (!match) {
        if (step.required === false) {
          return '可选图片未命中';
        }
        throw new Error('Could not match any image candidate.');
      }
      context.shared.lastImageMatch = match;
      if (step.saveArtifacts) {
        await saveScreenshot(sessionId, step.filename ?? artifactName(context, 'png'));
      }
      const actionLabel = await performImageMatchAction(sessionId, match, step);
      return `命中 ${match.candidate?.name ?? match.candidate?.image} 并执行${actionLabel}`;
    }
    case 'waitForAd':
      await waitForAd(step, context);
      return;
    case 'closeAd':
      await closeAd(step, context);
      return;
    case 'coldStartHomeOnly':
      await coldStartHomeOnly(step, context);
      return;
    case 'waitAndCloseAd':
      await waitAndCloseAd(step, context);
      return;
    case 'openCashierAndAssert':
      await openCashierAndAssert(step, context);
      return;
    case 'assertCashier':
      await assertCashier(step, context);
      return;
    case 'assertText':
      await assertText(sessionId, requireValue(step.text, 'text'), step);
      return;
    case 'assertAllText':
      await assertAllText(sessionId, step.texts ?? [], step);
      return;
    case 'assertAnyText':
      await assertAnyText(sessionId, step.texts ?? [], step);
      return;
    case 'assertNotText':
      await assertNotText(sessionId, requireValue(step.text, 'text'));
      return;
    case 'waitText':
      await waitForTextOrThrow(sessionId, requireValue(step.text, 'text'), step);
      return;
    case 'saveScreenshot':
      await saveScreenshot(sessionId, step.filename ?? artifactName(context, 'png'));
      return;
    case 'saveSource':
      await saveSource(sessionId, step.filename ?? artifactName(context, 'xml'));
      return;
    case 'back':
      await closeOrBack({...step, fallback: true}, context);
      return;
    case 'sleep':
      await sleep(Number(step.ms ?? 1000));
      return;
    default:
      throw new Error(`Unsupported action: ${step.action}`);
  }
}

function getStepBudgetMs(step) {
  if (step.budgetMs != null) {
    return Number(step.budgetMs);
  }
  if (step.slowBudgetMs != null) {
    return Number(step.slowBudgetMs);
  }
  if (isStartupOrAdAction(step)) {
    return Number(step.timeoutMs ?? DEFAULT_AD_TIMEOUT_MS);
  }
  return DEFAULT_STEP_BUDGET_MS;
}

function isStartupOrAdAction(step) {
  return ['relaunchToHome', 'coldStartHomeOnly', 'warmStart', 'activateApp', 'waitForAd', 'closeAd', 'waitAndCloseAd'].includes(
    step.action
  );
}

function shouldDiagnoseSlowStep(step, durationMs, budgetMs) {
  return (
    step.diagnoseSlow !== false &&
    !isStartupOrAdAction(step) &&
    !DIAGNOSTIC_ACTIONS.has(step.action) &&
    durationMs > budgetMs
  );
}

async function warmStart(step, context) {
  await backgroundApp(context.sessionId, Number(step.backgroundSeconds ?? step.seconds ?? 3));
  await sleep(Number(step.foregroundWaitMs ?? 250));
  await activateApp(context.sessionId, step.bundleId || APP_BUNDLE_ID);
  await sleep(Number(step.waitMs ?? 300));
  await waitAndCloseStartupAd({...step, startupType: 'warm'}, context);
}

async function waitAndCloseStartupAd(step, context) {
  if (step.waitStartupAd === false) {
    return null;
  }
  return waitAndCloseAd({
    ...step,
    name: `${step.startupType ?? 'startup'} 启动广告等待`,
    timeoutMs: step.timeoutMs ?? DEFAULT_AD_TIMEOUT_MS,
    intervalMs: step.intervalMs ?? 500,
    required: false,
    closeWhenMissing: false,
    saveArtifacts: step.saveStartupAdArtifacts ?? step.saveArtifacts ?? false,
  }, context);
}

async function recoverExecutionPath(step, context) {
  const adClosed = await waitAndCloseAd({
    timeoutMs: step.recoveryAdTimeoutMs ?? 2500,
    intervalMs: 500,
    required: false,
    closeWhenMissing: true,
    saveArtifacts: true,
  }, context).catch(() => null);
  if (adClosed) {
    return `关闭广告/弹窗(${adClosed})`;
  }

  const popup = await dismissCommonPopups(context.sessionId).catch(() => null);
  if (popup) {
    return `关闭通用弹窗(${popup})`;
  }

  const back = await clickCloseOrBackControl(context.sessionId, {
    includeClose: true,
    includeBack: true,
    fallback: true,
    waitMs: 300,
    maxY: 220,
  }).catch(() => null);
  if (back) {
    return `关闭/返回(${back})`;
  }

  const rebuilt = await recoverToBusinessAnchor(step, context).catch(() => null);
  if (rebuilt) {
    return rebuilt;
  }

  if (step.relaunchOnRecover === true) {
    await relaunchToHome(context.sessionId).catch(() => null);
    await waitAndCloseStartupAd({timeoutMs: DEFAULT_AD_TIMEOUT_MS}, context).catch(() => null);
    return '重启回首页';
  }

  return null;
}

async function recoverToBusinessAnchor(step, context) {
  const keyword =
    step.keyword ??
    context.case?.params?.keyword ??
    context.params?.keyword ??
    context.shared?.lastKeyword ??
    '我的人间烟火';
  const action = step.action;

  if (
    ['playAndAssert', 'switchEpisode', 'clickOptionalTexts', 'swipePercent'].includes(action) &&
    isLikelyVodAction(step)
  ) {
    await relaunchToVodDetail(context.sessionId, keyword);
    return `重建到点播详情页(${keyword})`;
  }

  if (['enterFullscreen', 'playerGestureSuite', 'dragProgressBar', 'waitForAd', 'closeAd', 'waitAndCloseAd'].includes(action)) {
    await relaunchToPlayerContext(context.sessionId, keyword, step);
    return `重建到播放器态(${keyword})`;
  }

  if (action === 'openVodDetailFromResults') {
    await relaunchSearchResults(context.sessionId, keyword);
    return `重建到搜索结果页(${keyword})`;
  }

  if (action === 'searchKeyword') {
    await relaunchToHome(context.sessionId);
    await dismissCommonPopups(context.sessionId).catch(() => {});
    return '重建到首页';
  }

  return null;
}

function isLikelyVodAction(step) {
  const texts = Array.isArray(step.texts) ? step.texts : [];
  return texts.some((text) => ['追剧', '缓存', '分享', '更多', '简介', '评论', '猜你喜欢'].includes(text));
}

async function relaunchSearchResults(sessionId, keyword) {
  await relaunchToHome(sessionId);
  await dismissCommonPopups(sessionId).catch(() => {});
  await searchKeyword(sessionId, keyword);
}

async function relaunchToVodDetail(sessionId, keyword) {
  await relaunchSearchResults(sessionId, keyword);
  await openVodDetailFromResults(sessionId, keyword);
}

async function relaunchToPlayerContext(sessionId, keyword, step = {}) {
  await relaunchToVodDetail(sessionId, keyword);
  await playAndAssert({
    playTexts: step.playTexts ?? ['播放', '立即播放', '继续播放'],
    playingTexts: step.playingTexts ?? ['暂停', '全屏', '倍速', '选集', '清晰度'],
    required: false,
    waitMs: step.waitMs ?? 2500,
  }, {sessionId});
}

async function saveStepDiagnostics(context, step, details) {
  const dir = path.join(ARTIFACT_DIR, 'case-runs', context.runId, 'diagnostics');
  await mkdir(dir, {recursive: true});
  const baseName = `${safeName(context.case.id)}-step-${String(context.stepIndex).padStart(2, '0')}-${safeName(step.action)}-${safeName(details.reason)}`;
  const screenshotFile = `case-runs/${context.runId}/diagnostics/${baseName}.png`;
  const sourceFile = `case-runs/${context.runId}/diagnostics/${baseName}.xml`;
  const analysisFile = `case-runs/${context.runId}/diagnostics/${baseName}.analysis.json`;
  const screenshotPath = await saveScreenshot(context.sessionId, screenshotFile).catch(() => null);
  const sourceResult = await saveSource(context.sessionId, sourceFile).catch(() => null);
  const analysis = buildStepAnalysis(step, {
    ...details,
    hasSource: Boolean(sourceResult?.source),
    visibleHints: analyzeSourceHints(sourceResult?.source ?? ''),
  });
  await writeFile(path.join(ARTIFACT_DIR, analysisFile), `${JSON.stringify(analysis, null, 2)}\n`, 'utf8').catch(
    () => {}
  );
  return {
    screenshot: screenshotPath,
    source: sourceResult?.outputPath ?? null,
    analysis: path.join(ARTIFACT_DIR, analysisFile),
  };
}

function buildStepAnalysis(step, details) {
  const hints = details.visibleHints ?? [];
  const suggestion = [];
  if (hints.includes('ad')) {
    suggestion.push('当前页面疑似广告/会员免广告弹层，优先等待并点击跳过/关闭。');
  }
  if (hints.includes('cashier')) {
    suggestion.push('当前页面疑似会员收银台，仅允许校验展示和返回，不点击确认支付。');
  }
  if (hints.includes('search')) {
    suggestion.push('当前页面疑似搜索态，后续可点击取消或重新 relaunchToHome。');
  }
  if (hints.includes('player')) {
    suggestion.push('当前页面疑似播放器态，优先唤起控制层后执行播放器动作。');
  }
  if (suggestion.length === 0) {
    suggestion.push('未识别到稳定页面类型，建议先关闭弹窗/返回，再按当前业务动作重试一次。');
  }
  return {
    at: new Date().toISOString(),
    action: step.action,
    name: step.name ?? step.action,
    reason: details.reason,
    durationMs: details.durationMs,
    budgetMs: details.budgetMs,
    error: details.error,
    visibleHints: hints,
    nextRecovery: suggestion,
  };
}

function analyzeSourceHints(source) {
  const hints = new Set();
  if (['广告', '跳过', '会员免广告', '倒计时'].some((text) => source.includes(text))) {
    hints.add('ad');
  }
  if (['收银台', '微信支付', '支付宝', '确认支付', '连续包月'].some((text) => source.includes(text))) {
    hints.add('cashier');
  }
  if (['搜索', '热搜榜', '猜你想搜', 'search_textField'].some((text) => source.includes(text))) {
    hints.add('search');
  }
  if (['暂停', '全屏', '倍速', '清晰度', '选集'].some((text) => source.includes(text))) {
    hints.add('player');
  }
  return [...hints];
}

async function runSearchBatch(step, context) {
  const keywords = step.keywords ?? context.params.keywords ?? [];
  if (!Array.isArray(keywords) || keywords.length === 0) {
    throw new Error('searchBatch requires a non-empty keywords array.');
  }
  for (const keyword of keywords) {
    await relaunchToHome(context.sessionId);
    await waitAndCloseStartupAd({...step, timeoutMs: DEFAULT_AD_TIMEOUT_MS}, context);
    await dismissCommonPopups(context.sessionId);
    await searchKeyword(context.sessionId, keyword);
    await assertAnyText(context.sessionId, step.resultTexts ?? [keyword, '播放', '相关影视作品'], {
      timeoutMs: step.timeoutMs ?? 12000,
    });
    if (step.saveArtifacts !== false) {
      const safeKeyword = safeName(keyword);
      await saveScreenshot(context.sessionId, `search-${safeKeyword}.png`);
      await saveSource(context.sessionId, `search-${safeKeyword}.xml`);
    }
  }
}

async function clickText(sessionId, text) {
  const elementId = await findTextElement(sessionId, text);
  if (!elementId) {
    throw new Error(`Could not find clickable text: ${text}`);
  }
  await clickElement(sessionId, elementId);
}

async function clickAnyText(sessionId, texts, {required = true} = {}) {
  for (const text of texts) {
    const elementId = await findTextElement(sessionId, text);
    if (elementId) {
      await clickElement(sessionId, elementId);
      return text;
    }
  }
  if (required) {
    throw new Error(`Could not find any clickable text: ${texts.join(', ')}`);
  }
  return null;
}

async function clickAnyTextContaining(sessionId, texts, {required = true} = {}) {
  for (const text of texts) {
    const elementId = await findTextContainingElement(sessionId, text);
    if (elementId) {
      await clickElement(sessionId, elementId);
      return text;
    }
  }
  if (required) {
    throw new Error(`Could not find any clickable text containing: ${texts.join(', ')}`);
  }
  return null;
}

async function findTextElement(sessionId, text) {
  const candidates = [text, ` ${text}`, `${text} `];
  for (const candidate of candidates) {
    const elementId = await findOptionalElement(sessionId, 'accessibility id', candidate);
    if (elementId) {
      return elementId;
    }
  }

  const escaped = String(text).replace(/'/g, "\\'");
  return findOptionalElement(
    sessionId,
    '-ios predicate string',
    `name == '${escaped}' OR label == '${escaped}' OR value == '${escaped}'`
  );
}

async function findTextContainingElement(sessionId, text) {
  const exactElementId = await findTextElement(sessionId, text);
  if (exactElementId) {
    return exactElementId;
  }
  const escaped = String(text).replace(/'/g, "\\'");
  return findOptionalElement(
    sessionId,
    '-ios predicate string',
    `name CONTAINS '${escaped}' OR label CONTAINS '${escaped}' OR value CONTAINS '${escaped}'`
  );
}

async function clickOptionalTexts(step, context) {
  const texts = step.texts ?? [];
  const settleMs = step.settleMs ?? 900;
  const shouldGoBack = step.backAfterClick !== false;
  for (const text of texts) {
    const clicked = await clickAnyText(context.sessionId, [text], {required: false});
    if (!clicked) {
      console.log(`    - skipped missing button: ${text}`);
      continue;
    }
    console.log(`    - clicked: ${text}`);
    await sleep(settleMs);
    if (step.saveArtifacts) {
      await saveScreenshot(context.sessionId, `${safeName(context.case.id)}-${safeName(text)}.png`);
    }
    if (shouldGoBack) {
      await closeOrBack({waitMs: settleMs, fallback: true}, context);
    }
  }
}

async function closeOrBack(step, context) {
  const clicked = await clickCloseOrBackControl(context.sessionId, {
    includeClose: step.includeClose !== false,
    includeBack: step.includeBack !== false,
    fallback: step.fallback !== false,
    waitMs: step.waitMs ?? 1000,
    maxY: step.maxY ?? 180,
  });
  if (!clicked && step.required !== false) {
    throw new Error('Could not find close/back control.');
  }
  if (clicked) {
    console.log(`    - close/back: ${clicked}`);
  }
}

async function tapPercent(sessionId, xPercent, yPercent) {
  const rect = await getWindowRect(sessionId);
  await tap(
    sessionId,
    Math.round(rect.width * xPercent + rect.x),
    Math.round(rect.height * yPercent + rect.y)
  );
}

async function swipePercent(sessionId, step) {
  const rect = await getWindowRect(sessionId);
  const from = step.from ?? {};
  const to = step.to ?? {};
  await request(`/session/${sessionId}/actions`, {
    method: 'POST',
    body: {
      actions: [
        {
          type: 'pointer',
          id: `swipe-${Date.now()}`,
          parameters: {pointerType: 'touch'},
          actions: [
            {
              type: 'pointerMove',
              duration: 0,
              x: Math.round(rect.width * Number(from.x ?? 0.5) + rect.x),
              y: Math.round(rect.height * Number(from.y ?? 0.7) + rect.y),
            },
            {type: 'pointerDown', button: 0},
            {
              type: 'pointerMove',
              duration: Number(step.durationMs ?? 450),
              x: Math.round(rect.width * Number(to.x ?? 0.5) + rect.x),
              y: Math.round(rect.height * Number(to.y ?? 0.25) + rect.y),
            },
            {type: 'pointerUp', button: 0},
          ],
        },
      ],
    },
  });
}

async function homeTabSweep(step, context) {
  const tabs = step.tabs ?? context.params.tabs ?? [];
  if (!Array.isArray(tabs) || tabs.length === 0) {
    throw new Error('homeTabSweep requires a non-empty tabs array.');
  }

  const sessionId = context.sessionId;
  const swipeCount = Number(step.swipeCount ?? 2);
  const cardTapPoints = step.cardTapPoints ?? [
    {x: 0.5, y: 0.45},
    {x: 0.72, y: 0.48},
    {x: 0.5, y: 0.62},
    {x: 0.72, y: 0.64},
    {x: 0.5, y: 0.76},
  ];
  const excludedTapZones = step.excludedTapZones ?? [
    {name: 'left floating button', xMin: 0, xMax: 0.22, yMin: 0.28, yMax: 0.92},
    {name: 'bottom navigation', xMin: 0, xMax: 1, yMin: 0.9, yMax: 1},
    {name: 'top navigation', xMin: 0, xMax: 1, yMin: 0, yMax: 0.18},
  ];

  for (const tabName of tabs) {
    await dismissCommonPopups(sessionId);
    const clickedTab = await clickAnyText(sessionId, [tabName], {required: false});
    if (!clickedTab) {
      console.log(`    - skipped missing home tab: ${tabName}`);
      continue;
    }

    console.log(`    - home tab: ${tabName}`);
    await sleep(step.tabSettleMs ?? 900);

    for (let index = 0; index < swipeCount; index += 1) {
      await swipePercent(sessionId, {
        from: step.swipeFrom ?? {x: 0.5, y: 0.78},
        to: step.swipeTo ?? {x: 0.5, y: 0.34},
        durationMs: step.swipeDurationMs ?? 180,
      });
      await sleep(step.swipeWaitMs ?? 250);
    }

    const point = pickSafeStablePoint(cardTapPoints, `${context.case.id}:${tabName}`, excludedTapZones);
    console.log(`    - random card tap: ${tabName} @ ${point.x},${point.y}`);
    await tapPercent(sessionId, Number(point.x), Number(point.y));
    await sleep(step.cardDisplayMs ?? 1500);

    if (step.saveArtifacts) {
      await saveScreenshot(sessionId, `${safeName(context.case.id)}-${safeName(tabName)}-card.png`);
    }

    await closeOrBack({waitMs: step.backWaitMs ?? 900, fallback: true, required: false}, context);
  }
}

function pickSafeStablePoint(points, seedText, excludedZones = []) {
  const safePoints = (Array.isArray(points) ? points : []).filter(
    (point) => !excludedZones.some((zone) => isPointInZone(point, zone))
  );
  if (safePoints.length === 0) {
    return {x: 0.5, y: 0.62};
  }
  let hash = 0;
  for (const char of String(seedText)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return safePoints[hash % safePoints.length];
}

function isPointInZone(point, zone) {
  const x = Number(point.x);
  const y = Number(point.y);
  return (
    x >= Number(zone.xMin ?? 0) &&
    x <= Number(zone.xMax ?? 1) &&
    y >= Number(zone.yMin ?? 0) &&
    y <= Number(zone.yMax ?? 1)
  );
}

async function enterFullscreen(step, context) {
  const sessionId = context.sessionId;
  const clicked = await clickAnyText(sessionId, step.texts ?? ['全屏'], {required: false});
  if (!clicked) {
    await tapPercent(sessionId, step.fallbackX ?? 0.93, step.fallbackY ?? 0.26);
  }
  await sleep(step.waitMs ?? 1500);
  if (step.assertTexts?.length) {
    await assertAnyText(sessionId, step.assertTexts, step);
  }
}

async function playAndAssert(step, context) {
  const sessionId = context.sessionId;
  const playingTexts = step.playingTexts ?? ['暂停', '全屏', '倍速', '选集', '清晰度'];
  const currentSource = await getSource(sessionId);
  if (!playingTexts.some((text) => currentSource.includes(text))) {
    await clickAnyText(sessionId, step.playTexts ?? ['播放', '立即播放', '继续播放'], {
      required: step.required !== false,
    });
  }
  await sleep(step.waitMs ?? 2500);
  await assertAnyText(sessionId, playingTexts, step);
}

const AD_TEXTS = [
  '广告',
  '跳过',
  '跳过广告',
  '会员免广告',
  '倒计时',
  '了解详情',
  '立即开通',
  '开通会员',
  '试看',
];

const AD_CLOSE_TEXTS = [
  '跳过',
  '跳过广告',
  '关闭广告',
  '关闭',
  'X',
  'x',
  '×',
  '✕',
  '暂不',
  '以后再说',
  '我知道了',
];

const CASHIER_TEXTS = [
  '收银台',
  '确认支付',
  '微信支付',
  '支付宝',
  '连续包月',
  '立即开通',
  '会员权益',
  '开通会员',
  'VIP',
];

async function playerGestureSuite(step, context) {
  const sessionId = context.sessionId;
  await dismissCommonPopups(sessionId).catch(() => {});

  if (step.revealControls !== false) {
    await tapPercent(sessionId, step.centerX ?? 0.5, step.centerY ?? 0.5);
    await sleep(step.revealWaitMs ?? 600);
  }

  const gestures = step.gestures ?? ['doubleTapRight', 'doubleTapLeft', 'longPress', 'dragProgress'];
  for (const gesture of gestures) {
    if (gesture === 'doubleTapRight') {
      console.log('    - player gesture: double tap right');
      await doubleTapPercent(sessionId, step.rightX ?? 0.72, step.tapY ?? 0.5, step);
    } else if (gesture === 'doubleTapLeft') {
      console.log('    - player gesture: double tap left');
      await doubleTapPercent(sessionId, step.leftX ?? 0.28, step.tapY ?? 0.5, step);
    } else if (gesture === 'doubleTapCenter') {
      console.log('    - player gesture: double tap center');
      await doubleTapPercent(sessionId, step.centerX ?? 0.5, step.centerY ?? 0.5, step);
    } else if (gesture === 'longPress') {
      console.log('    - player gesture: long press');
      await longPressPercent(sessionId, step.centerX ?? 0.5, step.centerY ?? 0.5, {
        ...step,
        durationMs: step.longPressMs ?? 800,
      });
    } else if (gesture === 'dragProgress') {
      console.log('    - player gesture: drag progress');
      await dragProgressBar({...step, required: false, assertTexts: []}, context);
    }
    await sleep(step.gestureWaitMs ?? 700);
  }

  if (step.assertTexts?.length) {
    await assertAnyTextMaybe(sessionId, step.assertTexts, step);
  }

  if (step.saveArtifacts) {
    await saveScreenshot(sessionId, step.filename ?? `${safeName(context.case.id)}-player-gestures.png`);
  }
}

async function dragProgressBar(step, context) {
  const sessionId = context.sessionId;
  if (step.revealControls !== false) {
    await tapPercent(sessionId, step.centerX ?? 0.5, step.centerY ?? 0.5);
    await sleep(step.revealWaitMs ?? 500);
  }

  const y = Number(step.y ?? step.progressY ?? 0.84);
  await dragPercent(
    sessionId,
    step.from ?? {x: step.fromX ?? 0.32, y},
    step.to ?? {x: step.toX ?? 0.68, y},
    {durationMs: step.durationMs ?? 650, holdMs: step.holdMs ?? 180}
  );
  await sleep(step.waitMs ?? 1200);

  if (step.assertTexts?.length) {
    await assertAnyTextMaybe(sessionId, step.assertTexts, step);
  }
  if (step.saveArtifacts) {
    await saveScreenshot(sessionId, step.filename ?? `${safeName(context.case.id)}-progress-drag.png`);
  }
}

async function waitForAd(step, context) {
  const texts = step.texts ?? AD_TEXTS;
  const source = await waitForConditionSource(context.sessionId, {
    timeoutMs: step.timeoutMs ?? 8000,
    intervalMs: step.intervalMs ?? 800,
  }, (currentSource) => texts.some((text) => currentSource.includes(text)));

  context.shared.adDetected = Boolean(source);
  if (source) {
    console.log(`    - ad detected: ${texts.find((text) => source.includes(text)) ?? 'matched'}`);
    if (step.saveArtifacts) {
      await saveScreenshot(context.sessionId, step.filename ?? `${safeName(context.case.id)}-ad.png`);
    }
    return source;
  }

  console.log('    - no ad detected in current window');
  if (step.required === true) {
    throw new Error(`Expected ad text did not appear: ${texts.join(', ')}`);
  }
  return null;
}

async function closeAd(step, context) {
  const closeTexts = prioritizeAdCloseTexts(step.texts ?? AD_CLOSE_TEXTS);
  const clickedText = await clickAnyText(context.sessionId, closeTexts, {required: false});
  if (clickedText) {
    console.log(`    - closed ad by text: ${clickedText}`);
    await sleep(step.waitMs ?? 300);
    return clickedText;
  }

  const chromeControl = await clickCloseOrBackControl(context.sessionId, {
    includeClose: true,
    includeBack: false,
    fallback: false,
    waitMs: step.waitMs ?? 300,
    maxY: step.maxY ?? 220,
  });
  if (chromeControl) {
    console.log(`    - closed ad by control: ${chromeControl}`);
    return chromeControl;
  }

  if (step.fallbackTap) {
    await tapPercent(context.sessionId, step.fallbackX ?? 0.92, step.fallbackY ?? 0.12);
    await sleep(step.waitMs ?? 300);
    return 'fallbackTap';
  }

  console.log('    - no ad close control found');
  if (step.required === true) {
    throw new Error('Could not find ad close/skip control.');
  }
  return null;
}

async function waitAndCloseAd(step, context) {
  if (step.preferSkip !== false) {
    const quickClosed = await closeAd({
      ...step,
      texts: step.skipTexts ?? AD_SKIP_TEXTS,
      waitMs: step.skipWaitMs ?? 200,
    }, context);
    if (quickClosed) {
      return quickClosed;
    }
  }

  const timeoutMs = Number(step.timeoutMs ?? 8000);
  const intervalMs = Number(step.intervalMs ?? 500);
  const deadline = Date.now() + timeoutMs;
  let detectedSource = null;

  while (Date.now() < deadline) {
    const source = await getSource(context.sessionId);
    const closed = await closeAd({
      ...step,
      texts: sourceHasAdText(source, step.texts ?? AD_TEXTS) ? step.texts ?? AD_CLOSE_TEXTS : step.skipTexts ?? AD_SKIP_TEXTS,
      waitMs: step.skipWaitMs ?? 200,
    }, context);
    if (closed) {
      context.shared.adDetected = true;
      return closed;
    }
    if (sourceHasAdText(source, step.texts ?? AD_TEXTS)) {
      detectedSource = source;
      context.shared.adDetected = true;
      if (step.saveArtifacts) {
        await saveScreenshot(context.sessionId, step.filename ?? `${safeName(context.case.id)}-ad.png`);
      }
    }
    if (!detectedSource && step.closeWhenMissing !== true) {
      await sleep(intervalMs);
      continue;
    }
    await sleep(intervalMs);
  }

  if (detectedSource) {
    return closeAd(step, context);
  }
  if (step.closeWhenMissing === true) {
    return closeAd(step, context);
  }
  return null;
}

const AD_SKIP_TEXTS = ['跳过', '跳过广告', '跳过  广告', 'skip', 'Skip'];
const HOME_ANCHOR_TEXTS = ['刷片', '首页测试', '找片', '搜索', '会员', '好片', '标签页栏'];

async function coldStartHomeOnly(step, context) {
  const sessionId = context.sessionId;
  const timeoutMs = Number(step.timeoutMs ?? 6500);
  const homeTexts = step.homeTexts ?? HOME_ANCHOR_TEXTS;
  const skipTexts = step.skipTexts ?? AD_SKIP_TEXTS;
  let clickedSkip = false;

  await terminateApp(sessionId, step.bundleId || APP_BUNDLE_ID).catch(() => {});
  await sleep(Number(step.afterTerminateMs ?? 5000));
  await activateApp(sessionId, step.bundleId || APP_BUNDLE_ID);
  await sleep(Number(step.afterActivateMs ?? 1200));

  const skipProbeCount = Number(step.skipProbeCount ?? 2);
  for (let index = 0; index < skipProbeCount; index += 1) {
    const clickedText = await clickAnyTextContaining(sessionId, skipTexts, {required: false}).catch(() => null);
    if (clickedText) {
      clickedSkip = true;
      console.log(`    - startup ad skipped: ${clickedText}`);
      await sleep(Number(step.afterSkipMs ?? 900));
      break;
    }
    await sleep(Number(step.skipProbeIntervalMs ?? 700));
  }

  const source = await getFastSource(sessionId, Number(step.sourceTimeoutMs ?? timeoutMs)).catch((error) => {
    console.warn(`    - source confirm skipped: ${String(error?.message ?? error)}`);
    return '';
  });
  if (source && homeTexts.some((text) => source.includes(text))) {
    return finishColdStartCycle(
      step,
      context,
      clickedSkip ? '冷启动完成，已跳过广告并看到首页。' : '冷启动完成，看到首页。'
    );
  }
  if (source && (source.includes(`bundleId="${APP_BUNDLE_ID}"`) || source.includes(`label="${APP_NAME}"`))) {
    if (step.passOnAppVisible !== false) {
      return finishColdStartCycle(
        step,
        context,
        clickedSkip ? '已跳过广告，App 已回到可采集页面。' : '冷启动完成，App 已回到可采集页面。'
      );
    }
  }

  if (step.passOnScreenshot !== false) {
    await request(`/session/${sessionId}/screenshot`, {timeoutMs: Number(step.screenshotTimeoutMs ?? 5000)}).catch(
      (error) => {
        throw new Error(`冷启动后截图确认失败：${String(error?.message ?? error)}`);
      }
    );
    return finishColdStartCycle(
      step,
      context,
      clickedSkip ? '已跳过广告，截图确认 App 启动完成。' : '截图确认 App 启动完成。'
    );
  }

  if (step.required === false) {
    return clickedSkip ? '已跳过广告，但未确认首页锚点。' : '未确认首页锚点。';
  }
  throw new Error(`冷启动后未看到首页锚点：${homeTexts.join(', ')}`);
}

async function finishColdStartCycle(step, context, message) {
  const sessionId = context.sessionId;
  const bundleId = step.bundleId || APP_BUNDLE_ID;
  if (step.backgroundBeforeNext !== false) {
    const seconds = Number(step.backgroundSeconds ?? 0.5);
    await backgroundApp(sessionId, seconds);
    await sleep(Number(step.afterBackgroundReturnMs ?? 0));
    await activateApp(sessionId, bundleId);
    await sleep(Number(step.afterForegroundMs ?? 100));
  }
  if (step.terminateAfterCycle !== false) {
    await terminateApp(sessionId, bundleId).catch((error) => {
      console.warn(`    - terminate after cycle skipped: ${String(error?.message ?? error)}`);
    });
  }
  return `${message} 已回到后台 ${Number(step.backgroundSeconds ?? 0.5)}s、回前台并结束 App，准备下一轮冷启动。`;
}

async function getFastSource(sessionId, timeoutMs = 2000) {
  const response = await request(`/session/${sessionId}/source`, {timeoutMs});
  return response.value ?? '';
}

function prioritizeAdCloseTexts(texts) {
  const values = Array.isArray(texts) ? texts : [];
  return [...new Set([...AD_SKIP_TEXTS, ...values, ...AD_CLOSE_TEXTS])];
}

function sourceHasAdText(source, texts) {
  return (Array.isArray(texts) ? texts : []).some((text) => source.includes(text));
}

async function openCashierAndAssert(step, context) {
  const entryTexts = step.entryTexts ?? ['会员免广告', '开通会员', '立即开通', 'VIP', '会员', '购买', '用券购买'];
  const clicked = await clickAnyText(context.sessionId, entryTexts, {required: false});
  if (!clicked) {
    console.log(`    - skipped cashier: missing entry ${entryTexts.join(', ')}`);
    if (step.required === true) {
      throw new Error(`Could not find cashier entry: ${entryTexts.join(', ')}`);
    }
    return null;
  }

  console.log(`    - cashier entry: ${clicked}`);
  await sleep(step.waitMs ?? 1800);
  const source = await assertCashier({...step, required: step.required !== false}, context);
  if (step.closeAfterAssert !== false) {
    await closeOrBack({fallback: true, required: false, waitMs: step.backWaitMs ?? 1000}, context);
  }
  return source;
}

async function assertCashier(step, context) {
  const texts = step.texts ?? CASHIER_TEXTS;
  const source = await waitForConditionSource(context.sessionId, {
    timeoutMs: step.timeoutMs ?? 10000,
    intervalMs: step.intervalMs ?? 900,
  }, (currentSource) => texts.some((text) => currentSource.includes(text)));

  if (!source) {
    console.log('    - cashier page was not detected');
    if (step.required === true) {
      throw new Error(`Expected cashier text did not appear: ${texts.join(', ')}`);
    }
    return null;
  }

  console.log(`    - cashier detected: ${texts.find((text) => source.includes(text)) ?? 'matched'}`);
  if (step.saveArtifacts) {
    await saveScreenshot(context.sessionId, step.filename ?? `${safeName(context.case.id)}-cashier.png`);
  }
  return source;
}

async function assertAnyTextMaybe(sessionId, texts, step = {}) {
  const source = await waitForConditionSource(sessionId, step, (currentSource) =>
    texts.some((text) => currentSource.includes(text))
  );
  if (!source && step.required === true) {
    throw new Error(`Expected any text to appear: ${texts.join(', ')}`);
  }
  return source;
}

async function assertText(sessionId, text, step = {}) {
  const source = await waitForTextOrThrow(sessionId, text, step);
  return source;
}

async function assertAllText(sessionId, texts, step = {}) {
  for (const text of texts) {
    await assertText(sessionId, text, step);
  }
}

async function assertAnyText(sessionId, texts, step = {}) {
  const source = await waitForConditionSource(sessionId, step, (currentSource) =>
    texts.some((text) => currentSource.includes(text))
  );
  if (!source) {
    if (step.required === false) {
      console.log(`    - optional text not found: ${texts.join(', ')}`);
      return null;
    }
    throw new Error(`Expected any text to appear: ${texts.join(', ')}`);
  }
  return source;
}

async function assertNotText(sessionId, text) {
  const source = await getSource(sessionId);
  if (source.includes(text)) {
    throw new Error(`Unexpected text appeared: ${text}`);
  }
}

async function waitForTextOrThrow(sessionId, text, step = {}) {
  const source = await waitForConditionSource(sessionId, step, (currentSource) =>
    currentSource.includes(text)
  );
  if (!source) {
    throw new Error(`Expected text did not appear: ${text}`);
  }
  return source;
}

async function waitForConditionSource(sessionId, step, checker) {
  const timeoutMs = Number(step.timeoutMs ?? 12000);
  const intervalMs = Number(step.intervalMs ?? 1000);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const source = await getSource(sessionId);
    if (checker(source)) {
      return source;
    }
    await sleep(intervalMs);
  }
  return null;
}

async function saveFailureArtifacts(context) {
  const prefix = `${safeName(context.case.id)}-step-${context.stepIndex}-failure`;
  await saveScreenshot(context.sessionId, `${prefix}.png`).catch(() => {});
  await saveSource(context.sessionId, `${prefix}.xml`).catch(() => {});
}

function resolveTemplates(value, context) {
  if (typeof value === 'string') {
    const exactMatch = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(value);
    if (exactMatch) {
      const exactValue = readContextValue(exactMatch[1], context);
      return exactValue == null ? '' : exactValue;
    }
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, keyPath) => {
      const cursor = readContextValue(keyPath, context);
      return cursor == null ? '' : String(cursor);
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplates(item, context));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveTemplates(item, context)]));
  }
  return value;
}

function readContextValue(keyPath, context) {
  const keys = keyPath.split('.');
  let cursor = {
    case: context.case,
    params: context.params,
    shared: context.shared,
    runId: context.runId,
    stepIndex: context.stepIndex,
  };
  for (const key of keys) {
    cursor = cursor?.[key];
  }
  return cursor;
}

function artifactName(context, extension) {
  return `${safeName(context.case.id)}-${String(context.stepIndex).padStart(2, '0')}.${extension}`;
}

function requireValue(value, field) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required step field: ${field}`);
  }
  return value;
}

function safeName(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
