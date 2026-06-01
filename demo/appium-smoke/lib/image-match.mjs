import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

import {PNG} from 'pngjs';

import {CASE_DATA_DIR} from './case-store.mjs';
import {doubleTapPercent, getScreenshotBase64, getWindowRect, longPressPercent, sleep, tap} from './appium-ios-helpers.mjs';

const execFileAsync = promisify(execFile);
const TEMPLATE_CACHE = new Map();
const DEFAULT_MATCH_TIMEOUT_MS = Number(process.env.IMAGE_MATCH_TIMEOUT_MS ?? '5000');
const DEFAULT_MATCH_INTERVAL_MS = Number(process.env.IMAGE_MATCH_INTERVAL_MS ?? '450');
const DEFAULT_MATCH_THRESHOLD = Number(process.env.IMAGE_MATCH_THRESHOLD ?? '0.94');
const MIN_ALPHA = 16;

export async function findImageMatchAny(sessionId, step = {}) {
  const candidates = await normalizeCandidates(step);
  if (candidates.length === 0) {
    throw new Error('imageMatchAny requires an `images` or `candidates` array.');
  }

  const timeoutMs = Number(step.timeoutMs ?? DEFAULT_MATCH_TIMEOUT_MS);
  const intervalMs = Number(step.intervalMs ?? DEFAULT_MATCH_INTERVAL_MS);
  const threshold = Number(step.threshold ?? DEFAULT_MATCH_THRESHOLD);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const screenshot = await loadScreenshot(sessionId);
    for (const candidate of candidates) {
      const match = findTemplateMatch(screenshot, candidate.template, {
        threshold: Number(candidate.threshold ?? threshold),
        searchRect: candidate.searchRect ?? step.searchRect ?? step.region,
      });
      if (match) {
        return {
          ...match,
          candidate: {
            image: candidate.image,
            name: candidate.name,
            action: candidate.action,
          },
          screenshotWidth: screenshot.width,
          screenshotHeight: screenshot.height,
        };
      }
    }
    await sleep(intervalMs);
  }

  return null;
}

export async function performImageMatchAction(sessionId, match, step = {}) {
  if (!match) {
    throw new Error('Missing image match result.');
  }

  const action = normalizeAction(match.candidate?.action ?? step.matchAction ?? 'click');
  const rect = await getWindowRect(sessionId);
  const scaleX = match.screenshotWidth / rect.width;
  const scaleY = match.screenshotHeight / rect.height;
  const centerX = rect.x + (match.x + match.width / 2) / scaleX;
  const centerY = rect.y + (match.y + match.height / 2) / scaleY;
  const xPercent = (centerX - rect.x) / rect.width;
  const yPercent = (centerY - rect.y) / rect.height;

  if (action === 'click' || action === 'tap') {
    await tap(sessionId, Math.round(centerX), Math.round(centerY));
    return '点击';
  }
  if (action === 'doubletap' || action === 'doubleclick') {
    await doubleTapPercent(sessionId, xPercent, yPercent, step);
    return '双击';
  }
  if (action === 'longpress') {
    await longPressPercent(sessionId, xPercent, yPercent, {
      ...step,
      durationMs: Number(match.candidate?.longPressMs ?? step.longPressMs ?? 800),
    });
    return '长按';
  }

  throw new Error(`Unsupported image match action: ${match.candidate?.action ?? step.matchAction}`);
}

async function normalizeCandidates(step) {
  const rawCandidates = Array.isArray(step.candidates)
    ? step.candidates
    : Array.isArray(step.images)
      ? step.images.map((image) => ({image}))
      : step.image || step.path
        ? [{image: step.image ?? step.path}]
        : [];

  const candidates = [];
  for (const item of rawCandidates) {
    const image = resolveImagePath(item.image ?? item.path ?? item.src ?? '');
    if (!image) {
      continue;
    }
    candidates.push({
      image,
      name: String(item.name ?? item.label ?? path.basename(image)),
      action: item.action ?? step.matchAction ?? step.actionType ?? 'click',
      threshold: item.threshold,
      searchRect: item.searchRect ?? item.region,
      longPressMs: item.longPressMs,
      template: await loadTemplate(image),
    });
  }
  return candidates;
}

function resolveImagePath(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  if (path.isAbsolute(raw)) {
    return raw;
  }
  if (raw.startsWith('/uploads/')) {
    return path.join(CASE_DATA_DIR, raw);
  }
  if (raw.startsWith('uploads/')) {
    return path.resolve(CASE_DATA_DIR, raw);
  }
  if (raw.startsWith('case-data/')) {
    return path.resolve(path.dirname(CASE_DATA_DIR), raw);
  }
  return path.resolve(CASE_DATA_DIR, raw);
}

async function loadTemplate(imagePath) {
  const fileStat = await stat(imagePath);
  const cacheKey = `${imagePath}:${fileStat.mtimeMs}:${fileStat.size}`;
  const cached = TEMPLATE_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const buffer = await readImageBuffer(imagePath);
  const png = PNG.sync.read(buffer);
  const template = buildImageData(png, imagePath);
  TEMPLATE_CACHE.set(cacheKey, template);
  return template;
}

async function readImageBuffer(imagePath) {
  if (path.extname(imagePath).toLowerCase() === '.png') {
    return readFile(imagePath);
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'codex-image-match-'));
  const outputPath = path.join(tempDir, `${path.basename(imagePath, path.extname(imagePath)) || 'image'}.png`);
  try {
    await execFileAsync('sips', ['-s', 'format', 'png', imagePath, '--out', outputPath], {maxBuffer: 10 * 1024 * 1024});
    return await readFile(outputPath);
  } finally {
    await rm(tempDir, {recursive: true, force: true}).catch(() => {});
  }
}

async function loadScreenshot(sessionId) {
  const png = PNG.sync.read(Buffer.from(await getScreenshotBase64(sessionId), 'base64'));
  return buildImageData(png, 'screenshot');
}

function buildImageData(png, source) {
  const {width, height, data} = png;
  const gray = new Uint8Array(width * height);
  const alpha = new Uint8Array(width * height);
  let opaqueCount = 0;

  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    const a = data[index + 3];
    alpha[pixel] = a;
    if (a >= MIN_ALPHA) {
      gray[pixel] = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
      opaqueCount += 1;
    }
  }

  return {
    source,
    width,
    height,
    gray,
    alpha,
    opaqueCount,
    sampleOffsets: buildSampleOffsets(width, height),
  };
}

function buildSampleOffsets(width, height) {
  const candidates = [
    [0, 0],
    [Math.floor(width / 2), 0],
    [width - 1, 0],
    [0, Math.floor(height / 2)],
    [Math.floor(width / 2), Math.floor(height / 2)],
    [width - 1, Math.floor(height / 2)],
    [0, height - 1],
    [Math.floor(width / 2), height - 1],
    [width - 1, height - 1],
    [Math.floor(width * 0.25), Math.floor(height * 0.25)],
    [Math.floor(width * 0.75), Math.floor(height * 0.25)],
    [Math.floor(width * 0.25), Math.floor(height * 0.75)],
    [Math.floor(width * 0.75), Math.floor(height * 0.75)],
  ];
  const seen = new Set();
  return candidates
    .map(([x, y]) => ({x: clamp(x, 0, width - 1), y: clamp(y, 0, height - 1)}))
    .filter((point) => {
      const key = `${point.x}:${point.y}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function findTemplateMatch(screenshot, template, options = {}) {
  if (template.width > screenshot.width || template.height > screenshot.height) {
    return null;
  }

  const region = resolveRegion(options.searchRect, screenshot);
  if (!region) {
    return null;
  }

  const maxX = region.x + region.width - template.width;
  const maxY = region.y + region.height - template.height;
  if (maxX < region.x || maxY < region.y) {
    return null;
  }

  const threshold = clamp(Number(options.threshold ?? DEFAULT_MATCH_THRESHOLD), 0, 1);
  const maxDiff = Math.floor((1 - threshold) * template.opaqueCount * 255);
  const sampleTolerance = Math.max(18, Math.floor((1 - threshold) * 255 * 2.25));

  for (let y = region.y; y <= maxY; y += 1) {
    for (let x = region.x; x <= maxX; x += 1) {
      if (!quickPass(screenshot, template, x, y, sampleTolerance)) {
        continue;
      }
      const score = fullScore(screenshot, template, x, y, maxDiff, threshold);
      if (score != null) {
        return {
          x,
          y,
          width: template.width,
          height: template.height,
          score,
        };
      }
    }
  }

  return null;
}

function quickPass(screenshot, template, x, y, tolerance) {
  for (const point of template.sampleOffsets) {
    const templateIndex = point.y * template.width + point.x;
    if (template.alpha[templateIndex] < MIN_ALPHA) {
      continue;
    }
    const screenshotIndex = (y + point.y) * screenshot.width + (x + point.x);
    const diff = Math.abs(screenshot.gray[screenshotIndex] - template.gray[templateIndex]);
    if (diff > tolerance) {
      return false;
    }
  }
  return true;
}

function fullScore(screenshot, template, x, y, maxDiff, threshold) {
  if (template.opaqueCount === 0) {
    return null;
  }

  let diff = 0;
  for (let row = 0; row < template.height; row += 1) {
    const templateRow = row * template.width;
    const screenshotRow = (y + row) * screenshot.width + x;
    for (let col = 0; col < template.width; col += 1) {
      const templateIndex = templateRow + col;
      if (template.alpha[templateIndex] < MIN_ALPHA) {
        continue;
      }
      const screenshotIndex = screenshotRow + col;
      diff += Math.abs(screenshot.gray[screenshotIndex] - template.gray[templateIndex]);
      if (diff > maxDiff) {
        return null;
      }
    }
  }

  const score = 1 - diff / (template.opaqueCount * 255);
  return score >= threshold ? Number(score.toFixed(4)) : null;
}

function resolveRegion(region, screenshot) {
  if (!region) {
    return {x: 0, y: 0, width: screenshot.width, height: screenshot.height};
  }

  const x = resolveDimension(region.x ?? 0, screenshot.width);
  const y = resolveDimension(region.y ?? 0, screenshot.height);
  const width = resolveDimension(region.width ?? screenshot.width, screenshot.width);
  const height = resolveDimension(region.height ?? screenshot.height, screenshot.height);
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: clamp(x, 0, Math.max(0, screenshot.width - 1)),
    y: clamp(y, 0, Math.max(0, screenshot.height - 1)),
    width: clamp(width, 1, screenshot.width),
    height: clamp(height, 1, screenshot.height),
  };
}

function resolveDimension(value, total) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  if (number >= 0 && number <= 1) {
    return Math.round(total * number);
  }
  return Math.round(number);
}

function normalizeAction(action) {
  return String(action ?? 'click').toLowerCase().replace(/[\s_-]+/g, '');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
