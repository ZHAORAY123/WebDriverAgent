import {runManagedCases, listCases} from './lib/case-runner.mjs';

function parseArgs(argv) {
  const options = {
    ids: [],
    tags: [],
    groups: [],
    repeat: 1,
    sessionScope: '',
    includeDisabled: false,
    list: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => argv[++index];
    if (arg === '--list') {
      options.list = true;
    } else if (arg === '--id') {
      options.ids.push(readValue());
    } else if (arg === '--tag') {
      options.tags.push(readValue());
    } else if (arg === '--group') {
      options.groups.push(readValue());
    } else if (arg === '--repeat') {
      options.repeat = Number(readValue());
    } else if (arg === '--session-scope') {
      options.sessionScope = readValue();
    } else if (arg === '--include-disabled') {
      options.includeDisabled = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));

if (options.list) {
  const cases = await listCases();
  for (const item of cases) {
    const marker = item.enabled === false ? 'disabled' : 'enabled';
    console.log(`${item.id}\t${marker}\t${item.group}\t${item.title}`);
  }
} else {
  const report = await runManagedCases(options);
  console.log(`\nRun ${report.runId}: ${report.passed}/${report.total} passed`);
  console.log(`Report: ${report.reportPath}`);
  if (report.failed > 0) {
    process.exitCode = 1;
  }
}
