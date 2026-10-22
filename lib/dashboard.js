(function startDashboard() {
  const {
    calculateSimulation,
    buildAggregateCsv,
    historicalGrowth,
    monthlySeries,
    parseSimulationInputs,
    preferredMonth,
    rowsForScope,
  } = window.KpiSimulator;
  const stateNames = { PR: 'Paraná', SC: 'Santa Catarina', RS: 'Rio Grande do Sul' };
  const statusGroups = [
    ['Não tratado', 'Não tratado'],
    ['Autorizado', 'Autorizado'],
    ['Em Execução', 'Em execução'],
    ['Concluído', 'Concluído'],
    ['Não autorizado', 'Não autorizado'],
    ['Prédio já adequado', 'Prédio já adequado'],
    ['Outros status', 'Outros status'],
  ];
  const statusLabels = statusGroups.map(([, label]) => label);
  const statusKeys = Object.fromEntries(statusGroups.map(([key, label]) => [label, key]));
  const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const moneyFormat = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const loginPanel = document.getElementById('login-panel');
  const dashboard = document.getElementById('dashboard');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const loginError = document.getElementById('login-error');
  const dashboardError = document.getElementById('dashboard-error');
  const monthSelect = document.getElementById('month');
  const stateFilter = document.getElementById('state-filter');
  const snapshotStatus = document.getElementById('snapshot-status');
  let snapshot = null;
  let refreshRequestId = 0;

  function count(value) {
    return Number.isSafeInteger(value) && value >= 0
      ? numberFormat.format(value)
      : 'Não disponível';
  }

  function amount(value) {
    return Number.isFinite(value) ? moneyFormat.format(value) : 'Não disponível';
  }

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function stateLabel(state) {
    return state === 'SUL' ? 'Regional Sul' : `${stateNames[state] || 'UF não reconhecida'} (${state})`;
  }

  function currentMonthSaoPaulo() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date());
  }

  function isCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function isNullableCount(value) {
    return value === null || isCount(value);
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function hasAllStates(rows) {
    return Array.isArray(rows)
      && rows.length === 3
      && new Set(rows.map((state) => state?.state)).size === 3
      && ['PR', 'SC', 'RS'].every((code) => rows.some((state) => state?.state === code));
  }

  function validCurrentState(state) {
    return isRecord(state)
      && isCount(state.addresses)
      && isRecord(state.statuses)
      && statusLabels.every((status) => isCount(state.statuses[statusKeys[status]]))
      && isCount(state.releasedBlocks)
      && isCount(state.releasedBlocksMissing);
  }

  function validMonthlyPeriod(period) {
    return isRecord(period)
      && typeof period.month === 'string'
      && /^\d{4}-(0[1-9]|1[0-2])$/.test(period.month)
      && hasAllStates(period.states)
      && period.states.every((state) => (
        isRecord(state)
        && isNullableCount(state.goal)
        && isNullableCount(state.actual)
        && isCount(state.entries)
        && isCount(state.missingBlocks)
      ))
      && isRecord(period.regional)
      && period.regional.state === 'SUL'
      && isNullableCount(period.regional.goal)
      && isNullableCount(period.regional.actual)
      && isCount(period.regional.entries)
      && isCount(period.regional.missingBlocks);
  }

  function showLogin(message = '') {
    refreshRequestId += 1;
    loginPanel.hidden = false;
    dashboard.hidden = true;
    dashboardError.textContent = '';
    loginError.textContent = message;
    snapshotStatus.hidden = true;
    snapshot = null;
  }

  function markSnapshotStale(message) {
    if (!snapshot) {
      dashboardError.textContent = message;
      return;
    }
    const lastSuccess = document.getElementById('updated-at').textContent || 'horário indisponível';
    snapshotStatus.hidden = false;
    snapshotStatus.className = 'stale';
    snapshotStatus.textContent = 'DESATUALIZADO';
    dashboardError.textContent =
      `A atualização falhou; os dados exibidos estão DESATUALIZADOS. ${lastSuccess}. ${message}`;
  }

  function populatePeriods(data) {
    const selected = monthSelect.value;
    monthSelect.replaceChildren();
    const months = data.monthly
      .map((period) => period.month)
      .filter((month) => typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month));
    const placeholder = node('option', 'Não disponível (sem competência atual ou anterior)');
    placeholder.value = '';
    monthSelect.append(placeholder);
    for (const month of months) {
      const option = node('option', month);
      option.value = month;
      monthSelect.append(option);
    }
    if (months.includes(selected)) {
      monthSelect.value = selected;
    } else {
      const currentMonth = currentMonthSaoPaulo();
      monthSelect.value = preferredMonth(months, currentMonth) || '';
    }
  }

  function renderStatusChart() {
    const container = document.getElementById('status-chart');
    const legend = document.getElementById('status-legend');
    container.replaceChildren();
    legend.replaceChildren();
    const selected = stateFilter.value;
    const states = selected === 'SUL'
      ? snapshot.states
      : snapshot.states.filter((state) => state.state === selected);
    for (const state of states) {
      const row = node('div', undefined, 'chart-row');
      row.append(node('span', stateLabel(state.state), 'chart-label'));
      const total = state.addresses;
      const bar = node('div', undefined, 'stacked-bar');
      const label = statusLabels.map((status) => (
        `${status}: ${count(state.statuses?.[statusKeys[status]])}`
      )).join('; ');
      bar.setAttribute('role', 'img');
      bar.setAttribute('aria-label', `${stateLabel(state.state)}. ${label}. Total de endereços: ${count(total)}.`);
      if (total > 0) {
        statusLabels.forEach((status, index) => {
          const value = state.statuses?.[statusKeys[status]];
          if (!Number.isSafeInteger(value) || value <= 0) return;
          const segment = node('span', undefined, `stack-segment status-${index}`);
          segment.style.width = `${(value / total) * 100}%`;
          segment.setAttribute('aria-hidden', 'true');
          bar.append(segment);
        });
      }
      row.append(bar);
      container.append(row);
    }
    if (!states.length) container.append(node('p', 'Não há agregados de status disponíveis para esta seleção.', 'muted'));
    statusLabels.forEach((status, index) => {
      const item = node('li', undefined);
      const swatch = node('span', undefined, `legend-swatch status-${index}`);
      swatch.setAttribute('aria-hidden', 'true');
      item.append(swatch, document.createTextNode(status));
      legend.append(item);
    });
  }

  function addMonthBar(row, label, value, maximum, className) {
    const series = node('div', undefined, 'month-series');
    series.append(node('span', label));
    if (value === null) {
      series.append(node('span', '—', 'muted'));
      series.append(node('strong', 'Não disponível'));
      row.append(series);
      return;
    }
    const track = node('span', undefined, `value-bar${className ? ` ${className}` : ''}`);
    track.setAttribute('aria-hidden', 'true');
    const fill = node('span');
    fill.style.width = value === 0 ? '0%' : `${Math.max(1, (value / maximum) * 100)}%`;
    track.append(fill);
    series.append(track, node('strong', count(value)));
    row.append(series);
  }

  function renderMonthlyChart() {
    const container = document.getElementById('monthly-chart');
    const figure = container.closest('figure');
    figure.setAttribute(
      'aria-label',
      `Histórico mensal de metas cadastradas e produção derivada até o mês corrente para ${stateLabel(stateFilter.value)}. Competências futuras não são mostradas como projeção.`,
    );
    container.replaceChildren();
    const currentMonth = currentMonthSaoPaulo();
    const series = monthlySeries(snapshot.monthly, stateFilter.value)
      .filter((item) => item.month <= currentMonth);
    const available = series.flatMap((item) => [item.goal, item.actual])
      .filter((value) => value !== null);
    if (!series.length || !available.length) {
      container.append(node('p', 'Meta e produção derivada não estão disponíveis para a seleção.', 'muted'));
      return;
    }
    const maximum = Math.max(...available, 1);
    for (const item of series) {
      const row = node('div', undefined, 'month-row');
      row.append(node('span', item.month || 'Período', 'month-row-title'));
      addMonthBar(row, 'Meta', item.goal, maximum, '');
      addMonthBar(row, 'Produção', item.actual, maximum, 'actual');
      container.append(row);
    }
  }

  function renderGrowthChart() {
    const container = document.getElementById('growth-chart');
    container.replaceChildren();
    const history = historicalGrowth(snapshot.monthly, stateFilter.value, currentMonthSaoPaulo());
    const comparable = history.filter((item) => item.percent !== null);
    if (!history.length) {
      container.append(node('p', 'Não há produção mensal derivada válida para exibir neste recorte.', 'muted'));
      return;
    }
    if (!comparable.length) {
      container.append(node('p', 'Há meses com produção derivada, mas não existe mês imediatamente anterior comparável.', 'muted'));
    }
    const maxChange = Math.max(1, ...comparable.map((item) => Math.abs(item.percent)));
    for (const item of history) {
      const row = node('div', undefined, 'growth-row');
      row.append(node('span', item.month, 'month-row-title'));
      if (item.percent === null) {
        row.append(node('span', undefined, 'growth-no-comparison'));
        row.append(node('strong', `${count(item.actual)} · sem base mensal comparável`));
      } else {
        const track = node('span', undefined, 'growth-track');
        const bar = node('span', undefined, `growth-bar ${item.percent < 0 ? 'negative' : 'positive'}`);
        bar.style.width = `${Math.min(50, (Math.abs(item.percent) / maxChange) * 50)}%`;
        bar.setAttribute('aria-hidden', 'true');
        track.setAttribute('role', 'img');
        track.setAttribute(
          'aria-label',
          `${item.month}: ${item.percent > 0 ? 'crescimento' : item.percent < 0 ? 'redução' : 'sem variação'} de ${item.percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% versus o mês anterior.`,
        );
        track.append(bar);
        const sign = item.percent > 0 ? '+' : '';
        row.append(
          track,
          node('strong', `${count(item.actual)} · ${sign}${item.percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`),
        );
      }
      container.append(row);
    }
  }

  function renderGrowthTable() {
    const history = historicalGrowth(snapshot.monthly, stateFilter.value, currentMonthSaoPaulo());
    if (!history.length) {
      document.getElementById('growth-table').replaceChildren(
        node('p', 'Sem histórico válido de produção derivada para este recorte.', 'muted'),
      );
      return;
    }
    addTable(
      document.getElementById('growth-table'),
      `Série histórica de produção derivada — ${stateLabel(stateFilter.value)}`,
      ['Mês', 'Produção derivada', 'Mês anterior disponível', 'Variação absoluta', 'Variação percentual'],
      history.map((item) => [
        item.month,
        count(item.actual),
        item.previousActual === null ? 'Não disponível' : count(item.previousActual),
        item.change === null ? 'Não comparável' : numberFormat.format(item.change),
        item.percent === null
          ? 'Não comparável'
          : `${item.percent > 0 ? '+' : ''}${item.percent.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
      ]),
    );
  }

  function addTable(container, captionText, headers, rows) {
    container.replaceChildren();
    const table = node('table');
    const captionElement = node('caption', captionText);
    const thead = node('thead');
    const headerRow = node('tr');
    headers.forEach((label, index) => {
      const cell = node('th', label);
      cell.scope = 'col';
      headerRow.append(cell);
    });
    thead.append(headerRow);
    const tbody = node('tbody');
    for (const row of rows) {
      const tr = node('tr');
      row.forEach((value, index) => {
        const cell = node(index === 0 ? 'th' : 'td', String(value));
        if (index === 0) cell.scope = 'row';
        tr.append(cell);
      });
      tbody.append(tr);
    }
    table.append(captionElement, thead, tbody);
    container.append(table);
  }

  function renderAddressTable() {
    const rows = rowsForScope(snapshot.states, snapshot.regional, stateFilter.value);
    addTable(
      document.getElementById('address-table'),
      'Endereços por status e quantidades de blocos liberados (medidas distintas)',
      [
        'UF / abrangência',
        'Endereços',
        ...statusLabels,
        'Blocos liberados',
        'Endereços autorizados sem quantidade de blocos',
      ],
      rows.map((state) => [
        stateLabel(state.state),
        count(state.addresses),
        ...statusLabels.map((status) => count(state.statuses?.[statusKeys[status]])),
        count(state.releasedBlocks),
        count(state.releasedBlocksMissing),
      ]),
    );
  }

  function renderMonthlyTable() {
    const month = snapshot.monthly.find((period) => period.month === monthSelect.value);
    const container = document.getElementById('monthly-table');
    const note = document.getElementById('monthly-period-note');
    if (!month) {
      note.textContent = 'Não há competência mensal disponível para este recorte.';
      container.replaceChildren(node('p', 'Não há período mensal disponível na fonte.', 'muted'));
      return;
    }
    note.textContent = month.month > currentMonthSaoPaulo()
      ? 'Competência futura: a meta cadastrada abaixo não é previsão, produção ou projeção de execução.'
      : 'A meta é o valor cadastrado para a competência; a produção permanece derivada dos registros disponíveis.';
    const rows = rowsForScope(month.states, month.regional, stateFilter.value);
    addTable(
      container,
      `Metas e produção derivada — ${month.month}`,
      [
        'UF / abrangência',
        'Meta mensal',
        'Produção derivada',
        'Diferença (produção derivada − meta)',
        'Registros derivados',
        'Registros sem quantidade de blocos',
      ],
      rows.map((state) => {
        const difference = state.goal !== null && state.actual !== null
          ? numberFormat.format(state.actual - state.goal)
          : 'Não disponível';
        return [
          stateLabel(state.state),
          count(state.goal),
          count(state.actual),
          difference,
          count(state.entries),
          count(state.missingBlocks),
        ];
      }),
    );
  }

  function renderAvailabilityTable() {
    const unavailable = snapshot.limitations?.unavailable;
    if (!Array.isArray(unavailable) || !unavailable.every((item) => typeof item === 'string')) {
      throw new Error('A resposta KPI não informou corretamente os dados indisponíveis.');
    }
    addTable(
      document.getElementById('availability-table'),
      'Módulos sem fonte validada integrada',
      ['Métrica / módulo', 'Disponibilidade'],
      unavailable.map((item) => [item, 'Indisponível — sem fonte validada conectada']),
    );
  }

  function renderExecutiveSummary() {
    const scopedStates = rowsForScope(snapshot.states, snapshot.regional, stateFilter.value);
    const addressTotals = scopedStates.map((state) => (
      `${state.state}: ${count(state.addresses)} endereços; ${count(state.releasedBlocks)} blocos liberados`
    ));
    const month = snapshot.monthly.find((period) => period.month === monthSelect.value);
    const monthlySummary = month
      ? rowsForScope(month.states, month.regional, stateFilter.value).map((state) => (
        `${stateLabel(state.state)}: meta ${count(state.goal)}; produção derivada ${count(state.actual)}`
      )).join(' · ')
      : 'Sem período mensal disponível na fonte.';
    document.getElementById('executive-summary').textContent =
      `${addressTotals.join(' · ')}. Período ${month?.month || 'não disponível'}: ${monthlySummary}`;
  }

  function renderSimulator() {
    const results = document.getElementById('simulator-results');
    const message = document.getElementById('simulator-message');
    const state = document.getElementById('sim-state').value;
    const month = monthSelect.value || 'período da fonte não selecionado';
    const ufCount = state === 'SUL' ? 3 : 1;
    const ufScope = state === 'SUL' ? 'PR + SC + RS' : state;
    document.getElementById('simulator-scope').textContent =
      `Escopo da simulação: ${stateLabel(state)} · ${ufScope} · ${ufCount} ${ufCount === 1 ? 'UF' : 'UFs'} · ${month}.`;

    const inputs = parseSimulationInputs({
      units: document.getElementById('sim-units').value,
      revenuePerUnit: document.getElementById('sim-revenue').value,
      partnerPerUnit: document.getElementById('sim-partner').value,
      contributionPerUnit: document.getElementById('sim-contribution').value,
      fixedCostPerUfMonth: document.getElementById('sim-fixed-cost').value,
    });
    results.replaceChildren();
    if (!inputs) {
      results.hidden = true;
      message.className = 'muted';
      message.textContent = 'Informe unidades inteiras (incluindo zero, se for o cenário desejado) e premissas monetárias válidas para calcular. Valores vazios ou inválidos não são convertidos em zero.';
      return;
    }
    const calculation = calculateSimulation(inputs, ufCount);
    if (!calculation) {
      results.hidden = true;
      message.className = 'negative';
      message.textContent = 'Os valores informados excedem o limite seguro de cálculo.';
      return;
    }

    const output = [
      ['Unidades do cenário', numberFormat.format(inputs.units)],
      ['Receita potencial (simulação)', amount(calculation.potentialRevenue)],
      ['Parcela do parceiro (simulação)', amount(calculation.partnerAmount)],
      ['Receita menos parcela do parceiro', amount(calculation.grossLessPartner)],
      ['Contribuição pela premissa editada', amount(calculation.contribution)],
      ['Diferença entre as duas fórmulas', amount(calculation.contributionDifference)],
      ['Premissa de custo fixo por UF/mês', amount(calculation.fixedCostPerUfMonth)],
      [
        'Custo fixo total do cenário',
        `${calculation.fixedCostUfCount} × ${amount(calculation.fixedCostPerUfMonth)} = ${amount(calculation.fixedCost)}`,
      ],
      ['Saldo simulado após custo fixo', amount(calculation.netAfterFixedCost)],
      ['Unidades para cobrir o custo fixo (ponto de equilíbrio)', calculation.breakEvenUnits === null
        ? 'Não disponível quando contribuição por unidade é zero'
        : numberFormat.format(calculation.breakEvenUnits)],
    ];
    for (const [label, value] of output) {
      const item = node('div', undefined, 'result');
      item.append(node('dt', label), node('dd', value));
      results.append(item);
    }
    results.hidden = false;
    message.className = calculation.netAfterFixedCost >= 0 ? 'positive' : 'negative';
    message.textContent = calculation.netAfterFixedCost >= 0
      ? 'Resultado hipotético antes de quaisquer outros custos ou restrições não modelados.'
      : 'Neste cenário hipotético, a contribuição assumida fica abaixo do custo fixo informado.';
  }

  function renderSnapshot(data) {
    if (
      !isRecord(data)
      || !hasAllStates(data.states)
      || !data.states.every(validCurrentState)
      || !Array.isArray(data.monthly)
      || !data.monthly.every(validMonthlyPeriod)
      || new Set(data.monthly.map((period) => period.month)).size !== data.monthly.length
      || !isRecord(data.regional)
      || data.regional.state !== 'SUL'
      || !validCurrentState(data.regional)
      || !isRecord(data.limitations)
      || !Array.isArray(data.limitations.unavailable)
      || !data.limitations.unavailable.every((item) => typeof item === 'string')
    ) throw new Error('A resposta KPI tem formato inválido.');
    snapshot = data;
    populatePeriods(data);
    renderStatusChart();
    renderMonthlyChart();
    renderGrowthChart();
    renderGrowthTable();
    renderAddressTable();
    renderMonthlyTable();
    renderAvailabilityTable();
    renderSimulator();
    renderExecutiveSummary();

    const extracted = new Date(data.extractedAt);
    document.getElementById('updated-at').textContent = Number.isNaN(extracted.getTime())
      ? 'Última consulta bem-sucedida: horário indisponível'
      : `Última consulta bem-sucedida: ${extracted.toLocaleString('pt-BR')}`;
    snapshotStatus.hidden = false;
    snapshotStatus.className = '';
    snapshotStatus.textContent = 'Atualizado';
    document.getElementById('source-info').textContent =
      `Revisões da fonte — endereços: ${count(data.revisions?.addresses)}; prumadas: ${count(data.revisions?.prumadas)}. Atualidade da fonte: não verificada. ${data.limitations?.production || ''}`;
    loginPanel.hidden = true;
    dashboard.hidden = false;
    dashboardError.textContent = '';
  }

  async function refresh() {
    const requestId = ++refreshRequestId;
    try {
      const response = await fetch('/api/kpi', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const result = await response.json();
      if (requestId !== refreshRequestId) return;
      if (response.status === 401) {
        showLogin(snapshot
          ? 'Sua sessão expirou. Entre novamente.'
          : 'Entre com sua conta do Worker para consultar os indicadores.');
        return;
      }
      if (response.status === 403) {
        showLogin(result.error || 'Acesso permitido somente ao Gestor Master.');
        return;
      }
      if (!response.ok) throw new Error(result.error || 'Não foi possível consultar os indicadores.');
      renderSnapshot(result);
    } catch (error) {
      if (requestId !== refreshRequestId) return;
      if (dashboard.hidden) loginError.textContent = error.message;
      else markSnapshotStale(error.message);
    }
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('login-button');
    button.disabled = true;
    loginError.textContent = '';
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('email').value,
          password: passwordInput.value,
        }),
      });
      passwordInput.value = '';
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível autenticar.');
      await refresh();
    } catch (error) {
      passwordInput.value = '';
      loginError.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById('logout').addEventListener('click', async () => {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: '{}',
      });
      if (!response.ok) throw new Error('Não foi possível confirmar a saída no Worker.');
    } catch (error) {
      showLogin(error.message);
      return;
    }
    showLogin();
  });

  document.getElementById('refresh').addEventListener('click', refresh);
  stateFilter.addEventListener('change', () => {
    if (!snapshot) return;
    renderStatusChart();
    renderMonthlyChart();
    renderGrowthChart();
    renderGrowthTable();
    renderAddressTable();
    renderMonthlyTable();
    renderExecutiveSummary();
  });
  monthSelect.addEventListener('change', () => {
    if (!snapshot) return;
    renderMonthlyTable();
    renderSimulator();
    renderExecutiveSummary();
  });
  document.getElementById('sim-state').addEventListener('change', renderSimulator);
  document.getElementById('simulator-form').addEventListener('submit', (event) => event.preventDefault());
  document.getElementById('simulator-form').addEventListener('input', renderSimulator);
  document.getElementById('print-summary').addEventListener('click', () => window.print());
  document.getElementById('export-csv').addEventListener('click', () => {
    try {
      const csv = buildAggregateCsv(
        snapshot,
        stateFilter.value,
        monthSelect.value,
        currentMonthSaoPaulo(),
      );
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = node('a');
      link.href = url;
      link.download = `resumo-kpi-${stateFilter.value}-${monthSelect.value || 'sem-competencia'}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      document.getElementById('export-status').textContent =
        'CSV agregado exportado. O arquivo contém apenas contagens derivadas, sem registros pessoais.';
    } catch (error) {
      document.getElementById('export-status').textContent = `Não foi possível exportar o CSV: ${error.message}`;
    }
  });
  refresh();
  setInterval(() => {
    if (!document.hidden && !dashboard.hidden) refresh();
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !dashboard.hidden) refresh();
  });
}());
