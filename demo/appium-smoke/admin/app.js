const state = {
  cases: [],
  caseStats: {},
  caseReports: [],
  currentRun: null,
  selectedId: '',
  selectedGroup: localStorage.getItem('selectedGroup') || '全部',
  checkedIds: new Set(),
  visibleIds: [],
  coverImage: '',
  runId: '',
  pollTimer: null,
  deviceConnected: false,
  devicePollTimer: null,
  deviceAgeTimer: null,
  deviceRefreshInFlight: false,
  deviceCapturedAt: '',
  deviceCaptureDurationMs: 0,
  deviceScale: localStorage.getItem('deviceScale') || '300',
  deviceInterval: localStorage.getItem('deviceInterval') || '1000',
  uploadedImageByHash: new Map(),
};

const els = {
  totalCaseMetric: document.querySelector('#totalCaseMetric'),
  enabledCaseMetric: document.querySelector('#enabledCaseMetric'),
  priorityMetric: document.querySelector('#priorityMetric'),
  successMetric: document.querySelector('#successMetric'),
  sampleMetric: document.querySelector('#sampleMetric'),
  allRunMetric: document.querySelector('#allRunMetric'),
  allRunMetricSub: document.querySelector('#allRunMetricSub'),
  visibleCaseCount: document.querySelector('#visibleCaseCount'),
  groupTabs: document.querySelector('#groupTabs'),
  caseList: document.querySelector('#caseList'),
  filterInput: document.querySelector('#filterInput'),
  statusText: document.querySelector('#statusText'),
  editorTitle: document.querySelector('#editorTitle'),
  newCaseButton: document.querySelector('#newCaseButton'),
  runSelectedButton: document.querySelector('#runSelectedButton'),
  runSelected100Button: document.querySelector('#runSelected100Button'),
  runAllButton: document.querySelector('#runAllButton'),
  runCheckedButton: document.querySelector('#runCheckedButton'),
  runGroupButton: document.querySelector('#runGroupButton'),
  pauseRunButton: document.querySelector('#pauseRunButton'),
  selectVisibleButton: document.querySelector('#selectVisibleButton'),
  copyCaseJsonButton: document.querySelector('#copyCaseJsonButton'),
  duplicateButton: document.querySelector('#duplicateButton'),
  deleteButton: document.querySelector('#deleteButton'),
  saveButton: document.querySelector('#saveButton'),
  titleInput: document.querySelector('#titleInput'),
  groupInput: document.querySelector('#groupInput'),
  priorityInput: document.querySelector('#priorityInput'),
  enabledInput: document.querySelector('#enabledInput'),
  tagsInput: document.querySelector('#tagsInput'),
  descriptionInput: document.querySelector('#descriptionInput'),
  expectedResultInput: document.querySelector('#expectedResultInput'),
  actualResultInput: document.querySelector('#actualResultInput'),
  imageInput: document.querySelector('#imageInput'),
  imagePreview: document.querySelector('#imagePreview'),
  gestureImageInput: document.querySelector('#gestureImageInput'),
  gestureImageDropzone: document.querySelector('#gestureImageDropzone'),
  gestureImagePreview: document.querySelector('#gestureImagePreview'),
  statsSummary: document.querySelector('#statsSummary'),
  statsGrid: document.querySelector('#statsGrid'),
  recentRuns: document.querySelector('#recentRuns'),
  deviceStatus: document.querySelector('#deviceStatus'),
  deviceCapturedAt: document.querySelector('#deviceCapturedAt'),
  connectDeviceButton: document.querySelector('#connectDeviceButton'),
  deviceScaleInput: document.querySelector('#deviceScaleInput'),
  deviceIntervalInput: document.querySelector('#deviceIntervalInput'),
  refreshDeviceButton: document.querySelector('#refreshDeviceButton'),
  captureDeviceButton: document.querySelector('#captureDeviceButton'),
  stopDeviceButton: document.querySelector('#stopDeviceButton'),
  devicePreview: document.querySelector('#devicePreview'),
  paramsInput: document.querySelector('#paramsInput'),
  actionPreset: document.querySelector('#actionPreset'),
  addStepButton: document.querySelector('#addStepButton'),
  caseTemplatePreset: document.querySelector('#caseTemplatePreset'),
  applyCaseTemplateButton: document.querySelector('#applyCaseTemplateButton'),
  businessArea: document.querySelector('#businessArea'),
  businessAction: document.querySelector('#businessAction'),
  businessTarget: document.querySelector('#businessTarget'),
  businessCount: document.querySelector('#businessCount'),
  businessWaitMs: document.querySelector('#businessWaitMs'),
  businessSaveArtifacts: document.querySelector('#businessSaveArtifacts'),
  addBusinessStepButton: document.querySelector('#addBusinessStepButton'),
  gestureAction: document.querySelector('#gestureAction'),
  gestureTarget: document.querySelector('#gestureTarget'),
  gestureCount: document.querySelector('#gestureCount'),
  gestureWaitMs: document.querySelector('#gestureWaitMs'),
  gestureSaveArtifacts: document.querySelector('#gestureSaveArtifacts'),
  addGestureStepButton: document.querySelector('#addGestureStepButton'),
  copyStepsJsonButton: document.querySelector('#copyStepsJsonButton'),
  stepList: document.querySelector('#stepList'),
  refreshRunButton: document.querySelector('#refreshRunButton'),
  runStatusText: document.querySelector('#runStatusText'),
  runProgress: document.querySelector('#runProgress'),
  runProgressTitle: document.querySelector('#runProgressTitle'),
  runProgressPercent: document.querySelector('#runProgressPercent'),
  runProgressFill: document.querySelector('#runProgressFill'),
  runProgressCase: document.querySelector('#runProgressCase'),
  runProgressStep: document.querySelector('#runProgressStep'),
  runLog: document.querySelector('#runLog'),
  runRepeatInput: document.querySelector('#runRepeatInput'),
};

await loadCases();
bindEvents();

async function loadCases() {
  const [cases, stats] = await Promise.all([api('/api/cases'), api('/api/case-stats')]);
  state.cases = cases;
  state.caseStats = stats.cases ?? {};
  state.caseReports = stats.reports ?? [];
  if (!state.selectedId && state.cases[0]) {
    state.selectedId = state.cases[0].id;
  }
  for (const id of [...state.checkedIds]) {
    if (!state.cases.some((item) => item.id === id)) {
      state.checkedIds.delete(id);
    }
  }
  renderOverview();
  renderList();
  renderEditor();
}

function renderOverview() {
  const enabled = state.cases.filter((item) => item.enabled !== false);
  const p0p1 = state.cases.filter((item) => ['P0', 'P1'].includes(item.priority ?? 'P1'));
  const statsItems = Object.values(state.caseStats);
  const totalRuns = statsItems.reduce((sum, item) => sum + Number(item.runs ?? 0), 0);
  const totalPassed = statsItems.reduce((sum, item) => sum + Number(item.passed ?? 0), 0);
  const successRate = totalRuns ? `${Math.round((totalPassed / totalRuns) * 1000) / 10}%` : '-';
  els.totalCaseMetric.textContent = String(state.cases.length);
  els.enabledCaseMetric.textContent = `${enabled.length} 启用`;
  els.priorityMetric.textContent = String(p0p1.length);
  els.successMetric.textContent = successRate;
  els.sampleMetric.textContent = `${totalRuns} 样本`;
  renderAllRunMetric(enabled.length);
}

function renderAllRunMetric(enabledCount) {
  const runningAll =
    state.currentRun?.status === 'running' &&
    Number(state.currentRun.progress?.totalCases ?? 0) === enabledCount;
  if (runningAll) {
    const percent = Math.max(0, Math.min(100, Number(state.currentRun.progress?.percent ?? 0)));
    els.allRunMetric.textContent = `运行中 ${percent}%`;
    els.allRunMetricSub.textContent = state.currentRun.progress?.currentStepName
      ? `当前：${state.currentRun.progress.currentStepName}`
      : `启动于 ${formatDateTime(state.currentRun.startedAt)}`;
    return;
  }

  const fullRun = state.caseReports.find((report) => Number(report.total ?? 0) === enabledCount);
  if (!fullRun) {
    els.allRunMetric.textContent = '未运行';
    els.allRunMetricSub.textContent = `等待运行 ${enabledCount} 条`;
    return;
  }

  const rate = fullRun.total ? Math.round((Number(fullRun.passed ?? 0) / fullRun.total) * 1000) / 10 : 0;
  els.allRunMetric.textContent = `${rate}%`;
  els.allRunMetricSub.textContent = `${formatDateTime(fullRun.startedAt)} · ${formatDuration(fullRun.durationMs)}`;
}

function bindEvents() {
  els.filterInput.addEventListener('input', renderList);
  els.newCaseButton.addEventListener('click', createDraft);
  els.saveButton.addEventListener('click', saveSelected);
  els.copyCaseJsonButton.addEventListener('click', copySelectedCaseJson);
  els.duplicateButton.addEventListener('click', duplicateSelected);
  els.deleteButton.addEventListener('click', deleteSelected);
  els.addStepButton.addEventListener('click', addStep);
  els.applyCaseTemplateButton.addEventListener('click', applyCaseTemplate);
  els.addBusinessStepButton.addEventListener('click', addBusinessStep);
  els.addGestureStepButton.addEventListener('click', addGestureStep);
  els.copyStepsJsonButton.addEventListener('click', copyStepsJson);
  els.runSelectedButton.addEventListener('click', runSelected);
  els.runSelected100Button.addEventListener('click', () => runSelected({repeat: 100, labelSuffix: '100次'}));
  els.runAllButton.addEventListener('click', runAll);
  els.runCheckedButton.addEventListener('click', runChecked);
  els.runGroupButton.addEventListener('click', runCurrentGroup);
  els.pauseRunButton.addEventListener('click', pauseCurrentRun);
  els.selectVisibleButton.addEventListener('click', toggleVisibleSelection);
  els.refreshRunButton.addEventListener('click', refreshRun);
  els.gestureTarget.addEventListener('input', renderGestureImagePreview);
  setupUploadZone(els.imagePreview, {
    input: els.imageInput,
    multiple: false,
    onFiles: uploadReferenceImages,
  });
  setupUploadZone(els.gestureImageDropzone, {
    input: els.gestureImageInput,
    multiple: true,
    openOnClick: true,
    onFiles: uploadGestureImages,
  });
  document.querySelectorAll('.guide-copy').forEach((button) => {
    button.addEventListener('click', () => copyGuideTemplate(button));
  });
  els.connectDeviceButton.addEventListener('click', connectDevice);
  els.refreshDeviceButton.addEventListener('click', refreshDeviceScreen);
  els.captureDeviceButton.addEventListener('click', captureDeviceAsReference);
  els.stopDeviceButton.addEventListener('click', stopDevice);
  els.deviceScaleInput.value = state.deviceScale;
  els.deviceScaleInput.addEventListener('change', () => {
    state.deviceScale = els.deviceScaleInput.value;
    localStorage.setItem('deviceScale', state.deviceScale);
    applyDeviceScale();
  });
  els.deviceIntervalInput.value = state.deviceInterval;
  els.deviceIntervalInput.addEventListener('change', () => {
    state.deviceInterval = els.deviceIntervalInput.value;
    localStorage.setItem('deviceInterval', state.deviceInterval);
    startDevicePolling();
  });
  els.runRepeatInput.addEventListener('input', clampRunRepeatInput);
  els.runRepeatInput.addEventListener('change', clampRunRepeatInput);
}

function renderList() {
  const keyword = els.filterInput.value.trim().toLowerCase();
  renderGroups();
  const filtered = state.cases.filter((item) => {
    const haystack = [item.title, item.group, item.description, item.priority, ...(item.tags ?? [])]
      .join(' ')
      .toLowerCase();
    const matchesGroup = state.selectedGroup === '全部' || item.group === state.selectedGroup;
    return matchesGroup && haystack.includes(keyword);
  });
  state.visibleIds = filtered.map((item) => item.id);
  els.visibleCaseCount.textContent = `${filtered.length} 条`;
  const allSelected = state.visibleIds.length > 0 && state.visibleIds.every((id) => state.checkedIds.has(id));
  els.selectVisibleButton.textContent = allSelected ? '取消当前' : '选中当前';

  els.caseList.innerHTML = '';
  for (const testCase of filtered) {
    const button = document.createElement('button');
    button.className = `case-item${testCase.id === state.selectedId ? ' active' : ''}`;
    button.type = 'button';
    const checked = state.checkedIds.has(testCase.id) ? 'checked' : '';
    const priority = escapeHtml(testCase.priority ?? 'P1');
    const priorityClass = `priority-${priority.toLowerCase()}`;
    button.innerHTML = `
      <input class="case-check" type="checkbox" ${checked} aria-label="选择用例" />
      <span class="case-main">
        <span class="case-title-row">
          <strong>${escapeHtml(testCase.title)}</strong>
          <span class="priority-pill ${priorityClass}">${priority}</span>
        </span>
        <span class="case-meta">
          <span>${escapeHtml(testCase.group || '未分组')}</span>
          <span>${testCase.steps?.length ?? 0} 步骤</span>
          <span>${testCase.enabled === false ? '停用' : '启用'}</span>
        </span>
        ${renderCaseItemStats(testCase.id)}
      </span>
    `;
    button.querySelector('.case-check').addEventListener('click', (event) => {
      event.stopPropagation();
      if (event.currentTarget.checked) {
        state.checkedIds.add(testCase.id);
      } else {
        state.checkedIds.delete(testCase.id);
      }
      renderList();
      renderEditor();
    });
    button.addEventListener('click', (event) => {
      if (event.target?.classList?.contains('case-check')) {
        return;
      }
      state.selectedId = testCase.id;
      renderList();
      renderEditor();
    });
    els.caseList.append(button);
  }
}

function renderGroups() {
  const groups = ['全部', ...new Set(state.cases.map((item) => item.group || '未分组'))];
  if (!groups.includes(state.selectedGroup)) {
    state.selectedGroup = '全部';
  }
  els.groupTabs.innerHTML = '';
  for (const group of groups) {
    const count = group === '全部' ? state.cases.length : state.cases.filter((item) => item.group === group).length;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `group-tab${group === state.selectedGroup ? ' active' : ''}`;
    button.innerHTML = `<span>${escapeHtml(group)}</span><strong>${count}</strong>`;
    button.addEventListener('click', () => {
      state.selectedGroup = group;
      localStorage.setItem('selectedGroup', group);
      renderList();
    });
    els.groupTabs.append(button);
  }
}

function renderEditor() {
  const testCase = selectedCase();
  const disabled = !testCase;
  for (const input of [
    els.titleInput,
    els.groupInput,
    els.priorityInput,
    els.enabledInput,
    els.tagsInput,
    els.descriptionInput,
    els.expectedResultInput,
    els.actualResultInput,
    els.paramsInput,
    els.actionPreset,
    els.caseTemplatePreset,
    els.businessArea,
    els.businessAction,
    els.businessTarget,
    els.businessCount,
    els.businessWaitMs,
    els.businessSaveArtifacts,
    els.gestureAction,
    els.gestureTarget,
    els.gestureCount,
    els.gestureWaitMs,
    els.gestureSaveArtifacts,
    els.imageInput,
    els.gestureImageInput,
  ]) {
    input.disabled = disabled;
  }
  els.imagePreview?.classList.toggle('disabled', disabled);
  els.gestureImageDropzone?.classList.toggle('disabled', disabled);
  for (const button of [
    els.saveButton,
    els.copyCaseJsonButton,
    els.duplicateButton,
    els.deleteButton,
    els.runSelectedButton,
    els.runSelected100Button,
    els.runCheckedButton,
    els.runGroupButton,
    els.addStepButton,
    els.applyCaseTemplateButton,
    els.addBusinessStepButton,
    els.addGestureStepButton,
    els.copyStepsJsonButton,
  ]) {
    button.disabled = disabled && button !== els.runCheckedButton;
  }
  els.runCheckedButton.disabled = state.checkedIds.size === 0;
  els.runGroupButton.disabled = state.selectedGroup === '全部' && !testCase;

  if (!testCase) {
    els.statusText.textContent = '没有用例';
    els.editorTitle.textContent = '新建一个用例开始';
    els.stepList.innerHTML = '';
    renderGestureImagePreview();
    renderStats(null);
    return;
  }

  state.coverImage = testCase.coverImage ?? '';
  const tags = (testCase.tags ?? []).map((tag) => `#${tag}`).join(' ');
  els.statusText.textContent = `${testCase.id} · ${testCase.steps?.length ?? 0} 个步骤${tags ? ` · ${tags}` : ''}`;
  els.editorTitle.textContent = testCase.title;
  els.titleInput.value = testCase.title ?? '';
  els.groupInput.value = testCase.group ?? '';
  els.priorityInput.value = testCase.priority ?? 'P1';
  els.enabledInput.checked = testCase.enabled !== false;
  els.tagsInput.value = (testCase.tags ?? []).join(', ');
  els.descriptionInput.value = testCase.description ?? '';
  els.expectedResultInput.value = testCase.expectedResult ?? '';
  els.actualResultInput.value = testCase.actualResult ?? inferLatestActualResult(testCase);
  els.paramsInput.value = JSON.stringify(testCase.params ?? {}, null, 2);
  renderImage();
  renderGestureImagePreview();
  renderStats(testCase);
  renderSteps(testCase.steps ?? []);
}

function renderCaseItemStats(id) {
  const stats = state.caseStats[id];
  if (!stats?.runs) {
    return '<span class="case-stats muted">未运行</span>';
  }
  const status = stats.lastStatus === 'passed' ? '通过' : '失败';
  return `
    <span class="case-stats">
      <span>${stats.runs} 次</span>
      <span>${stats.successRate}%</span>
      <span>${status}</span>
    </span>
  `;
}

function renderStats(testCase) {
  const stats = testCase ? state.caseStats[testCase.id] : null;
  if (!stats?.runs) {
    els.statsSummary.textContent = '暂无样本';
    els.statsGrid.innerHTML = `
      <div class="stat-card"><span>运行次数</span><strong>0</strong></div>
      <div class="stat-card"><span>成功率</span><strong>-</strong></div>
      <div class="stat-card"><span>最近运行</span><strong>-</strong></div>
      <div class="stat-card"><span>平均耗时</span><strong>-</strong></div>
    `;
    els.recentRuns.innerHTML = '';
    return;
  }

  els.statsSummary.textContent = `最近 ${formatDateTime(stats.lastRunAt)} · ${stats.lastStatus === 'passed' ? '通过' : '失败'}`;
  els.statsGrid.innerHTML = `
    <div class="stat-card"><span>运行次数</span><strong>${stats.runs}</strong><em>${stats.passed} 通过 / ${stats.failed} 失败</em></div>
    <div class="stat-card"><span>成功率</span><strong>${stats.successRate}%</strong><em>样本维度</em></div>
    <div class="stat-card"><span>最近耗时</span><strong>${formatDuration(stats.lastDurationMs)}</strong><em>${escapeHtml(stats.lastRunId)}</em></div>
    <div class="stat-card"><span>平均耗时</span><strong>${formatDuration(stats.avgDurationMs)}</strong><em>${formatDuration(stats.minDurationMs)} - ${formatDuration(stats.maxDurationMs)}</em></div>
  `;
  els.recentRuns.innerHTML = `
    <table>
      <thead><tr><th>时间</th><th>结果</th><th>耗时</th></tr></thead>
      <tbody>
        ${stats.recent
          .map(
            (run) => `
              <tr>
                <td>${escapeHtml(formatDateTime(run.startedAt))}</td>
                <td class="${run.status === 'passed' ? 'pass' : 'fail'}">${run.status === 'passed' ? '通过' : '失败'}</td>
                <td>${escapeHtml(formatDuration(run.durationMs))}</td>
              </tr>
            `
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function inferLatestActualResult(testCase) {
  const stats = testCase ? state.caseStats[testCase.id] : null;
  if (!stats?.runs) {
    return '';
  }
  const status = stats.lastStatus === 'passed' ? '通过' : '失败';
  const duration = formatDuration(stats.lastDurationMs);
  const lastRun = stats.recent?.[0];
  const error = lastRun?.error ? `；失败原因：${lastRun.error}` : '';
  return `最近一次运行：${status}，耗时 ${duration}${error}`;
}

function renderImage() {
  els.imagePreview.innerHTML = '';
  if (!state.coverImage) {
    els.imagePreview.textContent = '暂无图片';
    els.imagePreview.title = '';
    return;
  }
  els.imagePreview.title = state.coverImage;
  els.imagePreview.innerHTML = `
    <figure class="asset-card asset-card-large">
      <img src="${escapeAttribute(state.coverImage)}" alt="参考图片" />
      <figcaption>${escapeHtml(state.coverImage)}</figcaption>
    </figure>
  `;
}

function renderGestureImagePreview() {
  const paths = splitList(els.gestureTarget.value).filter(isImageReference);
  els.gestureImagePreview.innerHTML = '';
  if (paths.length === 0) {
    els.gestureImagePreview.textContent = '暂无图片';
    els.gestureImageDropzone?.classList.remove('has-images');
    return;
  }
  els.gestureImageDropzone?.classList.add('has-images');
  const grid = document.createElement('div');
  grid.className = 'asset-grid';
  for (const pathValue of paths) {
    const card = document.createElement('figure');
    card.className = 'asset-card';
    card.title = pathValue;
    card.innerHTML = `
      <img src="${escapeAttribute(pathValue)}" alt="${escapeHtml(pathValue)}" />
      <figcaption>${escapeHtml(pathValue)}</figcaption>
    `;
    grid.append(card);
  }
  els.gestureImagePreview.append(grid);
}

function renderSteps(steps) {
  els.stepList.innerHTML = '';
  steps.forEach((step, index) => {
    const displayStep = hydrateStepFields(step);
    const row = document.createElement('div');
    row.className = 'step';
    row.innerHTML = `
      <div class="step-index">${index + 1}</div>
      <div class="step-body">
        <label>
          <span>步骤</span>
          <textarea class="step-name" rows="2" placeholder="例如：点击搜索框，输入「歌手」并点击搜索">${escapeHtml(displayStep.name ?? '')}</textarea>
        </label>
        <div class="step-grid">
          <label>
            <span>预期结果</span>
            <textarea class="step-expected" rows="2" placeholder="例如：搜索结果页展示播放入口和相关影视作品">${escapeHtml(displayStep.expectedResult ?? '')}</textarea>
          </label>
          <label>
            <span>实际结果</span>
            <textarea class="step-actual" rows="2" placeholder="运行后填写，或参考右侧运行日志">${escapeHtml(displayStep.actualResult ?? '')}</textarea>
          </label>
        </div>
        <label class="step-action-row">
          <span>执行动作</span>
          <select class="step-action">
            ${stepActionOptions(displayStep.action)}
          </select>
        </label>
        <div class="step-summary">${renderStepSummary(displayStep)}</div>
        <details class="step-advanced">
          <summary>高级动作配置</summary>
          <textarea class="code step-json" spellcheck="false">${escapeHtml(
            JSON.stringify(
              {
                ...displayStep,
                name: undefined,
                expectedResult: undefined,
                actualResult: undefined,
              },
              removeUndefined,
              2
            )
          )}</textarea>
        </details>
      </div>
      <button class="step-delete" type="button">删除</button>
    `;
    row.querySelector('.step-delete').addEventListener('click', () => {
      row.remove();
      renumberSteps();
    });
    els.stepList.append(row);
  });
}

function hydrateStepFields(step) {
  return {
    ...step,
    name: step.name || actionLabel(step.action),
    expectedResult: step.expectedResult || defaultExpectedResult(step),
    actualResult: step.actualResult || '',
  };
}

function stepActionOptions(selectedAction) {
  const groups = [
    {
      label: '业务动作',
      items: [
        ['relaunchToHome', '回到首页'],
        ['warmStart', '温启动'],
        ['dismissCommonPopups', '关闭弹窗'],
        ['searchKeyword', '搜索关键词'],
        ['searchBatch', '批量搜索'],
        ['openVodDetailFromResults', '进入详情页'],
        ['clickAnyText', '点击任一文本'],
        ['clickOptionalTexts', '点击入口组'],
        ['assertAnyText', '校验文本'],
        ['homeTabSweep', '首页 Tab 巡检'],
        ['playAndAssert', '播放校验'],
        ['enterFullscreen', '进入全屏'],
        ['waitAndCloseAd', '等待并关闭广告'],
        ['openCashierAndAssert', '会员收银台校验'],
        ['closeOrBack', '关闭/返回'],
        ['saveScreenshot', '保存截图'],
        ['sleep', '等待'],
      ],
    },
    {
      label: '手势动作',
      items: [
        ['swipePercent', '滑动'],
        ['playerGestureSuite', '播放器手势'],
        ['doubleTapPercent', '双击播放器'],
        ['longPressPercent', '长按播放器'],
        ['dragProgressBar', '拖动进度条'],
      ],
    },
    {
      label: '识图动作',
      items: [['imageMatchAny', '图片匹配']],
    },
  ];
  return groups
    .map(
      (group) => `
        <optgroup label="${group.label}">
          ${group.items
            .map(
              ([value, label]) =>
                `<option value="${value}" ${value === selectedAction ? 'selected' : ''}>${label}</option>`
            )
            .join('')}
        </optgroup>
      `
    )
    .join('');
}

function actionLabel(action) {
  return (
    {
      relaunchToHome: '回到首页',
      warmStart: '后台 3s 后温启动 App',
      dismissCommonPopups: '关闭页面弹窗',
      searchKeyword: '搜索指定关键词',
      searchBatch: '批量搜索多个关键词',
      openVodDetailFromResults: '从搜索结果进入详情页',
      clickAnyText: '点击任一匹配文本',
      clickOptionalTexts: '依次点击入口并返回',
      assertAnyText: '校验页面文案',
      homeTabSweep: '遍历首页 Tab 并滑动内容',
      swipePercent: '滑动页面',
      playAndAssert: '点击播放并校验播放态',
      enterFullscreen: '进入全屏并校验控制层',
      playerGestureSuite: '执行播放器手势套件',
      doubleTapPercent: '双击播放器区域',
      longPressPercent: '长按播放器区域',
      dragProgressBar: '拖动播放进度条',
      imageMatchAny: '图片匹配并执行',
      waitAndCloseAd: '等待并关闭广告',
      openCashierAndAssert: '打开会员收银台并校验',
      closeOrBack: '识别关闭或返回',
      saveScreenshot: '保存当前截图',
      sleep: '等待页面稳定',
    }[action] ?? '执行动作'
  );
}

function defaultExpectedResult(step) {
  if (step.expectedResult) {
    return step.expectedResult;
  }
  if (step.action === 'assertAnyText' && step.texts?.length) {
    return `页面出现：${formatStepValue(step.texts)}`;
  }
  if (step.action === 'searchKeyword') {
    return '进入搜索结果页，结果页展示播放或相关内容入口。';
  }
  if (step.action === 'playAndAssert') {
    return '播放成功，页面出现暂停、全屏、倍速等播放态控件。';
  }
  if (step.action === 'imageMatchAny') {
    return '任一图片命中后执行对应点击/双击/长按动作。';
  }
  if (step.action === 'waitAndCloseAd') {
    return '如出现广告，等待后可点击跳过或关闭；未出现广告时继续执行后续步骤。';
  }
  if (step.action === 'openCashierAndAssert') {
    return '收银台或会员权益页展示正常，不触发确认支付。';
  }
  return '动作执行完成，页面状态符合业务预期。';
}

function renderStepSummary(step) {
  const chips = [step.action ?? 'unknown'];
  if (step.keyword) chips.push(`关键词：${formatStepValue(step.keyword)}`);
  if (step.keywords) chips.push(`关键词组：${formatStepValue(step.keywords)}`);
  if (step.text) chips.push(`文本：${formatStepValue(step.text)}`);
  if (step.texts) chips.push(`文本组：${formatStepValue(step.texts)}`);
  if (step.images) chips.push(`图片组：${formatStepValue(step.images)}`);
  if (step.tabs) chips.push(`Tab：${formatStepValue(step.tabs)}`);
  if (step.swipeCount) chips.push(`滑动 ${step.swipeCount} 次`);
  if (step.waitMs) chips.push(`等待 ${step.waitMs}ms`);
  if (step.ms) chips.push(`等待 ${step.ms}ms`);
  if (step.matchAction) chips.push(`命中动作：${step.matchAction}`);
  if (step.saveArtifacts) chips.push('采集截图');
  if (step.filename) chips.push(step.filename);
  return chips.map((chip) => `<span class="step-chip">${escapeHtml(chip)}</span>`).join('');
}

function formatStepValue(value) {
  if (Array.isArray(value)) {
    return value.join(' / ');
  }
  if (typeof value === 'object' && value) {
    return JSON.stringify(value);
  }
  return String(value);
}

function renumberSteps() {
  [...els.stepList.querySelectorAll('.step-index')].forEach((node, index) => {
    node.textContent = String(index + 1);
  });
}

function collectForm() {
  const base = selectedCase() ?? {};
  return {
    ...base,
    title: els.titleInput.value.trim() || '未命名用例',
    group: els.groupInput.value.trim() || '未分组',
    priority: els.priorityInput.value,
    enabled: els.enabledInput.checked,
    tags: els.tagsInput.value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    description: els.descriptionInput.value.trim(),
    expectedResult: els.expectedResultInput.value.trim(),
    actualResult: els.actualResultInput.value.trim(),
    coverImage: state.coverImage,
    params: JSON.parse(els.paramsInput.value || '{}'),
    steps: collectStepsFromEditor(),
  };
}

async function saveSelected() {
  const payload = collectForm();
  const saved = await api(`/api/cases/${encodeURIComponent(payload.id)}`, {
    method: 'PUT',
    body: payload,
  });
  const index = state.cases.findIndex((item) => item.id === saved.id);
  if (index >= 0) {
    state.cases[index] = saved;
  } else {
    state.cases.unshift(saved);
  }
  state.selectedId = saved.id;
  renderList();
  renderEditor();
  return saved;
}

async function duplicateSelected() {
  const source = collectForm();
  const saved = await api('/api/cases', {
    method: 'POST',
    body: {
      ...source,
      id: '',
      title: `${source.title} 副本`,
    },
  });
  state.cases.unshift(saved);
  state.selectedId = saved.id;
  renderList();
  renderEditor();
}

async function copySelectedCaseJson() {
  const payload = collectForm();
  await writeClipboard(JSON.stringify(payload, null, 2));
  els.statusText.textContent = '已复制用例 JSON';
}

async function copyStepsJson() {
  const payload = collectForm();
  await writeClipboard(JSON.stringify(payload.steps ?? [], null, 2));
  els.statusText.textContent = '已复制动作 JSON';
}

async function deleteSelected() {
  const testCase = selectedCase();
  if (!testCase || !confirm(`删除「${testCase.title}」？`)) {
    return;
  }
  await api(`/api/cases/${encodeURIComponent(testCase.id)}`, {method: 'DELETE'});
  state.cases = state.cases.filter((item) => item.id !== testCase.id);
  state.selectedId = state.cases[0]?.id ?? '';
  renderList();
  renderEditor();
}

function createDraft() {
  const draft = {
    id: `draft-${Date.now().toString(36)}`,
    title: '新建用例',
    group: '未分组',
    priority: 'P1',
    enabled: true,
    tags: [],
    description: '',
    expectedResult: '步骤均可执行，页面展示与预期一致。',
    actualResult: '',
    coverImage: '',
    params: {},
    steps: [
      {
        action: 'relaunchToHome',
        name: '回到首页',
        expectedResult: 'App 进入首页，启动广告已等待或关闭。',
        actualResult: '',
      },
    ],
  };
  state.cases.unshift(draft);
  state.selectedId = draft.id;
  renderList();
  renderEditor();
}

function addStep() {
  const preset = stepPreset(els.actionPreset.value);
  renderSteps([...collectStepsFromEditor(), preset]);
}

function collectStepsFromEditor() {
  return [...els.stepList.querySelectorAll('.step')].map((row) => {
    const name = row.querySelector('.step-name').value.trim();
    const expectedResult = row.querySelector('.step-expected').value.trim();
    const actualResult = row.querySelector('.step-actual').value.trim();
    const action = row.querySelector('.step-action').value;
    return {
      ...JSON.parse(row.querySelector('.step-json').value || '{}'),
      action,
      name,
      expectedResult,
      actualResult,
    };
  });
}

function stepPreset(action) {
  const presets = {
    relaunchToHome: {action, name: '回到首页'},
    warmStart: {
      action,
      name: '温启动并等待广告',
      backgroundSeconds: 3,
      timeoutMs: 6500,
      saveStartupAdArtifacts: true,
    },
    dismissCommonPopups: {action, name: '关闭常见弹窗'},
    searchKeyword: {action, name: '搜索关键词', keyword: '{{params.keyword}}'},
    searchBatch: {
      action,
      name: '批量搜索',
      keywords: '{{params.keywords}}',
      resultTexts: ['播放', '相关影视作品', '热搜榜'],
      saveArtifacts: true,
    },
    openVodDetailFromResults: {action, name: '进入点播详情', keyword: '{{params.keyword}}'},
    clickAnyText: {action, name: '点击任一文本', texts: ['播放', '立即播放']},
    clickOptionalTexts: {
      action,
      name: '点击一组可选按钮',
      texts: ['分享', '缓存', '简介'],
      backAfterClick: true,
    },
    closeOrBack: {
      action,
      name: '识别关闭或返回',
      includeClose: true,
      includeBack: true,
      fallback: true,
    },
    homeTabSweep: {
      action,
      name: '首页 Tab 逐个巡检',
      tabs: ['刷片', '首页测试', '找片', '短剧', '综艺', '电视剧', '电影'],
      swipeCount: 2,
      saveArtifacts: true,
    },
    tapPercent: {action, name: '百分比点击', x: 0.5, y: 0.35},
    swipePercent: {
      action,
      name: '百分比滑动',
      from: {x: 0.5, y: 0.76},
      to: {x: 0.5, y: 0.28},
    },
    imageMatchAny: {
      action,
      name: '图片匹配并执行',
      images: ['/uploads/a.png', '/uploads/b.png'],
      matchAction: 'click',
      timeoutMs: 5000,
      threshold: 0.94,
    },
    playAndAssert: {
      action,
      name: '播放并校验',
      playTexts: ['播放', '立即播放', '继续播放'],
      playingTexts: ['暂停', '全屏', '倍速'],
    },
    enterFullscreen: {
      action,
      name: '进入全屏',
      texts: ['全屏'],
      assertTexts: ['倍速', '选集', '清晰度'],
    },
    playerGestureSuite: {
      action,
      name: '播放器手势套件',
      gestures: ['doubleTapRight', 'doubleTapLeft', 'longPress', 'dragProgress'],
      assertTexts: ['暂停', '全屏', '倍速', '清晰度'],
      saveArtifacts: true,
    },
    doubleTapPercent: {action, name: '双击播放器', x: 0.72, y: 0.5, waitMs: 800},
    longPressPercent: {action, name: '长按播放器', x: 0.5, y: 0.5, durationMs: 900, waitMs: 800},
    dragProgressBar: {
      action,
      name: '拖动播放进度条',
      from: {x: 0.32, y: 0.84},
      to: {x: 0.68, y: 0.84},
      saveArtifacts: true,
    },
    waitAndCloseAd: {
      action,
      name: '等待并关闭广告',
      timeoutMs: 12000,
      texts: ['广告', '跳过', '会员免广告'],
      saveArtifacts: true,
    },
    openCashierAndAssert: {
      action,
      name: '会员收银台只校验',
      entryTexts: ['会员免广告', '开通会员', '立即开通', 'VIP'],
      texts: ['收银台', '微信支付', '支付宝', '连续包月', '会员权益'],
      closeAfterAssert: true,
      saveArtifacts: true,
    },
    assertAnyText: {action, name: '校验任一文本', texts: ['播放', '选集']},
    saveScreenshot: {action, name: '保存截图', filename: 'case-screenshot.png'},
  };
  return presets[action];
}

function addBusinessStep() {
  const step = buildBusinessStep({
    action: els.businessAction.value,
    area: els.businessArea.value,
    target: els.businessTarget.value.trim(),
    count: Number(els.businessCount.value || 1),
    waitMs: Number(els.businessWaitMs.value || 0),
    saveArtifacts: els.businessSaveArtifacts.checked,
  });
  renderSteps([...collectStepsFromEditor(), step]);
  els.statusText.textContent = `已添加业务动作：${step.name}`;
}

function addGestureStep() {
  const step = buildGestureStep({
    action: els.gestureAction.value,
    target: els.gestureTarget.value.trim(),
    count: Number(els.gestureCount.value || 1),
    waitMs: Number(els.gestureWaitMs.value || 0),
    saveArtifacts: els.gestureSaveArtifacts.checked,
  });
  renderSteps([...collectStepsFromEditor(), step]);
  els.statusText.textContent = `已添加手势动作：${step.name}`;
}

function buildBusinessStep({action, area, target, count, waitMs, saveArtifacts}) {
  const texts = splitList(target);
  const primary = texts[0] || '{{params.keyword}}';
  const common = waitMs ? {waitMs} : {};
  const byAction = {
    relaunchToHome: {action, name: '回到首页'},
    warmStart: {
      action,
      name: '温启动并等待广告',
      backgroundSeconds: Math.max(3, count || 3),
      timeoutMs: waitMs || 6500,
      saveStartupAdArtifacts: saveArtifacts,
    },
    dismissCommonPopups: {action, name: '关闭弹窗'},
    searchKeyword: {action, name: `搜索：${primary}`, keyword: primary},
    searchBatch: {
      action,
      name: `批量搜索 ${texts.length || count} 个词`,
      keywords: texts.length ? texts : '{{params.keywords}}',
      resultTexts: ['播放', '相关影视作品', '热搜榜', '全部'],
      saveArtifacts,
    },
    openVodDetailFromResults: {action, name: `进入详情页：${primary}`, keyword: primary},
    clickOptionalTexts: {
      action,
      name: `${area}入口巡检`,
      texts: texts.length ? texts : defaultTextsForArea(area),
      backAfterClick: true,
      saveArtifacts,
    },
    assertAnyText: {
      action,
      name: `${area}文本校验`,
      texts: texts.length ? texts : defaultTextsForArea(area),
      timeoutMs: waitMs || 12000,
    },
    homeTabSweep: {
      action,
      name: '首页 Tab 巡检',
      tabs: texts.length ? texts : ['刷片', '首页测试', '找片', '短剧', '综艺', '电视剧', '电影'],
      swipeCount: Math.max(1, count),
      swipeDurationMs: 180,
      saveArtifacts,
    },
    swipePercent: {
      action,
      name: `${area}快速滑动 ${Math.max(1, count)} 次`,
      from: {x: 0.5, y: 0.78},
      to: {x: 0.5, y: 0.28},
      durationMs: 220,
      waitMs: waitMs || 500,
    },
    playAndAssert: {
      action,
      name: '播放并校验播放态',
      playTexts: ['播放', '立即播放', '继续播放'],
      playingTexts: texts.length ? texts : ['暂停', '全屏', '倍速', '选集', '清晰度'],
      timeoutMs: waitMs || 15000,
    },
    enterFullscreen: {
      action,
      name: '进入全屏并校验',
      texts: ['mediaControl fullscreen', '全屏'],
      assertTexts: texts.length ? texts : ['倍速', '清晰度', '选集', '暂停'],
    },
    playerGestureSuite: {
      action,
      name: '播放器手势：双击/长按/拖进度',
      gestures: texts.length ? texts : ['doubleTapRight', 'doubleTapLeft', 'longPress', 'dragProgress'],
      assertTexts: ['暂停', '全屏', '倍速', '清晰度'],
      saveArtifacts,
      waitMs: waitMs || 800,
    },
    doubleTapPercent: {
      action,
      name: '双击播放器快进/唤起',
      x: 0.72,
      y: 0.5,
      waitMs: waitMs || 800,
    },
    longPressPercent: {
      action,
      name: '长按播放器倍速/控制层',
      x: 0.5,
      y: 0.5,
      durationMs: waitMs || 900,
      waitMs: 800,
    },
    dragProgressBar: {
      action,
      name: '拖动播放进度条',
      from: {x: 0.32, y: 0.84},
      to: {x: Math.min(0.88, 0.32 + Math.max(1, count) * 0.12), y: 0.84},
      assertTexts: texts,
      saveArtifacts,
      waitMs: waitMs || 1200,
    },
    waitAndCloseAd: {
      action,
      name: '等待并关闭广告',
      timeoutMs: waitMs || 12000,
      texts: texts.length ? texts : ['广告', '跳过', '会员免广告', '倒计时'],
      saveArtifacts,
      required: false,
    },
    openCashierAndAssert: {
      action,
      name: '会员收银台只校验',
      entryTexts: texts.length ? texts : ['会员免广告', '开通会员', '立即开通', 'VIP', '会员'],
      texts: ['收银台', '微信支付', '支付宝', '连续包月', '会员权益', '开通会员'],
      closeAfterAssert: true,
      saveArtifacts,
      required: false,
    },
    closeOrBack: {action, name: '识别关闭或返回', includeClose: true, includeBack: true, fallback: true},
    saveScreenshot: {
      action,
      name: '保存截图',
      filename: safeFilename(target || area || 'case-screenshot'),
    },
    sleep: {action, name: `等待 ${waitMs || count * 1000}ms`, ms: waitMs || count * 1000},
  };
  return {...(byAction[action] ?? stepPreset(action)), ...common};
}

function buildGestureStep({action, target, count, waitMs, saveArtifacts}) {
  const values = splitList(target);
  const common = waitMs ? {waitMs} : {};
  const byAction = {
    tapPercent: {
      action,
      name: '百分比点击',
      x: 0.5,
      y: 0.35,
      waitMs: waitMs || 250,
    },
    swipePercent: {
      action,
      name: '百分比滑动',
      from: {x: 0.5, y: 0.76},
      to: {x: 0.5, y: 0.28},
      durationMs: 220,
      waitMs: waitMs || 500,
    },
    doubleTapPercent: {
      action,
      name: '双击',
      x: 0.72,
      y: 0.5,
      waitMs: waitMs || 800,
    },
    longPressPercent: {
      action,
      name: '长按',
      x: 0.5,
      y: 0.5,
      durationMs: waitMs || 900,
      waitMs: waitMs || 800,
    },
    dragPercent: {
      action,
      name: '拖动',
      from: {x: 0.32, y: 0.84},
      to: {x: 0.68, y: 0.84},
      waitMs: waitMs || 250,
    },
    dragProgressBar: {
      action,
      name: '拖动播放进度条',
      from: {x: 0.32, y: 0.84},
      to: {x: Math.min(0.88, 0.32 + Math.max(1, count) * 0.12), y: 0.84},
      assertTexts: values,
      saveArtifacts,
      waitMs: waitMs || 1200,
    },
    playerGestureSuite: {
      action,
      name: '播放器手势：双击/长按/拖进度',
      gestures: values.length ? values : ['doubleTapRight', 'doubleTapLeft', 'longPress', 'dragProgress'],
      assertTexts: ['暂停', '全屏', '倍速', '清晰度'],
      saveArtifacts,
      waitMs: waitMs || 800,
    },
    imageMatchAny: {
      action,
      name: '图片匹配并执行',
      images: values.length ? values : ['/uploads/a.png', '/uploads/b.png'],
      matchAction: 'click',
      timeoutMs: waitMs || 5000,
      threshold: 0.94,
      saveArtifacts,
    },
  };
  return {...(byAction[action] ?? {action, name: '手势动作'}), ...common};
}

function defaultTextsForArea(area) {
  return {
    首页: ['刷片', '首页测试', '找片', '搜索'],
    搜索: ['播放', '相关影视作品', '热搜榜', '全部'],
    点播页: ['播放', '选集', '简介', '猜你喜欢'],
    播放器: ['暂停', '全屏', '倍速', '选集', '清晰度', '广告', '跳过'],
    会员页: ['VIP', '会员', '开通', '权益', '收银台', '支付宝', '微信支付'],
    专题页: ['专题', '活动', '推荐', '更多'],
    稳定性: ['首页', '搜索', '返回', '关闭'],
  }[area] ?? ['播放', '返回'];
}

function splitList(value) {
  return String(value || '')
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function safeFilename(value) {
  return `${String(value)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]+/g, '-')
    .slice(0, 60) || 'case-screenshot'}.png`;
}

function applyCaseTemplate() {
  const template = businessCaseTemplate(els.caseTemplatePreset.value);
  if (!template) {
    return;
  }
  els.titleInput.value = template.title;
  els.groupInput.value = template.group;
  els.priorityInput.value = template.priority;
  els.tagsInput.value = template.tags.join(', ');
  els.descriptionInput.value = template.description;
  els.expectedResultInput.value = template.expectedResult ?? defaultCaseExpectedResult(template);
  els.actualResultInput.value = '';
  els.paramsInput.value = JSON.stringify(template.params, null, 2);
  renderSteps(template.steps);
  els.statusText.textContent = `已套用模板：${template.title}`;
}

function defaultCaseExpectedResult(template) {
  if (template.group === '搜索') {
    return '每个关键词均能进入搜索结果页，结果页展示可播放内容或相关影视作品。';
  }
  if (template.group === '播放') {
    return '播放链路可进入播放态，全屏、广告处理、手势或控制层功能符合预期。';
  }
  if (template.group === '会员页') {
    return '会员页或收银台展示正常，只校验展示与返回，不触发支付确认。';
  }
  if (template.group === '点播页') {
    return '详情页标题、标签、选集分组、播放入口和常见按钮展示正常。';
  }
  return '所有步骤按顺序执行完成，页面状态和关键文案符合预期。';
}

function businessCaseTemplate(value) {
  const commonHome = [
    {action: 'relaunchToHome', name: '回到首页'},
    {action: 'dismissCommonPopups', name: '关闭常见弹窗'},
  ];
  const templates = {
    homeSmoke: {
      title: '首页 Tab 与推荐流巡检',
      group: '首页',
      priority: 'P0',
      tags: ['首页', '冒烟', 'Tab'],
      description: '遍历首页顶部 Tab，滑动推荐流，点击安全内容区卡片并返回。',
      params: {tabs: ['刷片', '首页测试', '找片', '短剧', '综艺', '电视剧', '电影']},
      steps: [
        ...commonHome,
        {action: 'assertAnyText', name: '校验首页 Tab', texts: ['刷片', '首页测试', '找片']},
        {
          action: 'homeTabSweep',
          name: '首页 Tab 逐个巡检',
          tabs: '{{params.tabs}}',
          swipeCount: 2,
          saveArtifacts: true,
        },
        {action: 'saveScreenshot', name: '保存首页巡检截图', filename: 'home-template-smoke.png'},
      ],
    },
    searchRegression: {
      title: '搜索关键词批量回归',
      group: '搜索',
      priority: 'P0',
      tags: ['搜索', '批量回归'],
      description: '批量搜索多个关键词，校验结果页承载并保存截图和源码。',
      params: {keywords: ['歌手', '乘风', '大侦探', '我的人间烟火']},
      steps: [
        {action: 'searchBatch', name: '批量搜索关键词', keywords: '{{params.keywords}}', resultTexts: ['播放', '相关影视作品', '热搜榜', '全部'], saveArtifacts: true},
      ],
    },
    vodDetail: {
      title: '点播详情深度校验',
      group: '点播页',
      priority: 'P1',
      tags: ['点播', '详情', '选集'],
      description: '搜索进入详情页，校验标题、标签、选集、简介、推荐和常见入口。',
      params: {keyword: '我的人间烟火'},
      steps: [
        ...commonHome,
        {action: 'searchKeyword', name: '搜索内容', keyword: '{{params.keyword}}'},
        {action: 'openVodDetailFromResults', name: '进入详情页', keyword: '{{params.keyword}}'},
        {action: 'assertAnyText', name: '详情页基础校验', texts: ['{{params.keyword}}', '选集', '简介', '播放']},
        {action: 'clickOptionalTexts', name: '详情页入口巡检', texts: ['追剧', '缓存', '分享', '评论', '简介'], backAfterClick: true, saveArtifacts: true},
        {action: 'swipePercent', name: '详情页向上滑动', from: {x: 0.5, y: 0.78}, to: {x: 0.5, y: 0.28}},
        {action: 'saveScreenshot', name: '保存详情页截图', filename: 'vod-detail-template.png'},
      ],
    },
    playerFullPath: {
      title: '播放与全屏控制链路',
      group: '播放',
      priority: 'P1',
      tags: ['播放', '全屏', '控制层'],
      description: '从详情页进入播放态，进入全屏并校验倍速、清晰度、选集等控制入口。',
      params: {keyword: '我的人间烟火'},
      steps: [
        ...commonHome,
        {action: 'searchKeyword', name: '搜索内容', keyword: '{{params.keyword}}'},
        {action: 'openVodDetailFromResults', name: '进入详情页', keyword: '{{params.keyword}}'},
        {action: 'playAndAssert', name: '播放并校验', playTexts: ['播放', '立即播放', '继续播放'], playingTexts: ['暂停', '全屏', '倍速', '选集', '清晰度']},
        {action: 'enterFullscreen', name: '进入全屏', texts: ['mediaControl fullscreen', '全屏'], assertTexts: ['倍速', '清晰度', '选集', '暂停']},
        {action: 'saveScreenshot', name: '保存全屏截图', filename: 'player-full-path-template.png'},
      ],
    },
    playerGesture: {
      title: '播放器核心手势回归',
      group: '播放',
      priority: 'P0',
      tags: ['播放', '手势', '进度条', '核心业务'],
      description: '从详情页进入播放态，覆盖双击快进/快退、长按、拖动进度条和控制层校验。',
      params: {keyword: '我的人间烟火'},
      steps: [
        ...commonHome,
        {action: 'searchKeyword', name: '搜索内容', keyword: '{{params.keyword}}'},
        {action: 'openVodDetailFromResults', name: '进入详情页', keyword: '{{params.keyword}}'},
        {action: 'playAndAssert', name: '播放并校验', playTexts: ['播放', '立即播放', '继续播放'], playingTexts: ['暂停', '全屏', '倍速', '选集', '清晰度']},
        {action: 'waitAndCloseAd', name: '广告等待与关闭', timeoutMs: 12000, required: false, saveArtifacts: true},
        {action: 'enterFullscreen', name: '进入全屏', texts: ['mediaControl fullscreen', '全屏'], assertTexts: ['倍速', '清晰度', '选集', '暂停']},
        {action: 'playerGestureSuite', name: '双击/长按/拖进度条', gestures: ['doubleTapRight', 'doubleTapLeft', 'longPress', 'dragProgress'], assertTexts: ['暂停', '倍速', '清晰度', '选集'], saveArtifacts: true},
      ],
    },
    adGuard: {
      title: '广告等待与关闭回归',
      group: '播放',
      priority: 'P1',
      tags: ['播放', '广告', '弹窗'],
      description: '进入播放后等待贴片广告、会员免广告等弹层，识别跳过/关闭/X 并回到播放态。',
      params: {keyword: '歌手'},
      steps: [
        ...commonHome,
        {action: 'searchKeyword', name: '搜索内容', keyword: '{{params.keyword}}'},
        {action: 'openVodDetailFromResults', name: '进入详情页', keyword: '{{params.keyword}}'},
        {action: 'playAndAssert', name: '点击播放', playTexts: ['播放', '立即播放', '继续播放'], playingTexts: ['暂停', '全屏', '倍速', '选集', '清晰度'], required: false},
        {action: 'waitAndCloseAd', name: '等待广告并关闭', timeoutMs: 15000, texts: ['广告', '跳过', '会员免广告', '倒计时'], required: false, saveArtifacts: true},
        {action: 'assertAnyText', name: '回到播放上下文', texts: ['暂停', '全屏', '倍速', '选集', '清晰度'], required: false},
      ],
    },
    startupAd: {
      title: '冷启动与温启动广告等待回归',
      group: '稳定性',
      priority: 'P0',
      tags: ['启动', '广告', '稳定性'],
      description: '覆盖冷启动开机广告等待、后台 3s 温启动广告等待与关闭，保证后续动作不会被广告阻断。',
      params: {},
      steps: [
        {action: 'relaunchToHome', name: '冷启动并等待广告', timeoutMs: 6500, saveStartupAdArtifacts: true},
        {action: 'assertAnyText', name: '冷启动后首页可见', texts: ['刷片', '首页测试', '找片', '搜索'], required: false, budgetMs: 1000},
        {action: 'warmStart', name: '后台 3s 温启动并等待广告', backgroundSeconds: 3, timeoutMs: 6500, saveStartupAdArtifacts: true},
        {action: 'assertAnyText', name: '温启动后页面可继续', texts: ['刷片', '首页测试', '找片', '搜索', '暂停', '全屏'], required: false, budgetMs: 1000},
        {action: 'saveScreenshot', name: '保存启动广告处理后截图', filename: 'startup-ad-template.png'},
      ],
    },
    cashierGuard: {
      title: '会员收银台入口回归',
      group: '会员页',
      priority: 'P0',
      tags: ['会员', '收银台', '核心业务'],
      description: '覆盖会员入口与收银台展示，只做页面校验和返回，不触发支付确认。',
      params: {},
      steps: [
        ...commonHome,
        {action: 'clickAnyText', name: '进入会员入口', texts: ['开通会员', '会员', 'VIP']},
        {action: 'assertAnyText', name: '会员页基础校验', texts: ['VIP', '会员', '开通', '权益', '登录']},
        {action: 'openCashierAndAssert', name: '打开收银台并校验', entryTexts: ['立即开通', '开通会员', '会员免广告', 'VIP'], texts: ['收银台', '微信支付', '支付宝', '连续包月', '会员权益'], closeAfterAssert: true, saveArtifacts: true, required: false},
        {action: 'closeOrBack', name: '返回业务页', includeClose: true, includeBack: true, fallback: true, required: false},
      ],
    },
    vipPath: {
      title: '会员页路径回归',
      group: '会员页',
      priority: 'P1',
      tags: ['会员', '权益', '路径'],
      description: '从首页进入会员入口，校验开通、权益、登录等模块。',
      params: {},
      steps: [
        ...commonHome,
        {action: 'clickAnyText', name: '进入会员入口', texts: ['开通会员', '会员', 'VIP']},
        {action: 'assertAnyText', name: '会员页校验', texts: ['VIP', '会员', '开通', '权益', '登录']},
        {action: 'swipePercent', name: '会员页向上滑动', from: {x: 0.5, y: 0.78}, to: {x: 0.5, y: 0.28}},
        {action: 'saveScreenshot', name: '保存会员页截图', filename: 'vip-path-template.png'},
      ],
    },
    topicPath: {
      title: '专题活动页路径回归',
      group: '专题页',
      priority: 'P1',
      tags: ['专题', '活动', '路径'],
      description: '从首页进入专题或活动页，滑动内容区并校验入口。',
      params: {},
      steps: [
        ...commonHome,
        {action: 'clickAnyText', name: '进入专题活动入口', texts: ['专题', '活动', '更多', '芒果专题']},
        {action: 'assertAnyText', name: '专题页校验', texts: ['专题', '活动', '推荐', '更多']},
        {action: 'swipePercent', name: '专题页滑动', from: {x: 0.5, y: 0.78}, to: {x: 0.5, y: 0.22}},
        {action: 'closeOrBack', name: '返回首页', includeClose: true, includeBack: true, fallback: true},
        {action: 'saveScreenshot', name: '保存专题截图', filename: 'topic-path-template.png'},
      ],
    },
    popupStability: {
      title: '弹窗关闭稳定性回归',
      group: '稳定性',
      priority: 'P1',
      tags: ['稳定性', '弹窗', '关闭'],
      description: '多次识别关闭、X、返回控件，验证弹窗和跳转页不会阻断用例。',
      params: {},
      steps: [
        ...commonHome,
        {action: 'dismissCommonPopups', name: '再次关闭弹窗'},
        {action: 'assertAnyText', name: '首页未被阻断', texts: ['刷片', '首页测试', '找片', '搜索']},
        {action: 'closeOrBack', name: '识别关闭/返回', includeClose: true, includeBack: true, fallback: true, required: false},
        {action: 'saveScreenshot', name: '保存稳定性截图', filename: 'popup-stability-template.png'},
      ],
    },
  };
  return templates[value];
}

async function copyGuideTemplate(button) {
  await writeClipboard(JSON.stringify(JSON.parse(button.dataset.template), null, 2));
  els.statusText.textContent = `已复制「${button.textContent.trim()}」模板`;
}

async function uploadReferenceImages(files) {
  const [file] = await uniqueImageFiles(files);
  if (!file) {
    els.statusText.textContent = '图片已存在，已跳过重复上传';
    return;
  }
  const [result] = await uploadFiles([file]);
  state.coverImage = result?.path ?? '';
  renderImage();
  els.statusText.textContent = result?.duplicate
    ? `参考图已存在，复用：${result.filename}`
    : `已上传参考图：${result?.filename ?? file.name}`;
}

async function uploadGestureImages(files) {
  const imageFiles = await uniqueImageFiles(files);
  if (!imageFiles.length) {
    els.statusText.textContent = '图片已存在，已跳过重复上传';
    return;
  }
  const results = await uploadFiles(imageFiles);
  els.gestureAction.value = 'imageMatchAny';
  const current = splitList(els.gestureTarget.value).filter(isImageReference);
  const merged = [...new Set([...current, ...results.map((item) => item.path)])];
  els.gestureTarget.value = merged.join(', ');
  renderGestureImagePreview();
  const reused = results.filter((item) => item.duplicate).length;
  const uploaded = results.length - reused;
  els.statusText.textContent = `图片处理完成：新上传 ${uploaded} 张，复用 ${reused} 张`;
  els.gestureImageInput.value = '';
}

async function runSelected(options = {}) {
  const testCase = selectedCase();
  if (!testCase) {
    return;
  }
  try {
    els.runSelectedButton.disabled = true;
    els.runSelected100Button.disabled = true;
    setRunStatus('准备运行当前用例');
    const saved = await saveSelected();
    const repeat = Number(options.repeat ?? readRunRepeat());
    await startRun(
      {ids: [saved.id], repeat},
      `运行当前${repeat > 1 ? ` ${repeat} 次` : ''}：${saved.title}${options.labelSuffix ? ` · ${options.labelSuffix}` : ''}`
    );
  } catch (error) {
    setRunStatus(`运行失败：${String(error?.message ?? error)}`);
  } finally {
    els.runSelectedButton.disabled = false;
    els.runSelected100Button.disabled = false;
  }
}

async function runAll() {
  const enabledCount = state.cases.filter((item) => item.enabled !== false).length;
  if (enabledCount === 0) {
    setRunStatus('没有可运行的启用用例');
    return;
  }
  try {
    els.runAllButton.disabled = true;
    await saveSelected().catch(() => null);
    const repeat = readRunRepeat();
    await startRun({repeat}, `运行全部：${enabledCount} 条${repeat > 1 ? ` · 每条 ${repeat} 次` : ''}`);
  } catch (error) {
    setRunStatus(`运行失败：${String(error?.message ?? error)}`);
  } finally {
    els.runAllButton.disabled = false;
  }
}

async function runChecked() {
  if (state.checkedIds.size === 0) {
    setRunStatus('请先勾选要运行的用例');
    return;
  }
  try {
    await saveSelected().catch(() => null);
    const ids = [...state.checkedIds];
    const repeat = readRunRepeat();
    await startRun({ids, repeat}, `运行勾选：${ids.length} 条${repeat > 1 ? ` · 每条 ${repeat} 次` : ''}`);
  } catch (error) {
    setRunStatus(`运行失败：${String(error?.message ?? error)}`);
  }
}

async function runCurrentGroup() {
  const testCase = selectedCase();
  const group = state.selectedGroup === '全部' ? testCase?.group : state.selectedGroup;
  if (!group) {
    setRunStatus('请先选择一个分组或用例');
    return;
  }
  try {
    await saveSelected().catch(() => null);
    const repeat = readRunRepeat();
    await startRun({groups: [group], repeat}, `运行分组：${group}${repeat > 1 ? ` · 每条 ${repeat} 次` : ''}`);
  } catch (error) {
    setRunStatus(`运行失败：${String(error?.message ?? error)}`);
  }
}

function readRunRepeat() {
  const repeat = Number(els.runRepeatInput?.value ?? 1);
  if (!Number.isFinite(repeat) || repeat < 1) {
    if (els.runRepeatInput) {
      els.runRepeatInput.value = '1';
    }
    return 1;
  }
  const normalized = Math.min(10000, Math.floor(repeat));
  if (els.runRepeatInput && String(normalized) !== els.runRepeatInput.value) {
    els.runRepeatInput.value = String(normalized);
  }
  return normalized;
}

function clampRunRepeatInput() {
  const repeat = Number(els.runRepeatInput?.value ?? 1);
  if (!Number.isFinite(repeat)) {
    return;
  }
  if (repeat > 10000) {
    els.runRepeatInput.value = '10000';
  } else if (repeat < 1 && els.runRepeatInput.value !== '') {
    els.runRepeatInput.value = '1';
  }
}

async function startRun(payload, label) {
  els.runLog.textContent = `${label}\n准备提交...`;
  const run = await api('/api/runs', {method: 'POST', body: payload});
  state.runId = run.id;
  state.currentRun = run;
  updateRunActionState();
  setRunStatus(`${label} · 已启动`);
  renderOverview();
  renderRunProgress(run);
  els.runLog.textContent = run.log || run.command || `Run ${run.id} started`;
  startPollingRun();
  state.deviceConnected = true;
  setDeviceStatus('用例启动中，等待复用运行会话');
  startDevicePolling();
  await refreshRun();
}

function setRunStatus(text) {
  els.runStatusText.textContent = text;
  els.runLog.textContent = text;
}

function toggleVisibleSelection() {
  const allSelected = state.visibleIds.length > 0 && state.visibleIds.every((id) => state.checkedIds.has(id));
  for (const id of state.visibleIds) {
    if (allSelected) {
      state.checkedIds.delete(id);
    } else {
      state.checkedIds.add(id);
    }
  }
  renderList();
  renderEditor();
}

function startPollingRun() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(refreshRun, 1500);
}

async function refreshRun() {
  if (!state.runId) {
    return;
  }
  const run = await api(`/api/runs/${state.runId}`);
  state.currentRun = run;
  updateRunActionState();
  els.runStatusText.textContent =
    run.status === 'running'
      ? `运行中 · ${formatTime(run.startedAt)}`
      : `${runStatusLabel(run.status)} · ${formatTime(run.finishedAt)}`;
  renderRunProgress(run);
  renderOverview();
  els.runLog.textContent = run.log || run.command;
  if (run.status !== 'running') {
    clearInterval(state.pollTimer);
    await refreshCaseStats();
    renderOverview();
  }
}

async function pauseCurrentRun() {
  if (!state.currentRun || state.currentRun.status !== 'running') {
    return;
  }
  els.pauseRunButton.disabled = true;
  els.pauseRunButton.textContent = '暂停中';
  try {
    const result = await api('/api/runs/active/stop', {method: 'POST', body: {}});
    setRunStatus(result.stopped ? '已发送暂停指令' : '当前没有运行中的用例');
    await refreshRun();
  } catch (error) {
    setRunStatus(`暂停失败：${String(error?.message ?? error)}`);
  } finally {
    updateRunActionState();
  }
}

function updateRunActionState() {
  const isRunning = state.currentRun?.status === 'running';
  els.pauseRunButton.disabled = !isRunning;
  els.pauseRunButton.textContent = isRunning ? '暂停执行' : '暂停执行';
}

function runStatusLabel(status) {
  if (status === 'passed') {
    return '通过';
  }
  if (status === 'failed') {
    return '失败';
  }
  if (status === 'paused') {
    return '已暂停';
  }
  return '等待中';
}

function renderRunProgress(run) {
  const progress = run?.progress;
  if (!progress) {
    els.runProgress.className = 'run-progress idle';
    els.runProgressTitle.textContent = '未开始';
    els.runProgressPercent.textContent = '0%';
    els.runProgressFill.style.width = '0%';
    els.runProgressCase.textContent = '等待提交运行';
    els.runProgressStep.textContent = '-';
    return;
  }

  const percent = run.status === 'passed' ? 100 : Math.max(0, Math.min(100, Number(progress.percent ?? 0)));
  const statusText =
    run.status === 'running'
      ? '执行中'
      : run.status === 'passed'
        ? '已通过'
        : run.status === 'failed'
          ? '已失败'
          : run.status === 'paused'
            ? '已暂停'
            : '等待中';
  els.runProgress.className = `run-progress ${run.status}`;
  els.runProgressTitle.textContent = `${statusText} · ${progress.completedCases}/${progress.totalCases} 用例`;
  els.runProgressPercent.textContent = `${percent}%`;
  els.runProgressFill.style.width = `${percent}%`;

  const caseText = progress.currentCaseTitle
    ? `当前用例 ${progress.currentCaseIndex}/${progress.totalCases}：${progress.currentCaseTitle}`
    : `准备运行 ${progress.totalCases} 条用例`;
  const stepText = progress.currentStepName
    ? `当前步骤 ${progress.currentStepIndex}/${progress.totalSteps || '-'}：${progress.currentStepName}`
    : '等待第一步开始';
  els.runProgressCase.textContent = caseText;
  els.runProgressStep.textContent = stepText;
}

async function refreshCaseStats() {
  const stats = await api('/api/case-stats');
  state.caseStats = stats.cases ?? {};
  state.caseReports = stats.reports ?? [];
  renderOverview();
  renderList();
  renderStats(selectedCase());
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

async function connectDevice() {
  try {
    setDeviceStatus('正在连接设备');
    els.connectDeviceButton.disabled = true;
    await api('/api/device-screen/start', {method: 'POST', body: {}});
    state.deviceConnected = true;
    await refreshDeviceScreen();
    startDevicePolling();
  } catch (error) {
    state.deviceConnected = false;
    clearInterval(state.devicePollTimer);
    showDeviceError(error);
  } finally {
    els.connectDeviceButton.disabled = false;
  }
}

async function refreshDeviceScreen() {
  if (state.deviceRefreshInFlight) {
    return;
  }
  state.deviceRefreshInFlight = true;
  let screen;
  try {
    screen = await api('/api/device-screen/screenshot');
  } catch (error) {
    showDeviceError(error);
    return;
  } finally {
    state.deviceRefreshInFlight = false;
  }
  if (!screen.connected) {
    state.deviceConnected = false;
    state.deviceCapturedAt = '';
    state.deviceCaptureDurationMs = 0;
    clearInterval(state.devicePollTimer);
    clearInterval(state.deviceAgeTimer);
    setDeviceStatus(screen.error ? `已断开：${screen.error}` : '未连接');
    renderDeviceCaptureTime();
    els.devicePreview.textContent = '连接后显示手机当前屏幕';
    return;
  }

  state.deviceConnected = true;
  if (screen.pending || !screen.dataUrl) {
    setDeviceStatus(screen.message ?? '等待设备画面');
    renderDeviceCaptureTime();
    startDevicePolling();
    if (!els.devicePreview.querySelector('.device-frame')) {
      els.devicePreview.textContent = screen.message ?? '等待设备画面';
    }
    return;
  }
  state.deviceCapturedAt = screen.capturedAt ?? '';
  state.deviceCaptureDurationMs = Number(screen.captureDurationMs ?? 0);
  setDeviceStatus(`${screen.appName}${screen.backend ? ` · ${screen.backend}` : ''}`);
  renderDeviceCaptureTime();
  startDeviceAgeTimer();
  els.devicePreview.innerHTML = '';
  const frame = document.createElement('div');
  frame.className = 'device-frame';
  if (screen.windowRect?.width && screen.windowRect?.height) {
    frame.style.setProperty(
      '--device-ratio',
      `${Math.round(screen.windowRect.width)} / ${Math.round(screen.windowRect.height)}`
    );
    frame.dataset.nativeWidth = String(Math.round(screen.windowRect.width));
  }
  const image = document.createElement('img');
  image.src = screen.dataUrl;
  image.alt = '手机当前屏幕';
  frame.append(image);
  els.devicePreview.append(frame);
  applyDeviceScale();
}

function startDevicePolling() {
  clearInterval(state.devicePollTimer);
  if (!state.deviceConnected || state.deviceInterval === 'manual') {
    return;
  }
  state.devicePollTimer = setInterval(refreshDeviceScreen, Number(state.deviceInterval));
}

async function captureDeviceAsReference() {
  try {
    const testCase = selectedCase();
    const filename = `${testCase?.id ?? 'device-screen'}-${Date.now().toString(36)}.png`;
    const capture = await api('/api/device-screen/capture', {
      method: 'POST',
      body: {filename},
    });
    state.coverImage = capture.path;
    renderImage();
    setDeviceStatus(`已保存参考图：${capture.filename}`);
  } catch (error) {
    showDeviceError(error);
  }
}

async function stopDevice() {
  clearInterval(state.devicePollTimer);
  await api('/api/device-screen/stop', {method: 'POST', body: {}});
  state.deviceConnected = false;
  state.deviceCapturedAt = '';
  state.deviceCaptureDurationMs = 0;
  clearInterval(state.deviceAgeTimer);
  setDeviceStatus('未连接');
  renderDeviceCaptureTime();
  els.devicePreview.textContent = '连接后显示手机当前屏幕';
}

function setDeviceStatus(text) {
  els.deviceStatus.textContent = text;
}

function startDeviceAgeTimer() {
  clearInterval(state.deviceAgeTimer);
  state.deviceAgeTimer = setInterval(renderDeviceCaptureTime, 1000);
}

function renderDeviceCaptureTime() {
  if (!state.deviceCapturedAt) {
    els.deviceCapturedAt.textContent = '未采集';
    return;
  }
  const capturedTime = new Date(state.deviceCapturedAt);
  const ageSeconds = Math.max(0, Math.floor((Date.now() - capturedTime.getTime()) / 1000));
  const durationText = state.deviceCaptureDurationMs ? ` · 耗时 ${state.deviceCaptureDurationMs}ms` : '';
  els.deviceCapturedAt.textContent = `采集 ${formatTime(state.deviceCapturedAt)} · ${ageSeconds}秒前${durationText}`;
}

function applyDeviceScale() {
  const panel = els.devicePreview.closest('.device-panel');
  const frame = els.devicePreview.querySelector('.device-frame');
  const width =
    state.deviceScale === 'native' ? frame?.dataset.nativeWidth || '393' : state.deviceScale;
  panel?.style.setProperty('--device-preview-width', `${width}px`);
  frame?.style.setProperty('--device-preview-width', `${width}px`);
}

function showDeviceError(error) {
  const message = String(error?.message ?? error);
  if (message.includes('InvalidHostID')) {
    setDeviceStatus('手机信任配对失效');
    state.deviceCapturedAt = '';
    renderDeviceCaptureTime();
    els.devicePreview.textContent =
      '请重新插拔手机，解锁后点“信任此电脑”；必要时在手机 设置 > 通用 > 传输或还原 iPhone > 还原 > 还原位置与隐私 后重新信任。';
    return;
  }
  if (message.includes('Developer App Certificate is not trusted')) {
    setDeviceStatus('开发者证书未信任');
    state.deviceCapturedAt = '';
    renderDeviceCaptureTime();
    els.devicePreview.textContent =
      '请在手机上进入 设置 > 通用 > VPN与设备管理，信任开发者证书后再连接。';
    return;
  }
  if (message.includes('Not authorized for performing UI testing actions') || message.includes('未授权 UI Testing')) {
    setDeviceStatus('UI Testing 未授权');
    state.deviceCapturedAt = '';
    renderDeviceCaptureTime();
    els.devicePreview.textContent =
      '手机已连接，WDA 也已连通，但 iOS 拒绝截图/UI 测试。请保持手机解锁，进入 设置 > 开发者，确认 UI Automation 已开启；如果弹出“允许/信任/开发者工具/WebDriverAgent”提示请点允许，然后重新连接。';
    return;
  }
  if (message.includes('bundle identifier') || message.includes('App 包名')) {
    setDeviceStatus('App 包名不匹配');
    state.deviceCapturedAt = '';
    renderDeviceCaptureTime();
    els.devicePreview.textContent =
      '手机上没有找到当前配置的 App。后台已支持芒果TV国内版/国际版包名自动尝试，请确认手机上已安装芒果TV，并重新点击连接。';
    return;
  }
  if (message.includes('screenshotr service') || message.includes('系统截图通道也不可用')) {
    setDeviceStatus('截图服务不可用');
    state.deviceCapturedAt = '';
    renderDeviceCaptureTime();
    els.devicePreview.textContent =
      '系统截图通道不可用，正在依赖 WebDriverAgent 截图；请先处理手机上的 UI Testing 授权后再连接。';
    return;
  }
  setDeviceStatus(message);
  state.deviceCapturedAt = '';
  renderDeviceCaptureTime();
  els.devicePreview.textContent = message;
}

function formatTime(value) {
  if (!value) {
    return '';
  }
  return new Date(value).toLocaleTimeString();
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString();
}

function formatDuration(value) {
  const ms = Number(value ?? 0);
  if (!ms) {
    return '-';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function formatShortDuration(value) {
  const text = formatDuration(value);
  return text === '-' ? '无耗时' : text;
}

function selectedCase() {
  return state.cases.find((item) => item.id === state.selectedId);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {'Content-Type': 'application/json'},
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? `${response.status} ${url}`);
  }
  return payload;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setupUploadZone(zone, {input, onFiles, openOnClick = false, multiple = false}) {
  if (!zone || !input) {
    return;
  }

  zone.addEventListener('click', (event) => {
    if (!openOnClick || input.disabled) {
      return;
    }
    if (event.target === input) {
      return;
    }
    input.click();
  });

  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (!input.disabled) {
      zone.classList.add('dragover');
    }
  });

  zone.addEventListener('dragleave', (event) => {
    if (zone.contains(event.relatedTarget)) {
      return;
    }
    zone.classList.remove('dragover');
  });

  zone.addEventListener('drop', async (event) => {
    event.preventDefault();
    zone.classList.remove('dragover');
    if (input.disabled) {
      return;
    }
    const files = normalizeImageFiles(event.dataTransfer?.files);
    if (files.length === 0) {
      return;
    }
    await onFiles(multiple ? files : files.slice(0, 1));
  });

  input.addEventListener('change', async () => {
    if (input.disabled) {
      return;
    }
    const files = normalizeImageFiles(input.files);
    if (files.length === 0) {
      return;
    }
    try {
      await onFiles(multiple ? files : files.slice(0, 1));
    } finally {
      input.value = '';
    }
  });
}

function normalizeImageFiles(files) {
  return [...(files ?? [])].filter((file) => String(file?.type ?? '').startsWith('image/'));
}

async function uniqueImageFiles(files) {
  const unique = [];
  const seen = new Set();
  for (const file of normalizeImageFiles(files)) {
    const hash = await hashFile(file);
    if (seen.has(hash)) {
      continue;
    }
    seen.add(hash);
    unique.push(file);
  }
  return unique;
}

function isImageReference(value) {
  const text = String(value ?? '').trim();
  return /^\/?uploads\//.test(text) || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(text);
}

async function uploadFiles(files) {
  const results = [];
  for (const file of files) {
    const hash = await hashFile(file);
    const cached = state.uploadedImageByHash.get(hash);
    if (cached) {
      results.push({...cached, duplicate: true, hash});
      continue;
    }
    const dataUrl = await readFileAsDataUrl(file);
    const result = await api('/api/uploads', {
      method: 'POST',
      body: {filename: file.name, dataUrl},
    });
    if (result?.path) {
      state.uploadedImageByHash.set(result.hash ?? hash, result);
    }
    results.push(result);
  }
  return results;
}

async function hashFile(file) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

function removeUndefined(_key, value) {
  return value === undefined ? undefined : value;
}
