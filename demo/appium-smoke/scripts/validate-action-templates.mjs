import {readFile} from 'node:fs/promises';

import {SUPPORTED_ACTIONS} from '../lib/case-runner.mjs';

const supported = new Set(SUPPORTED_ACTIONS);
const root = new URL('../', import.meta.url);

const [casesJson, indexHtml, appJs] = await Promise.all([
  readFile(new URL('case-data/cases.json', root), 'utf8'),
  readFile(new URL('admin/index.html', root), 'utf8'),
  readFile(new URL('admin/app.js', root), 'utf8'),
]);

const actions = [];
const cases = JSON.parse(casesJson);
for (const testCase of cases) {
  for (const step of testCase.steps ?? []) {
    actions.push({source: `case:${testCase.id}`, action: step.action});
  }
}

for (const selectId of ['actionPreset', 'businessAction']) {
  const match = new RegExp(`<select id="${selectId}">([\\s\\S]*?)</select>`).exec(indexHtml);
  if (!match) {
    throw new Error(`Missing select #${selectId}`);
  }
  for (const option of match[1].matchAll(/<option value="([^"]+)"/g)) {
    actions.push({source: `select:${selectId}`, action: option[1]});
  }
}

for (const template of indexHtml.matchAll(/data-template='([^']+)'/g)) {
  actions.push({source: 'guide-template', action: JSON.parse(template[1]).action});
}

for (const action of appJs.matchAll(/\b([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*\{\s*action\b/g)) {
  actions.push({source: 'admin-preset', action: action[1]});
}

const missing = actions.filter((item) => !supported.has(item.action));
if (missing.length) {
  console.error('Unsupported actions found:');
  for (const item of missing) {
    console.error(`- ${item.source}: ${item.action}`);
  }
  process.exitCode = 1;
} else {
  console.log(`action-template-ok: ${new Set(actions.map((item) => item.action)).size} actions covered`);
}
