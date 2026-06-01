import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

export const CASE_DATA_DIR = path.resolve(
  process.env.CASE_DATA_DIR ?? path.join(MODULE_DIR, '..', 'case-data')
);
export const CASE_FILE = path.join(CASE_DATA_DIR, 'cases.json');
export const UPLOAD_DIR = path.join(CASE_DATA_DIR, 'uploads');

export async function ensureCaseDataDirs() {
  await mkdir(CASE_DATA_DIR, {recursive: true});
  await mkdir(UPLOAD_DIR, {recursive: true});
}

export function slugify(input) {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function createCaseId(title) {
  const slug = slugify(title) || 'case';
  const suffix = Date.now().toString(36);
  return `${slug}-${suffix}`;
}

export async function loadCases() {
  await ensureCaseDataDirs();
  try {
    const raw = await readFile(CASE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed.cases ?? [];
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function saveCases(cases) {
  await ensureCaseDataDirs();
  const normalizedCases = cases.map(normalizeCase);
  const tmpFile = `${CASE_FILE}.tmp`;
  await writeFile(tmpFile, `${JSON.stringify(normalizedCases, null, 2)}\n`, 'utf8');
  await rename(tmpFile, CASE_FILE);
  return normalizedCases;
}

export async function upsertCase(testCase) {
  const cases = await loadCases();
  const normalizedCase = normalizeCase(testCase);
  const index = cases.findIndex((item) => item.id === normalizedCase.id);
  if (index >= 0) {
    cases[index] = {...cases[index], ...normalizedCase, updatedAt: new Date().toISOString()};
  } else {
    cases.unshift({
      ...normalizedCase,
      createdAt: normalizedCase.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  await saveCases(cases);
  return cases.find((item) => item.id === normalizedCase.id);
}

export async function deleteCase(caseId) {
  const cases = await loadCases();
  const nextCases = cases.filter((item) => item.id !== caseId);
  await saveCases(nextCases);
  return nextCases.length !== cases.length;
}

export function normalizeCase(testCase) {
  const title = String(testCase.title ?? '').trim() || '未命名用例';
  return {
    id: String(testCase.id ?? createCaseId(title)),
    title,
    group: String(testCase.group ?? '未分组'),
    priority: String(testCase.priority ?? 'P1'),
    enabled: testCase.enabled !== false,
    description: String(testCase.description ?? ''),
    expectedResult: String(testCase.expectedResult ?? ''),
    actualResult: String(testCase.actualResult ?? ''),
    coverImage: testCase.coverImage ? String(testCase.coverImage) : '',
    tags: normalizeStringArray(testCase.tags),
    params: normalizeParams(testCase.params),
    steps: normalizeSteps(testCase.steps),
    createdAt: testCase.createdAt ?? new Date().toISOString(),
    updatedAt: testCase.updatedAt ?? new Date().toISOString(),
  };
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeParams(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizeSteps(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((step) => step && typeof step === 'object')
    .map((step) => ({
      action: String(step.action ?? '').trim(),
      name: String(step.name ?? step.label ?? '').trim(),
      expectedResult: String(step.expectedResult ?? ''),
      actualResult: String(step.actualResult ?? ''),
      ...step,
    }))
    .filter((step) => step.action);
}
