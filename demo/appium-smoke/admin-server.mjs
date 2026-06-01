import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFile, spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {
  APP_BUNDLE_ID,
  APP_NAME,
  ARTIFACT_DIR,
  DEVICE_UDID,
  TARGET,
  WDA_BASE_URL,
  WDA_LOCAL_PORT,
  createSession,
  deleteSession,
  getScreenshotBase64,
  getWindowRect,
} from './lib/appium-ios-helpers.mjs';
import {
  CASE_DATA_DIR,
  UPLOAD_DIR,
  createCaseId,
  deleteCase,
  ensureCaseDataDirs,
  loadCases,
  upsertCase,
} from './lib/case-store.mjs';

const PORT = Number(process.env.CASE_ADMIN_PORT ?? '5177');
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_DIR = path.join(ROOT, 'admin');
const RUNS = new Map();
let activeRunProcess = null;
let activeRunCancelRequested = false;
const ACTIVE_SESSION_PATH = path.join(ARTIFACT_DIR, 'active-session.json');
let screenSession = null;
let screenSessionStartPromise = null;
let screenCapturePromise = null;
let wdaForwardProcess = null;
let wdaForwardLog = '';
const execFileAsync = promisify(execFile);

await ensureCaseDataDirs();

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    sendJson(response, 500, {error: String(error?.message ?? error)});
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Case admin is running at http://127.0.0.1:${PORT}`);
});

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/api/cases' && request.method === 'GET') {
    sendJson(response, 200, await loadCases());
    return;
  }
  if (url.pathname === '/api/case-stats' && request.method === 'GET') {
    sendJson(response, 200, await loadCaseStats());
    return;
  }
  if (url.pathname === '/api/cases' && request.method === 'POST') {
    const payload = await readJson(request);
    const saved = await upsertCase({...payload, id: payload.id || createCaseId(payload.title)});
    sendJson(response, 201, saved);
    return;
  }
  if (url.pathname.startsWith('/api/cases/') && request.method === 'PUT') {
    const id = decodeURIComponent(url.pathname.replace('/api/cases/', ''));
    const payload = await readJson(request);
    sendJson(response, 200, await upsertCase({...payload, id}));
    return;
  }
  if (url.pathname.startsWith('/api/cases/') && request.method === 'DELETE') {
    const id = decodeURIComponent(url.pathname.replace('/api/cases/', ''));
    sendJson(response, 200, {deleted: await deleteCase(id)});
    return;
  }
  if (url.pathname === '/api/uploads' && request.method === 'POST') {
    sendJson(response, 201, await saveUpload(await readJson(request)));
    return;
  }
  if (url.pathname === '/api/runs' && request.method === 'POST') {
    sendJson(response, 202, await startRun(await readJson(request)));
    return;
  }
  if (url.pathname === '/api/runs/active/stop' && request.method === 'POST') {
    sendJson(response, 200, await stopActiveRun());
    return;
  }
  if (url.pathname.startsWith('/api/runs/') && request.method === 'GET') {
    const id = decodeURIComponent(url.pathname.replace('/api/runs/', ''));
    const run = RUNS.get(id);
    sendJson(response, run ? 200 : 404, run ?? {error: 'Run not found'});
    return;
  }
  if (url.pathname === '/api/device-screen/start' && request.method === 'POST') {
    sendJson(response, 200, await startDeviceScreen());
    return;
  }
  if (url.pathname === '/api/device-screen/screenshot' && request.method === 'GET') {
    sendJson(response, 200, await getDeviceScreen());
    return;
  }
  if (url.pathname === '/api/device-screen/capture' && request.method === 'POST') {
    sendJson(response, 201, await captureDeviceScreen(await readJson(request)));
    return;
  }
  if (url.pathname === '/api/device-screen/stop' && request.method === 'POST') {
    sendJson(response, 200, await stopDeviceScreen());
    return;
  }
  if (url.pathname.startsWith('/uploads/')) {
    await sendFile(response, path.join(CASE_DATA_DIR, url.pathname));
    return;
  }

  const filePath = url.pathname === '/' ? path.join(ADMIN_DIR, 'index.html') : path.join(ADMIN_DIR, url.pathname);
  await sendFile(response, filePath);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {'Content-Type': 'application/json; charset=utf-8'});
  response.end(JSON.stringify(payload));
}

async function sendFile(response, filePath) {
  const resolved = path.resolve(filePath);
  const allowedRoots = [ADMIN_DIR, CASE_DATA_DIR].map((item) => path.resolve(item));
  if (!allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  if (!existsSync(resolved)) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  response.writeHead(200, {'Content-Type': contentType(resolved)});
  response.end(await readFile(resolved));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
    }[ext] ?? 'application/octet-stream'
  );
}

async function saveUpload(payload) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(payload.dataUrl ?? '');
  if (!match) {
    throw new Error('Only base64 image data URLs are supported.');
  }
  const mime = match[1];
  const extension = mime.split('/')[1].replace('jpeg', 'jpg');
  const buffer = Buffer.from(match[2], 'base64');
  const hash = createHash('sha256').update(buffer).digest('hex');
  const existing = await findExistingUploadByHash(hash);
  if (existing) {
    return {...existing, duplicate: true, hash};
  }
  const safeBase = String(payload.filename ?? 'case-image')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]+/g, '-')
    .slice(0, 80);
  const filename = `${safeBase || 'case-image'}-${Date.now().toString(36)}.${extension}`;
  const outputPath = path.join(UPLOAD_DIR, filename);
  await writeFile(outputPath, buffer);
  return {path: `/uploads/${filename}`, filename, duplicate: false, hash};
}

async function findExistingUploadByHash(hash) {
  if (!existsSync(UPLOAD_DIR)) {
    return null;
  }
  const entries = await readdir(UPLOAD_DIR, {withFileTypes: true});
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const filename = entry.name;
    const filePath = path.join(UPLOAD_DIR, filename);
    const fileHash = createHash('sha256').update(await readFile(filePath)).digest('hex');
    if (fileHash === hash) {
      return {path: `/uploads/${filename}`, filename};
    }
  }
  return null;
}

async function loadCaseStats() {
  const runsDir = path.join(ARTIFACT_DIR, 'case-runs');
  const stats = {};
  const reports = [];
  if (!existsSync(runsDir)) {
    return {cases: stats, reports};
  }

  const entries = await readdir(runsDir, {withFileTypes: true});
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const reportPath = path.join(runsDir, entry.name, 'report.json');
    if (!existsSync(reportPath)) {
      continue;
    }
    try {
      const report = JSON.parse(await readFile(reportPath, 'utf8'));
      reports.push({
        runId: report.runId,
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        total: report.total,
        passed: report.passed,
        failed: report.failed,
        durationMs: reportDurationMs(report),
      });
      for (const result of report.results ?? []) {
        const id = result.id;
        if (!id) {
          continue;
        }
        const item =
          stats[id] ??
          (stats[id] = {
            id,
            runs: 0,
            passed: 0,
            failed: 0,
            successRate: 0,
            avgDurationMs: 0,
            minDurationMs: null,
            maxDurationMs: null,
            lastRunAt: '',
            lastStatus: '',
            lastDurationMs: 0,
            lastRunId: '',
            recent: [],
          });
        const durationMs = resultDurationMs(result);
        const passed = result.status === 'passed';
        item.runs += 1;
        item.passed += passed ? 1 : 0;
        item.failed += passed ? 0 : 1;
        item.avgDurationMs += durationMs;
        item.minDurationMs = item.minDurationMs == null ? durationMs : Math.min(item.minDurationMs, durationMs);
        item.maxDurationMs = item.maxDurationMs == null ? durationMs : Math.max(item.maxDurationMs, durationMs);
        const runAt = result.startedAt || report.startedAt || '';
        item.recent.push({
          runId: report.runId,
          status: result.status,
          startedAt: runAt,
          durationMs,
          error: result.error ? String(result.error).split('\n')[0] : '',
        });
        if (!item.lastRunAt || new Date(runAt) >= new Date(item.lastRunAt)) {
          item.lastRunAt = runAt;
          item.lastStatus = result.status;
          item.lastDurationMs = durationMs;
          item.lastRunId = report.runId;
        }
      }
    } catch {
      // Ignore malformed or partially written reports.
    }
  }

  for (const item of Object.values(stats)) {
    item.avgDurationMs = item.runs ? Math.round(item.avgDurationMs / item.runs) : 0;
    item.successRate = item.runs ? Math.round((item.passed / item.runs) * 1000) / 10 : 0;
    item.recent = item.recent
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
      .slice(0, 5);
  }
  reports.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  return {cases: stats, reports};
}

function reportDurationMs(report) {
  const started = Date.parse(report.startedAt ?? '');
  const finished = Date.parse(report.finishedAt ?? '');
  if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) {
    return finished - started;
  }
  return (report.results ?? []).reduce((sum, result) => sum + resultDurationMs(result), 0);
}

function resultDurationMs(result) {
  const started = Date.parse(result.startedAt ?? '');
  const finished = Date.parse(result.finishedAt ?? '');
  if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) {
    return finished - started;
  }
  return (result.steps ?? []).reduce((sum, step) => sum + Number(step.durationMs ?? 0), 0);
}

async function startRun(payload) {
  if (screenSession?.backend === 'appium') {
    await stopDeviceScreen().catch(() => {});
  }
  if (activeRunProcess && !activeRunProcess.killed) {
    throw new Error('已有自动用例正在运行，请先暂停当前任务。');
  }
  const runId = Date.now().toString(36);
  const runCases = await selectRunCases(payload);
  const args = ['./case-runner.mjs'];
  for (const id of payload.ids ?? []) {
    args.push('--id', id);
  }
  for (const tag of payload.tags ?? []) {
    args.push('--tag', tag);
  }
  for (const group of payload.groups ?? []) {
    args.push('--group', group);
  }
  const repeat = normalizeRunRepeat(payload.repeat);
  if (repeat > 1) {
    args.push('--repeat', String(repeat));
  }
  const sessionScope = payload.sessionScope || (repeat > 1 ? 'run' : '');
  if (sessionScope) {
    args.push('--session-scope', String(sessionScope));
  }
  if (payload.includeDisabled) {
    args.push('--include-disabled');
  }

  const run = {
    id: runId,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: '',
    command: `node ${args.join(' ')}`,
    log: '',
    exitCode: null,
    progress: createRunProgress(runCases, repeat),
  };
  Object.defineProperty(run, '_lineBuffer', {value: '', writable: true, configurable: true});
  RUNS.set(runId, run);
  activeRunCancelRequested = false;

  const child = spawn(process.execPath, args, {cwd: ROOT, env: process.env});
  activeRunProcess = child;
  child.stdout.on('data', (chunk) => {
    appendRunOutput(run, chunk.toString());
  });
  child.stderr.on('data', (chunk) => {
    appendRunOutput(run, chunk.toString());
  });
  child.on('close', (code) => {
    const wasCancelled = activeRunCancelRequested;
    if (activeRunProcess === child) {
      activeRunProcess = null;
      activeRunCancelRequested = false;
    }
    if (run._lineBuffer) {
      parseRunLine(run, run._lineBuffer);
      run._lineBuffer = '';
    }
    if (wasCancelled) {
      run.status = 'paused';
      run.exitCode = null;
    } else {
      run.status = code === 0 ? 'passed' : 'failed';
      run.exitCode = code;
    }
    run.finishedAt = new Date().toISOString();
    run.progress.status = run.status;
    if (run.status === 'paused') {
      run.progress.status = 'paused';
    } else {
      run.progress.completedCases = Math.max(run.progress.completedCases, code === 0 ? run.progress.totalCases : run.progress.completedCases);
      run.progress.percent = code === 0 ? 100 : run.progress.percent;
    }
    run.progress.updatedAt = run.finishedAt;
    run._lineBuffer = '';
  });

  return run;
}

async function stopActiveRun() {
  activeRunCancelRequested = true;
  const run = [...RUNS.values()].find((item) => item.status === 'running');
  if (!run) {
    return {stopped: false, reason: 'no-running-run'};
  }
  run.status = 'paused';
  run.finishedAt = new Date().toISOString();
  run.progress.status = 'paused';
  run.progress.currentStepName = '已暂停';
  run.progress.updatedAt = run.finishedAt;
  if (activeRunProcess && !activeRunProcess.killed) {
    activeRunProcess.kill('SIGTERM');
    setTimeout(() => {
      if (activeRunProcess && !activeRunProcess.killed) {
        activeRunProcess.kill('SIGKILL');
      }
    }, 3000).unref?.();
  }
  cleanupActiveRunSession().catch(() => {});
  return {stopped: true, runId: run.id};
}

async function cleanupActiveRunSession() {
  const activeSession = await readActiveSession();
  if (activeSession?.sessionId) {
    await deleteSession(activeSession.sessionId).catch(() => {});
  }
  await rm(ACTIVE_SESSION_PATH, {force: true}).catch(() => {});
}

function normalizeRunRepeat(value) {
  const repeat = Number(value ?? 1);
  if (!Number.isFinite(repeat) || repeat < 1) {
    return 1;
  }
  return Math.min(10000, Math.floor(repeat));
}

async function selectRunCases(payload) {
  const cases = await loadCases();
  const ids = new Set((payload.ids ?? []).filter(Boolean));
  const tags = new Set((payload.tags ?? []).filter(Boolean));
  const groups = new Set((payload.groups ?? []).filter(Boolean));
  return cases.filter((testCase) => {
    if (!payload.includeDisabled && testCase.enabled === false) {
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

function createRunProgress(cases, repeat = 1) {
  const expandedCases = expandProgressCases(cases, repeat);
  return {
    status: 'queued',
    totalCases: expandedCases.length,
    baseCaseCount: cases.length,
    repeat,
    completedCases: 0,
    currentCaseIndex: 0,
    currentCaseId: '',
    currentCaseTitle: '',
    currentCaseGroup: '',
    totalSteps: 0,
    currentStepIndex: 0,
    currentStepName: '',
    completedSteps: 0,
    failedStepName: '',
    percent: 0,
    cases: expandedCases.map((testCase) => ({
      id: testCase.id,
      title: testCase.title,
      group: testCase.group,
      totalSteps: testCase.steps?.length ?? 0,
      status: 'queued',
    })),
    updatedAt: new Date().toISOString(),
  };
}

function expandProgressCases(cases, repeat) {
  if (repeat <= 1) {
    return cases;
  }
  const expanded = [];
  for (let index = 1; index <= repeat; index += 1) {
    for (const testCase of cases) {
      expanded.push({
        ...testCase,
        id: `${testCase.id}#${index}`,
        title: `${testCase.title} · 第 ${index}/${repeat} 次`,
      });
    }
  }
  return expanded;
}

function appendRunOutput(run, text) {
  run.log += text;
  run._lineBuffer = `${run._lineBuffer ?? ''}${text}`;
  const lines = run._lineBuffer.split(/\r?\n/);
  run._lineBuffer = lines.pop() ?? '';
  for (const line of lines) {
    parseRunLine(run, line);
  }
}

function parseRunLine(run, rawLine) {
  const line = rawLine.trimEnd();
  const caseStart = /^▶\s+(.+)\s+\[([^\]]+)\]$/.exec(line.trim());
  if (caseStart) {
    const [, title, id] = caseStart;
    const caseIndex = run.progress.cases.findIndex((item) => item.id === id);
    const current = run.progress.cases[caseIndex] ?? {id, title, group: '', totalSteps: 0};
    current.status = 'running';
    run.progress.status = 'running';
    run.progress.currentCaseIndex = caseIndex >= 0 ? caseIndex + 1 : run.progress.completedCases + 1;
    run.progress.currentCaseId = id;
    run.progress.currentCaseTitle = title;
    run.progress.currentCaseGroup = current.group ?? '';
    run.progress.totalSteps = current.totalSteps ?? 0;
    run.progress.currentStepIndex = 0;
    run.progress.currentStepName = '';
    run.progress.completedSteps = 0;
    run.progress.failedStepName = '';
    updateRunPercent(run);
    return;
  }

  const stepStart = /^\s+(\d+)\.\s+(.+)$/.exec(line);
  if (stepStart) {
    const stepIndex = Number(stepStart[1]);
    run.progress.status = 'running';
    run.progress.currentStepIndex = stepIndex;
    run.progress.currentStepName = stepStart[2];
    run.progress.completedSteps = Math.max(0, stepIndex - 1);
    run.progress.updatedAt = new Date().toISOString();
    updateRunPercent(run);
    return;
  }

  const casePassed = /^✓\s+(.+)$/.exec(line.trim());
  if (casePassed) {
    markCurrentCaseFinished(run, 'passed');
    return;
  }

  const caseFailed = /^✕\s+(.+)$/.exec(line.trim());
  if (caseFailed) {
    markCurrentCaseFinished(run, 'failed');
    return;
  }

  const stepFailed = /^\s*✕\s+(.+)$/.exec(line);
  if (stepFailed && run.progress.currentStepName) {
    run.progress.failedStepName = run.progress.currentStepName;
    run.progress.updatedAt = new Date().toISOString();
  }
}

function markCurrentCaseFinished(run, status) {
  const current = run.progress.cases.find((item) => item.id === run.progress.currentCaseId);
  if (current && current.status === 'running') {
    current.status = status;
  }
  run.progress.completedCases = Math.max(run.progress.completedCases, run.progress.currentCaseIndex);
  run.progress.completedSteps = run.progress.totalSteps;
  run.progress.currentStepName = status === 'passed' ? '用例完成' : run.progress.failedStepName || '用例失败';
  run.progress.status = status === 'failed' ? 'failed' : 'running';
  run.progress.updatedAt = new Date().toISOString();
  updateRunPercent(run);
}

function updateRunPercent(run) {
  const totalUnits = run.progress.cases.reduce(
    (sum, item) => sum + Math.max(1, Number(item.totalSteps ?? 0)),
    0
  );
  const finishedUnits = run.progress.cases.reduce((sum, item) => {
    if (item.status === 'passed' || item.status === 'failed') {
      return sum + Math.max(1, Number(item.totalSteps ?? 0));
    }
    if (item.id === run.progress.currentCaseId) {
      return sum + Math.min(run.progress.completedSteps, Math.max(1, Number(item.totalSteps ?? 0)));
    }
    return sum;
  }, 0);
  run.progress.percent = totalUnits ? Math.min(99, Math.round((finishedUnits / totalUnits) * 100)) : 0;
  run.progress.updatedAt = new Date().toISOString();
}

function hasRunningRun() {
  return [...RUNS.values()].some((run) => run.status === 'running');
}

async function startDeviceScreen() {
  const activeSession = await readActiveSession();
  if (activeSession) {
    screenSession = {
      backend: 'active-appium',
      sessionId: activeSession.sessionId,
      appName: APP_NAME,
      appBundleId: APP_BUNDLE_ID,
      windowRect: null,
      startedAt: new Date().toISOString(),
    };
  }

  if (screenSession) {
    return {
      connected: true,
      sessionId: screenSession.sessionId ?? '',
      backend: screenSession.backend,
      appName: APP_NAME,
      appBundleId: APP_BUNDLE_ID,
      windowRect: screenSession.windowRect,
    };
  }

  if (hasRunningRun()) {
    return pendingRunScreen();
  }

  if (screenSessionStartPromise) {
    return screenSessionStartPromise;
  }

  screenSessionStartPromise = (async () => {
    let wdaScreenshotError = null;
    if (TARGET === 'real-device' && DEVICE_UDID) {
      try {
        const screen = await captureWdaScreenshot();
        screenSession = {
          backend: 'wda-direct',
          sessionId: screen.sessionId ?? '',
          appName: APP_NAME,
          appBundleId: APP_BUNDLE_ID,
          windowRect: screen.windowRect,
          startedAt: new Date().toISOString(),
        };
        return {
          connected: true,
          sessionId: screenSession.sessionId,
          backend: screenSession.backend,
          appName: APP_NAME,
          appBundleId: APP_BUNDLE_ID,
          windowRect: screenSession.windowRect,
        };
      } catch (error) {
        wdaScreenshotError = error;
      }
    }

    let systemScreenshotError = null;
    if (TARGET === 'real-device' && DEVICE_UDID) {
      try {
        const screen = await captureSystemScreenshot();
        screenSession = {
          backend: 'idevicescreenshot',
          appName: APP_NAME,
          appBundleId: APP_BUNDLE_ID,
          windowRect: screen.windowRect,
          startedAt: new Date().toISOString(),
        };
        return {
          connected: true,
          sessionId: '',
          backend: screenSession.backend,
          appName: APP_NAME,
          appBundleId: APP_BUNDLE_ID,
          windowRect: screenSession.windowRect,
        };
      } catch (error) {
        systemScreenshotError = error;
        // Fall back to Appium when the system screenshot service is unavailable.
      }
    }

    if (String(wdaScreenshotError?.message ?? '').includes('Not authorized for performing UI testing actions')) {
      throw new Error(formatDeviceScreenStartError(wdaScreenshotError, systemScreenshotError));
    }

    await stopWdaForwarding({killLocalPort: true});

    let sessionId;
    try {
      sessionId = await createSession();
    } catch (error) {
      throw new Error(formatDeviceScreenStartError(error, systemScreenshotError, wdaScreenshotError));
    }
    const windowRect = await getWindowRect(sessionId).catch(() => null);
    screenSession = {
      backend: 'appium',
      sessionId,
      appName: APP_NAME,
      appBundleId: APP_BUNDLE_ID,
      windowRect,
      startedAt: new Date().toISOString(),
    };
    return {
      connected: true,
      sessionId,
      backend: screenSession.backend,
      appName: APP_NAME,
      appBundleId: APP_BUNDLE_ID,
      windowRect,
    };
  })();

  try {
    return await screenSessionStartPromise;
  } finally {
    screenSessionStartPromise = null;
  }
}

async function getDeviceScreen() {
  if (screenCapturePromise) {
    return screenCapturePromise;
  }
  screenCapturePromise = getDeviceScreenNow();
  try {
    return await screenCapturePromise;
  } finally {
    screenCapturePromise = null;
  }
}

async function getDeviceScreenNow() {
  if (!screenSession) {
    const activeSession = await readActiveSession();
    if (activeSession) {
      screenSession = {
        backend: 'active-appium',
        sessionId: activeSession.sessionId,
        appName: APP_NAME,
        appBundleId: APP_BUNDLE_ID,
        windowRect: null,
        startedAt: new Date().toISOString(),
      };
    }
  }

  if (!screenSession) {
    if (hasRunningRun()) {
      return pendingRunScreen();
    }
    return {connected: false};
  }
  try {
    const captureStartedAt = Date.now();
    const screen =
      screenSession.backend === 'idevicescreenshot'
        ? await captureSystemScreenshot()
        : screenSession.backend === 'wda-direct'
          ? await captureWdaScreenshot(screenSession.sessionId)
        : {
            base64: await getScreenshotBase64(screenSession.sessionId),
            mimeType: 'image/png',
            windowRect: screenSession.windowRect,
          };
    const capturedAt = new Date().toISOString();
    screenSession.windowRect = screen.windowRect ?? screenSession.windowRect;
    return {
      connected: true,
      sessionId: screenSession.sessionId ?? '',
      backend: screenSession.backend,
      appName: screenSession.appName,
      appBundleId: screenSession.appBundleId,
      windowRect: screenSession.windowRect,
      dataUrl: `data:${screen.mimeType};base64,${screen.base64}`,
      capturedAt,
      captureDurationMs: Date.now() - captureStartedAt,
    };
  } catch (error) {
    const staleSessionId = screenSession.sessionId ?? '';
    screenSession = null;
    return {
      connected: false,
      staleSessionId,
      error: String(error?.message ?? error),
    };
  }
}

function pendingRunScreen() {
  return {
    connected: true,
    pending: true,
    sessionId: '',
    backend: 'waiting-active-session',
    appName: APP_NAME,
    appBundleId: APP_BUNDLE_ID,
    windowRect: null,
    message: '用例启动中，等待复用运行会话',
  };
}

function formatDeviceScreenStartError(error, systemScreenshotError, wdaScreenshotError) {
  const message = String(error?.message ?? error);
  const systemMessage = systemScreenshotError ? String(systemScreenshotError?.message ?? systemScreenshotError) : '';
  const wdaMessage = wdaScreenshotError ? String(wdaScreenshotError?.message ?? wdaScreenshotError) : '';
  if (message.includes('Not authorized for performing UI testing actions')) {
    return [
      '手机未授权 UI Testing 自动化操作。',
      '请保持手机解锁，进入手机 设置 > 开发者，确认 UI Automation 已开启；如果弹出 WebDriverAgent / 开发者工具授权提示请点允许。',
      wdaMessage ? `WDA 直连截图也不可用：${wdaMessage}` : '',
      systemMessage ? `系统截图通道也不可用：${systemMessage}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (message.includes('bundle identifier')) {
    return [
      '设备上没有找到当前配置的 App 包名。',
      message,
      wdaMessage ? `WDA 直连截图也不可用：${wdaMessage}` : '',
      systemMessage ? `系统截图通道也不可用：${systemMessage}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (wdaMessage && wdaMessage.includes('Not authorized for performing UI testing actions')) {
    return [
      'WDA 已连接，但手机未授权 UI Testing 自动化操作。',
      '请保持手机解锁，进入手机 设置 > 开发者，确认 UI Automation 已开启；如果弹出 WebDriverAgent / 开发者工具授权提示请点允许。',
      systemMessage ? `系统截图通道也不可用：${systemMessage}` : '',
      message,
    ]
      .filter(Boolean)
      .join(' ');
  }
  if (systemMessage) {
    return `${message}${wdaMessage ? ` WDA 直连截图也不可用：${wdaMessage}` : ''} 系统截图通道也不可用：${systemMessage}`;
  }
  if (wdaMessage) {
    return `${message} WDA 直连截图也不可用：${wdaMessage}`;
  }
  return message;
}

async function captureDeviceScreen(payload) {
  const screen = await getDeviceScreen();
  if (!screen.connected || !screen.dataUrl) {
    throw new Error(screen.error ?? 'Device screen is not connected.');
  }
  const match = /^data:image\/png;base64,(.+)$/.exec(screen.dataUrl);
  const baseName = String(payload.filename ?? `device-screen-${Date.now().toString(36)}`)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]+/g, '-')
    .slice(0, 80);
  const filename = `${baseName || 'device-screen'}.png`;
  await writeFile(path.join(UPLOAD_DIR, filename), Buffer.from(match[1], 'base64'));
  return {
    ...screen,
    path: `/uploads/${filename}`,
    filename,
  };
}

async function stopDeviceScreen() {
  const sessionId = screenSession?.sessionId;
  const backend = screenSession?.backend;
  screenSession = null;
  screenSessionStartPromise = null;
  if (backend === 'appium' && sessionId) {
    await deleteSession(sessionId);
  }
  return {connected: false};
}

async function readActiveSession() {
  if (!existsSync(ACTIVE_SESSION_PATH)) {
    return null;
  }
  try {
    const payload = JSON.parse(await readFile(ACTIVE_SESSION_PATH, 'utf8'));
    if (!payload?.sessionId) {
      return null;
    }
    if (!(await isSessionAlive(payload.sessionId))) {
      await stopDeviceScreen().catch(() => {});
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function isSessionAlive(sessionId) {
  try {
    await request(`/session/${sessionId}/window/rect`, {timeoutMs: 4000});
    return true;
  } catch {
    try {
      await request(`/session/${sessionId}/source`, {timeoutMs: 4000});
      return true;
    } catch {
      return false;
    }
  }
}

async function captureWdaScreenshot(preferredSessionId = '') {
  const status = await ensureWdaReady();
  const sessionId = preferredSessionId || status.sessionId || status.value?.sessionId || '';
  const paths = [
    sessionId ? `/session/${encodeURIComponent(sessionId)}/screenshot` : '',
    '/screenshot',
  ].filter(Boolean);
  let lastError = null;

  for (const pathname of paths) {
    try {
      const payload = await requestWda(pathname, {timeoutMs: 10000});
      const base64 = typeof payload.value === 'string' ? payload.value : payload.value?.screen;
      if (!base64) {
        throw new Error(`WDA screenshot returned no image: ${JSON.stringify(payload).slice(0, 300)}`);
      }
      const bytes = Buffer.from(base64, 'base64');
      return {
        base64,
        mimeType: 'image/png',
        windowRect: readPngRect(bytes),
        sessionId: payload.sessionId || sessionId,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('WDA screenshot failed.');
}

async function ensureWdaReady() {
  try {
    return await getWdaStatus();
  } catch (error) {
    await startWdaForwarding();
    try {
      return await waitForWdaStatus();
    } catch (waitError) {
      await stopWdaForwarding({killLocalPort: true});
      const details = [String(waitError?.message ?? waitError), wdaForwardLog.trim()]
        .filter(Boolean)
        .join(' ');
      throw new Error(`WDA 8100 未连通：${details || String(error?.message ?? error)}`);
    }
  }
}

async function getWdaStatus() {
  const payload = await requestWda('/status', {timeoutMs: 5000, allowWdaError: true});
  if (payload.value?.ready === false || payload.value?.state === 'failure') {
    throw new Error(`WDA is not ready: ${JSON.stringify(payload.value).slice(0, 300)}`);
  }
  return payload;
}

async function waitForWdaStatus(timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await getWdaStatus();
    } catch (error) {
      lastError = error;
      await delay(300);
    }
  }
  throw lastError ?? new Error('Timed out waiting for WDA status.');
}

async function requestWda(pathname, {timeoutMs = 5000, allowWdaError = false} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(joinUrl(WDA_BASE_URL, pathname), {signal: controller.signal});
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    const wdaError = payload.value?.error;
    if (!response.ok || (wdaError && !allowWdaError)) {
      const reason = payload.value?.message || payload.value?.error || text || response.statusText;
      throw new Error(`WDA ${pathname} failed: ${reason}`);
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`WDA ${pathname} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function startWdaForwarding() {
  if (wdaForwardProcess && !wdaForwardProcess.killed) {
    return;
  }
  if (!DEVICE_UDID) {
    throw new Error('缺少 DEVICE_UDID，无法启动 WDA 端口转发。');
  }

  wdaForwardLog = '';
  const localPort = getWdaLocalPort();
  const args = ['-u', DEVICE_UDID, `${localPort}:${WDA_LOCAL_PORT || localPort}`];
  const child = spawn('iproxy', args, {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']});
  wdaForwardProcess = child;
  const collect = (chunk) => {
    wdaForwardLog = `${wdaForwardLog}${chunk.toString()}`.slice(-2000);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('exit', (code, signal) => {
    if (wdaForwardProcess === child) {
      wdaForwardProcess = null;
    }
    if (code || signal) {
      wdaForwardLog = `${wdaForwardLog}\niproxy exited ${code ?? signal}`.slice(-2000);
    }
  });
  await delay(250);
}

async function stopWdaForwarding({killLocalPort = false} = {}) {
  if (wdaForwardProcess && !wdaForwardProcess.killed) {
    wdaForwardProcess.kill();
    wdaForwardProcess = null;
  }
  if (!killLocalPort) {
    return;
  }
  const localPort = getWdaLocalPort();
  const pids = await getListeningPids(localPort);
  await Promise.all(
    pids.map(async (pid) => {
      try {
        process.kill(Number(pid));
      } catch {
        // Ignore a process that exited between lsof and kill.
      }
    })
  );
  if (pids.length) {
    await delay(300);
  }
}

async function getListeningPids(port) {
  try {
    const {stdout} = await execFileAsync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], {
      timeout: 3000,
      maxBuffer: 1024 * 1024,
    });
    return stdout
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getWdaLocalPort() {
  try {
    return Number(new URL(WDA_BASE_URL).port || WDA_LOCAL_PORT || 8100);
  } catch {
    return WDA_LOCAL_PORT || 8100;
  }
}

function joinUrl(baseUrl, pathname) {
  return new URL(pathname, `${baseUrl.replace(/\/$/, '')}/`).toString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureSystemScreenshot() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mgtv-screen-'));
  const outputPath = path.join(tempDir, 'screen.png');
  try {
    await execFileAsync('idevicescreenshot', ['-u', DEVICE_UDID, outputPath], {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    const bytes = await readFile(outputPath);
    return {
      base64: bytes.toString('base64'),
      mimeType: 'image/png',
      windowRect: readPngRect(bytes),
    };
  } finally {
    await rm(tempDir, {recursive: true, force: true});
  }
}

function readPngRect(bytes) {
  const pngSignature = '89504e470d0a1a0a';
  if (bytes.subarray(0, 8).toString('hex') !== pngSignature || bytes.length < 24) {
    return null;
  }
  return {
    x: 0,
    y: 0,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}
