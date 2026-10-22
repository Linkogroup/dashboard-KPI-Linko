(function exposeSimulator(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KpiSimulator = api;
}(typeof globalThis === 'object' ? globalThis : this, () => {
  function parseAmount(value) {
    if (typeof value !== 'string') return null;
    const input = value.trim();
    if (!input || !/^[\d.,]+$/.test(input)) return null;

    let normalized = input;
    const comma = input.lastIndexOf(',');
    const dot = input.lastIndexOf('.');
    if (comma !== -1 && dot !== -1) {
      const decimalSeparator = comma > dot ? ',' : '.';
      const groupSeparator = decimalSeparator === ',' ? '.' : ',';
      const parts = input.split(decimalSeparator);
      const groupPattern = groupSeparator === '.' ? '\\.' : ',';
      const groupedInteger = new RegExp(`^\\d{1,3}(?:${groupPattern}\\d{3})+$`);
      if (
        parts.length !== 2
        || !groupedInteger.test(parts[0])
        || !/^\d{1,2}$/.test(parts[1])
      ) return null;
      normalized = `${parts[0].split(groupSeparator).join('')}.${parts[1]}`;
    } else {
      const separator = comma === -1 ? '.' : ',';
      const parts = input.split(separator);
      if (parts.length > 1) {
        if (parts.length > 2 || parts.some((part) => !/^\d+$/.test(part))) return null;
        const [integer, fraction] = parts;
        if (fraction.length === 3 && integer.length <= 3) {
          normalized = `${integer}${fraction}`;
        } else if (fraction.length <= 2) {
          normalized = `${integer}.${fraction}`;
        } else {
          return null;
        }
      }
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount <= Number.MAX_SAFE_INTEGER ? amount : null;
  }

  function parseSimulationInputs(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
    const units = parseAmount(values.units);
    const revenuePerUnit = parseAmount(values.revenuePerUnit);
    const partnerPerUnit = parseAmount(values.partnerPerUnit);
    const contributionPerUnit = parseAmount(values.contributionPerUnit);
    const fixedCostPerUfMonth = parseAmount(values.fixedCostPerUfMonth);
    if (
      units === null
      || !Number.isSafeInteger(units)
      || revenuePerUnit === null
      || partnerPerUnit === null
      || contributionPerUnit === null
      || fixedCostPerUfMonth === null
    ) return null;

    return { units, revenuePerUnit, partnerPerUnit, contributionPerUnit, fixedCostPerUfMonth };
  }

  function roundCurrency(value) {
    const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
    return Number.isFinite(rounded) && Math.abs(rounded) <= Number.MAX_SAFE_INTEGER / 100
      ? rounded
      : null;
  }

  function calculateSimulation(inputs, ufCount = 1) {
    const values = inputs && typeof inputs === 'object' && !Array.isArray(inputs)
      ? inputs
      : null;
    if (
      !values
      || ![1, 3].includes(ufCount)
      || !Number.isSafeInteger(values.units)
      || values.units < 0
      || !['revenuePerUnit', 'partnerPerUnit', 'contributionPerUnit', 'fixedCostPerUfMonth']
        .every((key) => Number.isFinite(values[key]) && values[key] >= 0)
    ) return null;

    const potentialRevenue = roundCurrency(values.units * values.revenuePerUnit);
    const partnerAmount = roundCurrency(values.units * values.partnerPerUnit);
    const grossLessPartner = roundCurrency(potentialRevenue - partnerAmount);
    const contribution = roundCurrency(values.units * values.contributionPerUnit);
    const fixedCostPerUfMonth = roundCurrency(values.fixedCostPerUfMonth);
    const fixedCost = fixedCostPerUfMonth === null
      ? null
      : roundCurrency(fixedCostPerUfMonth * ufCount);
    const netAfterFixedCost = contribution === null || fixedCost === null
      ? null
      : roundCurrency(contribution - fixedCost);
    const breakEvenUnits = values.contributionPerUnit > 0 && fixedCost !== null
      ? Math.ceil(fixedCost / values.contributionPerUnit)
      : null;
    const contributionDifference = grossLessPartner === null || contribution === null
      ? null
      : roundCurrency(grossLessPartner - contribution);
    if (
      potentialRevenue === null
      || partnerAmount === null
      || grossLessPartner === null
      || contribution === null
      || fixedCostPerUfMonth === null
      || fixedCost === null
      || netAfterFixedCost === null
      || contributionDifference === null
      || (breakEvenUnits !== null && !Number.isSafeInteger(breakEvenUnits))
    ) return null;

    return {
      potentialRevenue,
      partnerAmount,
      grossLessPartner,
      contribution,
      contributionDifference,
      fixedCostPerUfMonth,
      fixedCostUfCount: ufCount,
      fixedCost,
      netAfterFixedCost,
      breakEvenUnits,
    };
  }

  function monthlySeries(periods, state) {
    if (!Array.isArray(periods)) return [];
    return periods.map((period) => {
      const row = state === 'SUL'
        ? period?.regional
        : period?.states?.find((entry) => entry.state === state);
      return {
        month: period?.month,
        goal: Number.isSafeInteger(row?.goal) && row.goal >= 0 ? row.goal : null,
        actual: Number.isSafeInteger(row?.actual) && row.actual >= 0 ? row.actual : null,
      };
    });
  }

  function previousMonth(month) {
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
    const [year, monthNumber] = month.split('-').map(Number);
    return monthNumber === 1
      ? `${String(year - 1).padStart(4, '0')}-12`
      : `${year}-${String(monthNumber - 1).padStart(2, '0')}`;
  }

  function historicalGrowth(periods, state, throughMonth) {
    if (typeof throughMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(throughMonth)) return [];
    const history = monthlySeries(periods, state)
      .filter((period) => (
        typeof period.month === 'string'
        && /^\d{4}-(0[1-9]|1[0-2])$/.test(period.month)
        && period.month <= throughMonth
        && period.actual !== null
      ))
      .sort((left, right) => left.month.localeCompare(right.month));
    const actuals = new Map(history.map((period) => [period.month, period.actual]));
    return history.map((period) => {
      const prior = actuals.get(previousMonth(period.month));
      const change = prior === undefined ? null : period.actual - prior;
      return {
        month: period.month,
        actual: period.actual,
        previousActual: prior === undefined ? null : prior,
        change,
        percent: prior === undefined || prior === 0 ? null : (change / prior) * 100,
      };
    });
  }

  function csvCell(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '"Não disponível"';
    const text = String(value);
    const safe = /^[=+@\-]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  }

  function buildAggregateCsv(snapshot, scope, selectedMonth, currentMonth) {
    if (!snapshot || !Array.isArray(snapshot.states) || !Array.isArray(snapshot.monthly)) {
      throw new TypeError('Resumo agregado inválido para exportação.');
    }
    const rows = [['UF', 'Período', 'Categoria', 'Métrica', 'Valor', 'Unidade']];
    for (const state of rowsForScope(snapshot.states, snapshot.regional, scope)) {
      const stateCode = state.state;
      rows.push([stateCode, '', 'Atual', 'Endereços', state.addresses, 'endereços']);
      for (const status of [
        'Não tratado',
        'Autorizado',
        'Em Execução',
        'Concluído',
        'Não autorizado',
        'Prédio já adequado',
        'Outros status',
      ]) rows.push([stateCode, '', 'Atual', `Status: ${status}`, state.statuses?.[status] ?? 'Não disponível', 'endereços']);
      rows.push([stateCode, '', 'Atual', 'Blocos liberados', state.releasedBlocks, 'blocos']);
      rows.push([
        stateCode,
        '',
        'Atual',
        'Endereços autorizados sem quantidade de blocos',
        state.releasedBlocksMissing,
        'endereços',
      ]);
    }

    const period = snapshot.monthly.find((entry) => entry.month === selectedMonth);
    if (period) {
      for (const state of rowsForScope(period.states, period.regional, scope)) {
        const isFutureTarget = period.month > currentMonth;
        const goalLabel = isFutureTarget
          ? 'Meta cadastrada (não é previsão)'
          : 'Meta mensal cadastrada';
        rows.push([state.state, period.month, 'Mensal', goalLabel, state.goal ?? 'Não disponível', 'unidade da meta']);
        rows.push([
          state.state,
          period.month,
          'Mensal',
          'Produção derivada',
          state.actual ?? 'Não disponível',
          'quantidade derivada da fonte',
        ]);
      }
    }

    for (const item of historicalGrowth(snapshot.monthly, scope, currentMonth)) {
      rows.push([scope, item.month, 'Histórico', 'Produção derivada mensal', item.actual, 'quantidade derivada']);
      rows.push([
        scope,
        item.month,
        'Histórico',
        'Variação versus mês imediatamente anterior disponível',
        item.change ?? 'Não comparável',
        'quantidade derivada',
      ]);
      rows.push([
        scope,
        item.month,
        'Histórico',
        'Variação percentual versus mês imediatamente anterior disponível',
        item.percent === null ? 'Não comparável' : item.percent,
        '%',
      ]);
    }

    return `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
  }

  function rowsForScope(states, regional, scope) {
    if (!Array.isArray(states)) return [];
    if (scope === 'SUL') return regional ? [...states, regional] : [...states];
    return states.filter((state) => state?.state === scope);
  }

  function preferredMonth(months, currentMonth) {
    if (
      !Array.isArray(months)
      || typeof currentMonth !== 'string'
      || !/^\d{4}-(0[1-9]|1[0-2])$/.test(currentMonth)
    ) return null;
    const available = months.filter((month) => (
      typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    ));
    if (available.includes(currentMonth)) return currentMonth;
    return available.filter((month) => month < currentMonth).sort().at(-1) || null;
  }

  return {
    parseAmount,
    parseSimulationInputs,
    calculateSimulation,
    monthlySeries,
    historicalGrowth,
    buildAggregateCsv,
    rowsForScope,
    preferredMonth,
  };
}));
