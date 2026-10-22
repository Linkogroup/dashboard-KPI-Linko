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

  function calculateSimulation(inputs) {
    const values = inputs && typeof inputs === 'object' && !Array.isArray(inputs)
      ? inputs
      : null;
    if (
      !values
      || !Number.isSafeInteger(values.units)
      || values.units < 0
      || !['revenuePerUnit', 'partnerPerUnit', 'contributionPerUnit', 'fixedCostPerUfMonth']
        .every((key) => Number.isFinite(values[key]) && values[key] >= 0)
    ) return null;

    const potentialRevenue = roundCurrency(values.units * values.revenuePerUnit);
    const partnerAmount = roundCurrency(values.units * values.partnerPerUnit);
    const grossLessPartner = roundCurrency(potentialRevenue - partnerAmount);
    const contribution = roundCurrency(values.units * values.contributionPerUnit);
    const fixedCost = roundCurrency(values.fixedCostPerUfMonth);
    const netAfterFixedCost = contribution === null || fixedCost === null
      ? null
      : roundCurrency(contribution - fixedCost);
    const breakEvenUnits = values.contributionPerUnit > 0
      ? Math.ceil(values.fixedCostPerUfMonth / values.contributionPerUnit)
      : null;
    const contributionDifference = grossLessPartner === null || contribution === null
      ? null
      : roundCurrency(grossLessPartner - contribution);
    if (
      potentialRevenue === null
      || partnerAmount === null
      || grossLessPartner === null
      || contribution === null
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

  return { parseAmount, parseSimulationInputs, calculateSimulation, monthlySeries };
}));
