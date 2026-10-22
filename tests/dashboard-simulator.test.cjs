const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  calculateSimulation,
  buildAggregateCsv,
  historicalGrowth,
  monthlyPerformance,
  monthlySeries,
  parseAmount,
  parseSimulationInputs,
  preferredMonth,
  rowsForScope,
} = require('../lib/kpi-simulator.js');

test('monetary input accepts decimal comma, decimal point, and grouped Brazilian values', () => {
  assert.equal(parseAmount('1800,50'), 1800.5);
  assert.equal(parseAmount('1.800,50'), 1800.5);
  assert.equal(parseAmount('1,800.50'), 1800.5);
  assert.equal(parseAmount('1.800'), 1800);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('1,2,3'), null);
  assert.equal(parseAmount('-10'), null);
  assert.equal(parseAmount('1e3'), null);
  assert.equal(parseAmount('R$ 10'), null);
});

test('simulation math keeps editable assumptions explicit and calculates net and break-even transparently', () => {
  const inputs = parseSimulationInputs({
    units: '30',
    revenuePerUnit: '1.800,00',
    partnerPerUnit: '900,00',
    contributionPerUnit: '900,00',
    fixedCostPerUfMonth: '20.000,00',
  });
  assert.deepEqual(inputs, {
    units: 30,
    revenuePerUnit: 1800,
    partnerPerUnit: 900,
    contributionPerUnit: 900,
    fixedCostPerUfMonth: 20000,
  });
  assert.deepEqual(calculateSimulation(inputs), {
    potentialRevenue: 54000,
    partnerAmount: 27000,
    grossLessPartner: 27000,
    contribution: 27000,
    contributionDifference: 0,
    fixedCostPerUfMonth: 20000,
    fixedCostUfCount: 1,
    fixedCost: 20000,
    netAfterFixedCost: 7000,
    breakEvenUnits: 23,
  });

  const changedAssumption = calculateSimulation({
    ...inputs,
    contributionPerUnit: 800,
  });
  assert.equal(changedAssumption.contribution, 24000);
  assert.equal(changedAssumption.contributionDifference, 3000);
  assert.equal(changedAssumption.netAfterFixedCost, 4000);
});

test('Regional Sul simulation applies three per-UF fixed costs without sourcing real units', () => {
  const inputs = {
    units: 30,
    revenuePerUnit: 1800,
    partnerPerUnit: 900,
    contributionPerUnit: 900,
    fixedCostPerUfMonth: 20000,
  };
  const simulation = calculateSimulation(inputs, 3);
  assert.equal(simulation.fixedCostPerUfMonth, 20000);
  assert.equal(simulation.fixedCostUfCount, 3);
  assert.equal(simulation.fixedCost, 60000);
  assert.equal(simulation.netAfterFixedCost, -33000);
  assert.equal(simulation.breakEvenUnits, 67);
  assert.equal(calculateSimulation(inputs, 2), null);
});

test('empty, fractional-unit, invalid, and overflowing scenarios do not return plausible results', () => {
  assert.equal(parseSimulationInputs({
    units: '',
    revenuePerUnit: '1800',
    partnerPerUnit: '900',
    contributionPerUnit: '900',
    fixedCostPerUfMonth: '20000',
  }), null);
  assert.equal(parseSimulationInputs({
    units: '1,5',
    revenuePerUnit: '1800',
    partnerPerUnit: '900',
    contributionPerUnit: '900',
    fixedCostPerUfMonth: '20000',
  }), null);
  assert.equal(calculateSimulation({
    units: Number.MAX_SAFE_INTEGER,
    revenuePerUnit: Number.MAX_SAFE_INTEGER,
    partnerPerUnit: 0,
    contributionPerUnit: 1,
    fixedCostPerUfMonth: 0,
  }), null);
  assert.equal(calculateSimulation({
    units: 1,
    revenuePerUnit: 100,
    partnerPerUnit: 20,
    contributionPerUnit: 0,
    fixedCostPerUfMonth: 20000,
  }).breakEvenUnits, null);
});

test('monthly series preserves missing targets and uncalculable production instead of converting them to zero', () => {
  const periods = [{
    month: '2026-10',
    states: [
      { state: 'PR', goal: null, actual: 0, entries: 1, missingBlocks: 0 },
      { state: 'SC', goal: 5, actual: 4, entries: 1, missingBlocks: 1 },
    ],
    regional: { goal: null, actual: null, entries: 2, missingBlocks: 1 },
  }];
  assert.deepEqual(monthlySeries(periods, 'PR'), [
    { month: '2026-10', goal: null, actual: 0 },
  ]);
  assert.deepEqual(monthlySeries(periods, 'SUL'), [
    { month: '2026-10', goal: null, actual: null },
  ]);
  assert.deepEqual(monthlySeries(periods, 'SC'), [
    { month: '2026-10', goal: 5, actual: null },
  ], 'known subtotal is unavailable when any entry lacks block quantity');
});

test('monthly attainment requires complete actuals and a positive target; scopes UF/Sul and excludes future months', () => {
  const periods = [
    {
      month: '2026-10',
      states: [
        { state: 'PR', goal: 10, actual: 8, entries: 1, missingBlocks: 0 },
        { state: 'SC', goal: 5, actual: 3, entries: 1, missingBlocks: 0 },
        { state: 'RS', goal: 5, actual: 7, entries: 1, missingBlocks: 0 },
      ],
      regional: { state: 'SUL', goal: 20, actual: 18, entries: 3, missingBlocks: 0 },
    },
    {
      month: '2026-11',
      states: [
        { state: 'PR', goal: 0, actual: 0, entries: 1, missingBlocks: 0 },
        { state: 'SC', goal: 0, actual: 1, entries: 1, missingBlocks: 0 },
        { state: 'RS', goal: 0, actual: 0, entries: 1, missingBlocks: 0 },
      ],
      regional: { state: 'SUL', goal: 0, actual: 1, entries: 3, missingBlocks: 0 },
    },
    {
      month: '2026-12',
      states: [{ state: 'PR', goal: 10, actual: 12, entries: 1, missingBlocks: 0 }],
      regional: { state: 'SUL', goal: 10, actual: 12, entries: 1, missingBlocks: 0 },
    },
  ];

  assert.deepEqual(monthlyPerformance(periods, 'PR', '2026-11'), [
    { month: '2026-10', goal: 10, actual: 8, delta: -2, attainmentPercent: 80 },
    { month: '2026-11', goal: 0, actual: 0, delta: 0, attainmentPercent: null },
  ]);
  assert.deepEqual(monthlyPerformance(periods, 'SC', '2026-11'), [
    { month: '2026-10', goal: 5, actual: 3, delta: -2, attainmentPercent: 60 },
    { month: '2026-11', goal: 0, actual: 1, delta: 1, attainmentPercent: null },
  ]);
  assert.deepEqual(monthlyPerformance(periods, 'SUL', '2026-11'), [
    { month: '2026-10', goal: 20, actual: 18, delta: -2, attainmentPercent: 90 },
    { month: '2026-11', goal: 0, actual: 1, delta: 1, attainmentPercent: null },
  ]);
  assert.deepEqual(monthlyPerformance(periods, 'PR', '2026-12').at(-1), {
    month: '2026-12', goal: 10, actual: 12, delta: 2, attainmentPercent: 120,
  });
  assert.deepEqual(monthlyPerformance(periods, 'PR', '2026-09'), []);
});

test('historical growth uses only complete nonnegative actuals and adjacent calendar months', () => {
  const periods = [
    { month: '2026-08', states: [{ state: 'PR', goal: 0, actual: 10, entries: 1, missingBlocks: 0 }] },
    { month: '2026-09', states: [{ state: 'PR', goal: 0, actual: 5, entries: 1, missingBlocks: 0 }] },
    { month: '2026-10', states: [{ state: 'PR', goal: 0, actual: null, entries: 1, missingBlocks: 1 }] },
    { month: '2026-11', states: [{ state: 'PR', goal: 0, actual: 0, entries: 1, missingBlocks: 0 }] },
    { month: '2026-12', states: [{ state: 'PR', goal: -4, actual: 9, entries: 1, missingBlocks: 0 }] },
    { month: '2027-01', states: [{ state: 'PR', goal: 0, actual: -2, entries: 1, missingBlocks: 0 }] },
  ];
  assert.deepEqual(historicalGrowth(periods, 'PR', '2026-12'), [
    { month: '2026-08', actual: 10, previousActual: null, change: null, percent: null },
    { month: '2026-09', actual: 5, previousActual: 10, change: -5, percent: -50 },
    { month: '2026-11', actual: 0, previousActual: null, change: null, percent: null },
    { month: '2026-12', actual: 9, previousActual: 0, change: 9, percent: null },
  ]);
  assert.equal(monthlySeries(periods, 'PR')[4].goal, null, 'negative target is unavailable, not zero');
});

test('historical growth does not fill missing months with zero or compare across a gap', () => {
  const periods = [
    { month: '2026-01', states: [{ state: 'PR', actual: 8, entries: 1, missingBlocks: 0 }] },
    { month: '2026-03', states: [{ state: 'PR', actual: 4, entries: 1, missingBlocks: 0 }] },
    { month: '2026-05', states: [{ state: 'PR', actual: 6, entries: 1, missingBlocks: 0 }] },
  ];
  assert.deepEqual(historicalGrowth(periods, 'PR', '2026-05'), [
    { month: '2026-01', actual: 8, previousActual: null, change: null, percent: null },
    { month: '2026-03', actual: 4, previousActual: null, change: null, percent: null },
    { month: '2026-05', actual: 6, previousActual: null, change: null, percent: null },
  ]);
});

test('aggregate CSV exports only filtered aggregates and clearly labels future targets', () => {
  const sensitive = 'private-street-and-contact';
  const snapshot = {
    states: [{
      state: 'PR',
      addresses: 2,
      statuses: { 'Não tratado': 1, Autorizado: 1 },
      releasedBlocks: 4,
      releasedBlocksMissing: 0,
      rawAddress: sensitive,
    }],
    regional: {
      state: 'SUL',
      addresses: 2,
      statuses: { 'Não tratado': 1, Autorizado: 1 },
      releasedBlocks: 4,
      releasedBlocksMissing: 0,
    },
    monthly: [
      {
        month: '2026-11',
        states: [{ state: 'PR', goal: 0, actual: 0, entries: 1, missingBlocks: 0 }],
        regional: { state: 'SUL', goal: 0, actual: 0, entries: 1, missingBlocks: 0 },
      },
      {
        month: '2026-12',
        states: [{ state: 'PR', goal: 12, actual: null, entries: 1, missingBlocks: 1 }],
        regional: { state: 'SUL', goal: 12, actual: null, entries: 1, missingBlocks: 1 },
      },
    ],
  };
  const csv = buildAggregateCsv(snapshot, 'PR', '2026-12', '2026-11');
  assert.match(csv, /Meta cadastrada \(não é previsão\)/);
  assert.match(csv, /"Produção derivada";"Não disponível"/);
  assert.match(csv, /"2026-11";"Histórico"/);
  assert.doesNotMatch(csv, /private-street-and-contact/);
  assert.doesNotMatch(csv, /"2026-12";"Histórico"/);
  assert.match(
    buildAggregateCsv(snapshot, 'PR', '2026-11', '2026-11'),
    /"Meta mensal cadastrada";0;/,
    'zero target stays a recorded zero',
  );
  assert.doesNotMatch(
    buildAggregateCsv(snapshot, 'PR', '2026-10', '2026-11'),
    /"2026-11";"Histórico"/,
    'historical export follows the selected month',
  );
});

test('state filter scopes tables and summary rows to one UF or Regional Sul', () => {
  const states = ['PR', 'SC', 'RS'].map((state) => ({ state }));
  const regional = { state: 'SUL' };
  assert.deepEqual(rowsForScope(states, regional, 'SUL'), [...states, regional]);
  assert.deepEqual(rowsForScope(states, regional, 'SC'), [{ state: 'SC' }]);
  assert.deepEqual(rowsForScope(states, regional, 'XX'), []);
});

test('default monthly competence prefers the current month and never defaults to a future period', () => {
  const months = ['2026-08', '2026-10', '2027-09'];
  assert.equal(preferredMonth(months, '2026-10'), '2026-10');
  assert.equal(preferredMonth(['2026-08', '2027-09'], '2026-10'), '2026-08');
  assert.equal(preferredMonth(['2027-09'], '2026-10'), null);
  assert.equal(preferredMonth([], '2026-10'), null);
});

test('dashboard markup and client logic preserve accessible labels, mobile layout, local proxy, and unavailable modules', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'lib', 'dashboard.js'), 'utf8');
  const proxy = fs.readFileSync(path.join(root, 'lib', 'worker-proxy.cjs'), 'utf8');

  assert.match(html, /<html lang="pt-BR">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /@media \(max-width: 700px\)/);
  assert.match(html, /id="sim-units"/);
  assert.match(html, /id="snapshot-status"/);
  assert.match(html, /id="growth-chart"/);
  assert.match(html, /id="growth-table"/);
  assert.match(html, /id="attainment-chart"/);
  assert.match(html, /id="attainment-table"/);
  assert.match(html, /Atingimento histórico da meta cadastrada/);
  assert.match(html, /id="export-csv"/);
  assert.match(html, /Projeção operacional: indisponível/);
  assert.match(html, /aria-live="polite"/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'HTML id attributes must be unique');
  const controls = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g)]
    .map((match) => match[1]);
  for (const id of controls) {
    assert.match(html, new RegExp(`<label\\b[^>]*\\bfor="${id}"`), `control ${id} must have a label`);
  }
  for (const [, references] of html.matchAll(/\baria-labelledby="([^"]+)"/g)) {
    for (const id of references.split(/\s+/)) assert.ok(ids.includes(id), `missing accessible label target ${id}`);
  }
  assert.match(dashboard, /node\('caption', captionText\)/);
  assert.match(dashboard, /setAttribute\('role', 'img'\)/);
  assert.match(dashboard, /\['Em Execução', 'Em execução'\]/);
  assert.match(dashboard, /!data\.monthly\.every\(validMonthlyPeriod\)/);
  assert.match(dashboard, /period\.regional\.state === 'SUL'/);
  assert.match(dashboard, /state\.missingBlocks === 0/);
  assert.match(dashboard, /\}, 60000\)/);
  assert.match(dashboard, /addEventListener\('visibilitychange'/);
  assert.match(dashboard, /dados exibidos estão DESATUALIZADOS/);
  assert.match(dashboard, /Entre com sua conta do Worker para consultar os indicadores/);
  assert.match(dashboard, /timeZone: 'America\/Sao_Paulo'/);
  assert.match(dashboard, /historicalGrowth\(snapshot\.monthly/);
  assert.match(dashboard, /monthlyPerformance\(snapshot\.monthly, stateFilter\.value/);
  assert.match(dashboard, /renderAttainment\(\)/);
  assert.match(dashboard, /Desvio \(produção − meta\)/);
  assert.match(dashboard, /buildAggregateCsv\(/);
  assert.match(dashboard, /\.month <= currentMonth/);
  assert.match(dashboard, /Não disponível \(sem competência atual ou anterior\)/);
  assert.match(dashboard, /scope = 'row'/);
  assert.match(dashboard, /\/api\/kpi/);
  assert.doesNotMatch(dashboard, /workers\.dev|innerHTML/);
  assert.match(proxy, /Série diária validada de produção observada/);
  assert.match(proxy, /Medição, aprovação ou confirmação de execução física/);
  assert.match(proxy, /Financeiro realizado e receita efetiva/);
  assert.match(proxy, /Contas a receber, recebimentos e pagamentos/);
  assert.match(proxy, /Relatório diário operacional e administração de cadastros/);
});
