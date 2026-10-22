const WORKER_ORIGIN = 'https://f4a-paineis.michael-r-alves82.workers.dev';
const SESSION_COOKIE = '__Host-f4a_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_REQUEST_BYTES = 8192;
const MAX_UPSTREAM_BYTES = 10 * 1024 * 1024;
const STATES = ['PR', 'SC', 'RS'];
const STATUS_GROUPS = [
  ['Não tratado', 'Não tratado'],
  ['Autorizado', 'Autorizado'],
  ['Em Execução', 'Em Execução'],
  ['Concluído', 'Concluído'],
  ['Não Autorizado', 'Não autorizado'],
  ['Prédio já adequado', 'Prédio já adequado'],
  ['Outros', 'Outros status'],
];

class ProxyError extends Error {
  constructor(status, message, clearCookie = false) {
    super(message);
    this.status = status;
    this.clearCookie = clearCookie;
  }
}

function header(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function allowedHosts() {
  return [
    'kpi.f4aconsultoria.com.br',
    process.env.VERCEL_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].filter(Boolean).map((value) => value.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase());
}

function requestOrigin(req, requireOrigin = true) {
  const rawHost = header(req, 'host');
  if (typeof rawHost !== 'string' || rawHost.includes(',') || /[\r\n/@]/.test(rawHost)) {
    throw new ProxyError(400, 'Solicitação inválida.');
  }

  let hostUrl;
  try {
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(rawHost);
    hostUrl = new URL(`${local ? 'http' : 'https'}://${rawHost}`);
  } catch {
    throw new ProxyError(400, 'Solicitação inválida.');
  }

  const host = hostUrl.host.toLowerCase();
  const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  if (!allowedHosts().includes(host) && !(process.env.NODE_ENV !== 'production' && localHost)) {
    throw new ProxyError(403, 'Origem não autorizada.');
  }

  const origin = header(req, 'origin');
  if (origin === undefined && !requireOrigin) return hostUrl.origin;
  if (typeof origin !== 'string') throw new ProxyError(403, 'Origem não autorizada.');

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new ProxyError(403, 'Origem não autorizada.');
  }

  if (origin !== parsedOrigin.origin || parsedOrigin.origin !== hostUrl.origin) {
    throw new ProxyError(403, 'Origem não autorizada.');
  }

  const fetchSite = header(req, 'sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') {
    throw new ProxyError(403, 'Origem não autorizada.');
  }

  return parsedOrigin.origin;
}

function setResponseHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Vary', 'Cookie, Origin');
}

function setSessionCookie(res, token, maxAge = SESSION_TTL_SECONDS) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`,
  );
}

function sendJson(res, status, body, { clearCookie = false, sessionToken = null } = {}) {
  setResponseHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (clearCookie) setSessionCookie(res, '', 0);
  if (sessionToken) setSessionCookie(res, sessionToken);
  res.end(JSON.stringify(body));
}

function fail(res, error) {
  const status = error instanceof ProxyError ? error.status : 502;
  const message = error instanceof ProxyError ? error.message : 'Não foi possível consultar a fonte autenticada.';
  sendJson(res, status, { error: message }, { clearCookie: Boolean(error.clearCookie) });
}

function readSessionToken(req) {
  const cookieHeader = header(req, 'cookie');
  if (typeof cookieHeader !== 'string') return null;
  const values = cookieHeader.split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(SESSION_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function extractWorkerToken(response) {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  if (cookies.length !== 1) return null;

  const parts = cookies[0].split(';').map((part) => part.trim());
  const match = /^__Host-f4a_session=([a-f0-9]{64})$/.exec(parts[0]);
  if (!match) return null;
  const attributes = new Set(parts.slice(1).map((part) => part.toLowerCase()));
  if (
    !attributes.has('path=/')
    || !attributes.has('httponly')
    || !attributes.has('secure')
    || !attributes.has('samesite=strict')
    || !attributes.has(`max-age=${SESSION_TTL_SECONDS}`)
    || parts.slice(1).some((part) => /^domain=/i.test(part))
  ) {
    return null;
  }
  return match[1];
}

async function readJson(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ProxyError(502, 'A fonte autenticada retornou uma resposta inválida.');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new ProxyError(502, 'A fonte autenticada retornou uma resposta vazia.');
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UPSTREAM_BYTES) {
      await reader.cancel();
      throw new ProxyError(502, 'A resposta da fonte excede o limite de leitura.');
    }
    chunks.push(value);
  }

  try {
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ProxyError(502, 'A fonte autenticada retornou JSON inválido.');
  }
}

function requestBody(req) {
  const contentType = header(req, 'content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ProxyError(415, 'Envie os dados de acesso como JSON.');
  }
  const contentLength = Number(header(req, 'content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new ProxyError(413, 'Solicitação muito grande.');
  }

  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw new ProxyError(413, 'Solicitação muito grande.');
    try {
      body = JSON.parse(body);
    } catch {
      throw new ProxyError(400, 'JSON inválido.');
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ProxyError(400, 'Solicitação inválida.');
  }
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_REQUEST_BYTES) {
    throw new ProxyError(413, 'Solicitação muito grande.');
  }
  return body;
}

function workerPaths() {
  return {
    login: '/api/auth/login',
    logout: '/api/auth/logout',
    me: '/api/auth/me',
    addresses: '/api/enderecos',
    production: '/api/prumadas',
  };
}

function safeHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      fail(res, error);
    }
  };
}

function createProxy({ fetchImpl = globalThis.fetch, workerOrigin = WORKER_ORIGIN } = {}) {
  async function callWorker(pathKey, { method = 'GET', token, body } = {}) {
    const path = workerPaths()[pathKey];
    if (!path) throw new ProxyError(500, 'Rota interna inválida.');
    const headers = { Origin: workerOrigin };
    if (token) headers.Cookie = `${SESSION_COOKIE}=${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    return fetchImpl(`${workerOrigin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  }

  async function checkMaster(token) {
    const response = await callWorker('me', { token });
    if (!response.ok) {
      if (response.status === 401) throw new ProxyError(401, 'Sessão encerrada. Entre novamente.', true);
      if (response.status === 403) throw new ProxyError(403, 'Perfil sem acesso ao painel.', true);
      throw new ProxyError(502, 'Não foi possível validar o perfil no Worker.', true);
    }
    const user = await readJson(response);
    if (user?.accessProfile !== 'master' || user?.mustChange !== false) {
      throw new ProxyError(403, 'Acesso permitido somente ao Gestor Master com senha atualizada.', true);
    }
  }

  async function revoke(token) {
    const response = await callWorker('logout', { method: 'POST', token, body: {} });
    if (!response.ok && response.status !== 401) {
      throw new ProxyError(502, 'Não foi possível confirmar o encerramento da sessão no Worker.');
    }
    return response;
  }

  async function login(req, res) {
    if (req.method !== 'POST') throw new ProxyError(405, 'Método não permitido.');
    requestOrigin(req, true);
    const body = requestBody(req);
    if (
      typeof body.email !== 'string'
      || body.email.length > 254
      || typeof body.password !== 'string'
      || body.password.length < 1
      || body.password.length > 128
    ) {
      throw new ProxyError(400, 'Informe um e-mail e uma senha válidos.');
    }

    const response = await callWorker('login', {
      method: 'POST',
      body: { email: body.email, password: body.password },
    });
    if (response.status === 429) throw new ProxyError(429, 'Muitas tentativas. Aguarde antes de tentar novamente.');
    if (response.status === 401) throw new ProxyError(401, 'E-mail ou senha inválidos.');
    if (!response.ok) throw new ProxyError(502, 'Não foi possível autenticar no Worker.');

    const token = extractWorkerToken(response);
    if (!token) throw new ProxyError(502, 'A resposta de sessão do Worker não passou na validação.');

    try {
      await checkMaster(token);
    } catch (error) {
      try {
        await revoke(token);
      } catch {
        throw new ProxyError(
          502,
          'O perfil foi recusado e a sessão temporária não pôde ser encerrada; ela expirará automaticamente.',
          true,
        );
      }
      throw error;
    }

    sendJson(res, 200, { authenticated: true }, { sessionToken: token });
  }

  async function logout(req, res) {
    if (req.method !== 'POST') throw new ProxyError(405, 'Método não permitido.');
    requestOrigin(req, true);
    const body = requestBody(req);
    if (Object.keys(body).length !== 0) throw new ProxyError(400, 'Solicitação inválida.');
    const token = readSessionToken(req);
    if (token) {
      try {
        await revoke(token);
      } catch {
        sendJson(res, 502, { error: 'Não foi possível encerrar a sessão no Worker.' }, { clearCookie: true });
        return;
      }
    }
    sendJson(res, 200, { authenticated: false }, { clearCookie: true });
  }

  async function kpi(req, res) {
    if (req.method !== 'GET') throw new ProxyError(405, 'Método não permitido.');
    requestOrigin(req, false);
    const token = readSessionToken(req);
    if (!token) throw new ProxyError(401, 'Entre para consultar os indicadores.', true);
    await checkMaster(token);

    const [addressesResponse, productionResponse] = await Promise.all([
      callWorker('addresses', { token }),
      callWorker('production', { token }),
    ]);
    for (const response of [addressesResponse, productionResponse]) {
      if (response.status === 401) throw new ProxyError(401, 'Sessão encerrada. Entre novamente.', true);
      if (response.status === 403) throw new ProxyError(403, 'Perfil sem acesso aos dados.', true);
      if (response.status === 404) throw new ProxyError(503, 'A fonte de dados não está disponível nesta versão.');
      if (!response.ok) throw new ProxyError(502, 'Não foi possível consultar a fonte de dados.');
    }

    const [addresses, production] = await Promise.all([
      readJson(addressesResponse),
      readJson(productionResponse),
    ]);
    if (
      !Array.isArray(addresses?.items)
      || !isCount(addresses.revision)
      || !Array.isArray(production?.daily)
      || !isRecord(production.targets)
      || !isCount(production.revision)
      || production.addressRevision !== addresses.revision
    ) {
      throw new ProxyError(502, 'A estrutura ou revisão da fonte não passou na validação.');
    }

    sendJson(res, 200, buildKpiSnapshot(addresses, production));
  }

  return {
    login: safeHandler(login),
    logout: safeHandler(logout),
    kpi: safeHandler(kpi),
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function brazilDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function buildKpiSnapshot(addresses, production, now = new Date()) {
  const items = addresses.items.filter((item) => (
    isRecord(item) && !item.mergedInto && STATES.includes(item.state)
  ));
  const byState = STATES.map((state) => {
    const own = items.filter((item) => item.state === state);
    const statuses = Object.fromEntries(STATUS_GROUPS.map(([, label]) => [label, 0]));
    for (const item of own) {
      const group = STATUS_GROUPS.find(([status]) => status === item.status)?.[1] || 'Outros status';
      statuses[group] += 1;
    }
    const authorized = own.filter((item) => item.status === 'Autorizado');
    const knownBlocks = authorized.filter((item) => isCount(item.blockCount) && item.blockCount > 0);
    return {
      state,
      addresses: own.length,
      statuses,
      authorized: authorized.length,
      execution: own.filter((item) => item.status === 'Em Execução').length,
      completed: own.filter((item) => item.status === 'Concluído').length,
      releasedBlocks: knownBlocks.reduce((sum, item) => sum + item.blockCount, 0),
      releasedBlocksMissing: authorized.length - knownBlocks.length,
    };
  });

  const targetMonths = Object.keys(production.targets)
    .filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    .sort();
  const actuals = new Map();
  for (const entry of production.daily) {
    if (
      !isRecord(entry)
      || entry.source !== 'addresses'
      || !STATES.includes(entry.state)
      || !isDate(entry.date)
      || entry.date > brazilDate(now)
    ) continue;
    const month = entry.date.slice(0, 7);
    const key = `${month}|${entry.state}`;
    const prior = actuals.get(key) || { volume: 0, entries: 0, missingBlocks: 0 };
    if (isCount(entry.volume)) prior.volume += entry.volume;
    prior.entries += 1;
    prior.missingBlocks += Math.max(
      isCount(entry.missingBlocks) ? entry.missingBlocks : 0,
      isCount(entry.volume) ? 0 : 1,
    );
    actuals.set(key, prior);
  }

  const periods = [...new Set([...targetMonths, ...Array.from(actuals.keys(), (key) => key.slice(0, 7))])].sort();
  const monthly = periods.map((month) => {
    const states = STATES.map((state) => {
      const target = production.targets[month]?.[state];
      const actual = actuals.get(`${month}|${state}`);
      return {
        state,
        goal: isCount(target) ? target : null,
        actual: actual?.entries > actual?.missingBlocks ? actual.volume : null,
        entries: actual?.entries || 0,
        missingBlocks: actual?.missingBlocks || 0,
      };
    });
    return {
      month,
      states,
      regional: {
        state: 'SUL',
        goal: states.every((entry) => entry.goal !== null)
          ? states.reduce((sum, entry) => sum + entry.goal, 0)
          : null,
        actual: states.every((entry) => entry.actual !== null)
          ? states.reduce((sum, entry) => sum + entry.actual, 0)
          : null,
        entries: states.reduce((sum, entry) => sum + entry.entries, 0),
        missingBlocks: states.reduce((sum, entry) => sum + entry.missingBlocks, 0),
      },
    };
  });

  const regionalStatuses = Object.fromEntries(
    STATUS_GROUPS.map(([, label]) => [
      label,
      byState.reduce((sum, state) => sum + state.statuses[label], 0),
    ]),
  );
  const regional = {
    state: 'SUL',
    addresses: byState.reduce((sum, state) => sum + state.addresses, 0),
    statuses: regionalStatuses,
    authorized: byState.reduce((sum, state) => sum + state.authorized, 0),
    execution: byState.reduce((sum, state) => sum + state.execution, 0),
    completed: byState.reduce((sum, state) => sum + state.completed, 0),
    releasedBlocks: byState.reduce((sum, state) => sum + state.releasedBlocks, 0),
    releasedBlocksMissing: byState.reduce((sum, state) => sum + state.releasedBlocksMissing, 0),
  };

  return {
    extractedAt: now.toISOString(),
    states: byState,
    regional,
    monthly,
    revisions: { addresses: addresses.revision, prumadas: production.revision },
    productionIssues: {
      missingCompletionDate: isCount(production.productionIssues?.missingDate)
        ? production.productionIssues.missingDate
        : 0,
    },
    freshness: {
      status: 'unverified',
      reason: 'A fonte fornece revisões, mas não expõe a data da última alteração dos registros.',
    },
    limitations: {
      production: 'Produção derivada de endereços atualmente Concluídos e da última transição registrada para Concluído; o histórico não comprova execução física.',
      unavailable: [
        'Equipes',
        'Agenda operacional',
        'FCMD e ociosidade',
        'Faturamento realizado',
        'Recebimentos e pagamentos realizados',
        'Projeções de capacidade',
      ],
    },
  };
}

const handlers = createProxy();

module.exports = {
  ...handlers,
  createProxy,
  buildKpiSnapshot,
  extractWorkerToken,
  requestOrigin,
  readSessionToken,
  workerOrigin: WORKER_ORIGIN,
};
