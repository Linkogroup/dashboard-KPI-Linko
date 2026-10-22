const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  calculateSimulation,
  monthlySeries,
  parseAmount,
  parseSimulationInputs,
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
      { state: 'PR', goal: null, actual: 0 },
      { state: 'SC', goal: 5, actual: null },
    ],
    regional: { goal: null, actual: null },
  }];
  assert.deepEqual(monthlySeries(periods, 'PR'), [
    { month: '2026-10', goal: null, actual: 0 },
  ]);
  assert.deepEqual(monthlySeries(periods, 'SUL'), [
    { month: '2026-10', goal: null, actual: null },
  ]);
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
  assert.match(dashboard, /\}, 60000\)/);
  assert.match(dashboard, /addEventListener\('visibilitychange'/);
  assert.match(dashboard, /dados exibidos estão DESATUALIZADOS/);
  assert.match(dashboard, /Entre com sua conta do Worker para consultar os indicadores/);
  assert.match(dashboard, /scope = 'row'/);
  assert.match(dashboard, /\/api\/kpi/);
  assert.doesNotMatch(dashboard, /workers\.dev|innerHTML/);
  assert.match(proxy, /Série diária validada de produção observada/);
  assert.match(proxy, /Medição, aprovação ou confirmação de execução física/);
  assert.match(proxy, /Financeiro realizado e receita efetiva/);
  assert.match(proxy, /Contas a receber, recebimentos e pagamentos/);
  assert.match(proxy, /Relatório diário operacional e administração de cadastros/);
});
