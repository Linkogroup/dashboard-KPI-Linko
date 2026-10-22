const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProxy,
  buildKpiSnapshot,
  extractWorkerToken,
  workerOrigin,
} = require('../lib/worker-proxy.cjs');

const token = 'a'.repeat(64);
const workerCookie = `__Host-f4a_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`;

function mockRequest({
  method = 'GET',
  path = '/',
  origin = 'https://kpi.f4aconsultoria.com.br',
  host = 'kpi.f4aconsultoria.com.br',
  cookie,
  body,
  contentType = 'application/json',
} = {}) {
  return {
    method,
    url: path,
    headers: {
      host,
      origin,
      'content-type': contentType,
      'sec-fetch-site': 'same-origin',
      ...(cookie ? { cookie } : {}),
    },
    body,
  };
}

function mockResponse() {
  return {
    headers: {},
    statusCode: 0,
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value) {
      this.body = value || '';
      this.headersSent = true;
    },
  };
}

function upstreamResponse(status, body, headers = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
  });
}

function masterResponse() {
  return upstreamResponse(200, { accessProfile: 'master', mustChange: false });
}

const addresses = {
  revision: 12,
  items: [
    {
      id: 'private-address-id',
      state: 'PR',
      status: 'Autorizado',
      blockCount: 4,
      street: 'Rua privada',
      contact: 'Contato privado',
      phone: '5511999999999',
    },
    { id: 'private-completed-id', state: 'SC', status: 'Concluído', blockCount: 2 },
    { id: 'outside-region', state: 'SP', status: 'Autorizado', blockCount: 100 },
  ],
};

const production = {
  revision: 16,
  addressRevision: 12,
  targets: { '2026-10': { PR: 8, SC: 5, RS: 0 } },
  daily: [
    {
      source: 'addresses',
      date: '2026-10-05',
      state: 'SC',
      volume: 2,
      missingBlocks: 0,
      addressId: 'private-completed-id',
      note: 'Private note',
    },
    { source: 'manual', date: '2026-10-05', state: 'PR', volume: 999 },
  ],
  productionIssues: { missingDate: 1 },
};

test('login enforces same-origin, proxies credentials only to fixed Worker login, and stores a host-only HttpOnly session', async () => {
  const calls = [];
  const proxy = createProxy({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === `${workerOrigin}/api/auth/login`) {
        return upstreamResponse(200, { next: '/home' }, { 'Set-Cookie': workerCookie });
      }
      if (url === `${workerOrigin}/api/auth/me`) return masterResponse();
      throw new Error('Unexpected upstream endpoint');
    },
  });
  const res = mockResponse();

  await proxy.login(mockRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email: 'master@example.com', password: 'not-logged-or-returned' },
  }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { authenticated: true });
  assert.match(res.headers['set-cookie'], /^__Host-f4a_session=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${workerOrigin}/api/auth/login`);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.headers.Origin, workerOrigin);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    email: 'master@example.com',
    password: 'not-logged-or-returned',
  });
  assert.equal(calls[1].options.headers.Cookie, `__Host-f4a_session=${token}`);
  assert.equal(res.body.includes(token), false);
  assert.equal(res.body.includes('master@example.com'), false);
});

test('login rejects cross-origin requests before contacting the Worker', async () => {
  let calls = 0;
  const proxy = createProxy({ fetchImpl: async () => { calls += 1; } });
  const res = mockResponse();

  await proxy.login(mockRequest({
    method: 'POST',
    path: '/api/auth/login',
    origin: 'https://attacker.example',
    body: { email: 'master@example.com', password: 'secret' },
  }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(calls, 0);
});

test('login rejects missing Origin and login credentials are never accepted from an unapproved host', async () => {
  let calls = 0;
  const proxy = createProxy({ fetchImpl: async () => { calls += 1; } });
  const missingOrigin = mockResponse();
  await proxy.login(mockRequest({
    method: 'POST',
    path: '/api/auth/login',
    origin: null,
    body: { email: 'master@example.com', password: 'secret' },
  }), missingOrigin);
  assert.equal(missingOrigin.statusCode, 403);

  const invalidHost = mockResponse();
  await proxy.login(mockRequest({
    method: 'POST',
    path: '/api/auth/login',
    host: 'kpi.f4aconsultoria.com.br.attacker.example',
    origin: 'https://kpi.f4aconsultoria.com.br.attacker.example',
    body: { email: 'master@example.com', password: 'secret' },
  }), invalidHost);
  assert.equal(invalidHost.statusCode, 403);
  assert.equal(calls, 0);
});

test('login fails closed and revokes non-master or must-change sessions without issuing a cookie', async () => {
  const calls = [];
  const proxy = createProxy({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/api/auth/login')) {
        return upstreamResponse(200, { next: '/home' }, { 'Set-Cookie': workerCookie });
      }
      if (url.endsWith('/api/auth/me')) {
        return upstreamResponse(200, { accessProfile: 'regional', mustChange: false });
      }
      if (url.endsWith('/api/auth/logout')) return upstreamResponse(200, { next: '/login' });
      throw new Error('Unexpected upstream endpoint');
    },
  });
  const res = mockResponse();

  await proxy.login(mockRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email: 'regional@example.com', password: 'not-logged-or-returned' },
  }), res);

  assert.equal(res.statusCode, 403);
  assert.match(res.headers['set-cookie'], /Max-Age=0$/);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, `${workerOrigin}/api/auth/logout`);
  assert.equal(calls[2].options.headers.Cookie, `__Host-f4a_session=${token}`);
  assert.equal(res.body.includes(token), false);
});

test('a Master with a temporary password is not issued a KPI cookie', async () => {
  const calls = [];
  const proxy = createProxy({
    fetchImpl: async (url, options) => {
      calls.push(url);
      if (url.endsWith('/api/auth/login')) {
        return upstreamResponse(200, { next: '/primeiro-acesso' }, { 'Set-Cookie': workerCookie });
      }
      if (url.endsWith('/api/auth/me')) {
        return upstreamResponse(200, { accessProfile: 'master', mustChange: true });
      }
      if (url.endsWith('/api/auth/logout')) return upstreamResponse(200, { next: '/login' });
      throw new Error('Unexpected upstream endpoint');
    },
  });
  const res = mockResponse();

  await proxy.login(mockRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email: 'master@example.com', password: 'temporary-password' },
  }), res);

  assert.equal(res.statusCode, 403);
  assert.match(res.headers['set-cookie'], /Max-Age=0$/);
  assert.deepEqual(calls, [
    `${workerOrigin}/api/auth/login`,
    `${workerOrigin}/api/auth/me`,
    `${workerOrigin}/api/auth/logout`,
  ]);
  assert.equal(res.body.includes(token), false);
});

test('malformed Worker cookie and unexpected login redirects fail closed', async () => {
  assert.equal(extractWorkerToken(upstreamResponse(200, {}, {
    'Set-Cookie': `${workerCookie}; Domain=workers.dev`,
  })), null);
  assert.equal(extractWorkerToken(upstreamResponse(200, {}, {
    'Set-Cookie': '__Host-f4a_session=short; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800',
  })), null);

  const proxy = createProxy({
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'manual');
      return new Response(null, { status: 302, headers: { Location: 'https://attacker.example/' } });
    },
  });
  const res = mockResponse();
  await proxy.login(mockRequest({
    method: 'POST',
    path: '/api/auth/login',
    body: { email: 'master@example.com', password: 'secret' },
  }), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('logout revokes only the allowlisted Worker session and clears the KPI host cookie', async () => {
  const calls = [];
  const proxy = createProxy({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return upstreamResponse(200, { next: '/login' });
    },
  });
  const res = mockResponse();
  await proxy.logout(mockRequest({
    method: 'POST',
    path: '/api/auth/logout',
    cookie: `__Host-f4a_session=${token}`,
    body: {},
  }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['set-cookie'], /^__Host-f4a_session=; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=0$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${workerOrigin}/api/auth/logout`);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Origin, workerOrigin);
  assert.equal(calls[0].options.headers.Cookie, `__Host-f4a_session=${token}`);
});

test('logout clears the browser cookie and reports upstream failure', async () => {
  const proxy = createProxy({ fetchImpl: async () => { throw new Error('network failure'); } });
  const res = mockResponse();
  await proxy.logout(mockRequest({
    method: 'POST',
    path: '/api/auth/logout',
    cookie: `__Host-f4a_session=${token}`,
    body: {},
  }), res);
  assert.equal(res.statusCode, 502);
  assert.match(res.headers['set-cookie'], /Max-Age=0$/);
});

test('KPI route requires a master session and returns only PR/SC/RS aggregates', async () => {
  const calls = [];
  const proxy = createProxy({
    fetchImpl: async (url, options) => {
      calls.push(url);
      if (url.endsWith('/api/auth/me')) return masterResponse();
      if (url.endsWith('/api/enderecos')) return upstreamResponse(200, addresses);
      if (url.endsWith('/api/prumadas')) return upstreamResponse(200, production);
      throw new Error('Unexpected upstream endpoint');
    },
  });
  const res = mockResponse();

  await proxy.kpi(mockRequest({
    path: '/api/kpi',
    cookie: `__Host-f4a_session=${token}`,
  }), res);

  assert.equal(res.statusCode, 200);
  const result = JSON.parse(res.body);
  assert.deepEqual(result.states.map((state) => state.state), ['PR', 'SC', 'RS']);
  assert.equal(result.states[0].addresses, 1);
  assert.equal(result.states[0].releasedBlocks, 4);
  assert.equal(result.monthly[0].states[1].actual, 2);
  assert.equal(result.monthly[0].states[2].goal, 0);
  assert.deepEqual(calls, [
    `${workerOrigin}/api/auth/me`,
    `${workerOrigin}/api/enderecos`,
    `${workerOrigin}/api/prumadas`,
  ]);
  for (const value of [
    'private-address-id',
    'Rua privada',
    'Contato privado',
    '5511999999999',
    'outside-region',
    'Private note',
  ]) {
    assert.equal(res.body.includes(value), false);
  }
  assert.equal(res.headers['cache-control'], 'no-store, private');
});

test('KPI route does not fetch data for absent or non-master sessions', async () => {
  let calls = 0;
  const proxy = createProxy({
    fetchImpl: async (url) => {
      calls += 1;
      if (url.endsWith('/api/auth/me')) {
        return upstreamResponse(200, { accessProfile: 'regional', mustChange: false });
      }
      throw new Error('Data endpoint must not be called');
    },
  });

  const anonymous = mockResponse();
  await proxy.kpi(mockRequest({ path: '/api/kpi' }), anonymous);
  assert.equal(anonymous.statusCode, 401);
  assert.equal(calls, 0);

  const denied = mockResponse();
  await proxy.kpi(mockRequest({
    path: '/api/kpi',
    cookie: `__Host-f4a_session=${token}`,
  }), denied);
  assert.equal(denied.statusCode, 403);
  assert.match(denied.headers['set-cookie'], /Max-Age=0$/);
  assert.equal(calls, 1);
});

test('stale or malformed source revisions do not produce a success-shaped KPI payload', async () => {
  const proxy = createProxy({
    fetchImpl: async (url) => {
      if (url.endsWith('/api/auth/me')) return masterResponse();
      if (url.endsWith('/api/enderecos')) return upstreamResponse(200, addresses);
      if (url.endsWith('/api/prumadas')) {
        return upstreamResponse(200, { ...production, addressRevision: 11 });
      }
      throw new Error('Unexpected upstream endpoint');
    },
  });
  const res = mockResponse();
  await proxy.kpi(mockRequest({
    path: '/api/kpi',
    cookie: `__Host-f4a_session=${token}`,
  }), res);
  assert.equal(res.statusCode, 502);
  assert.match(res.body, /revisão da fonte/);
});

test('aggregation returns stable counts and status summaries without retaining raw records', () => {
  const result = buildKpiSnapshot(addresses, production, new Date('2026-10-22T12:00:00.000Z'));
  assert.equal(result.regional.addresses, 2);
  assert.equal(result.states[2].addresses, 0);
  assert.deepEqual(result.states.map((state) => state.state), ['PR', 'SC', 'RS']);
  assert.equal(result.freshness.status, 'unverified');
  assert.equal(JSON.stringify(result).includes('private'), false);
});
