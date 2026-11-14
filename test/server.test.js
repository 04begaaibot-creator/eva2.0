const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { once } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createWebserver, startServer } = require('../server');

function createMonitorService() {
  let eventListener;
  let audienceCountListener;
  let statusListener;
  const service = {
    state: { username: '', status: 'idle', isConnected: false, error: '' },
    getStatusPayload: () => ({ ...service.state }),
    subscribeToEvents(listener) {
      eventListener = listener;
      return () => { eventListener = null; };
    },
    subscribeToAudienceCount(listener) {
      audienceCountListener = listener;
      return () => { audienceCountListener = null; };
    },
    subscribeToStatus(listener) {
      statusListener = listener;
      return () => { statusListener = null; };
    },
    connectUser(username) {
      Object.assign(service.state, {
        username,
        status: 'connected',
        isConnected: true,
      });
      statusListener({ ...service.state });
    },
    disconnectUser() {},
    refreshRetryWindow() {},
    emit(entry) {
      eventListener(entry);
    },
    emitAudienceCount(count) {
      if (audienceCountListener) audienceCountListener(count);
    },
  };
  return service;
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  const closed = once(server, 'close');
  server.close();
  await closed;
}

const eventBuffers = new WeakMap();

async function readEvent(reader, eventName) {
  let message = eventBuffers.get(reader) || '';
  while (true) {
    const boundary = message.indexOf('\n\n');
    if (boundary >= 0) {
      const frame = message.slice(0, boundary + 2);
      message = message.slice(boundary + 2);
      if (frame.startsWith(`event: ${eventName}\n`)) {
        eventBuffers.set(reader, message);
        return frame;
      }
      continue;
    }
    const { value, done } = await reader.read();
    assert.equal(done, false, 'SSE stream closed before the expected event');
    message += new TextDecoder().decode(value);
  }
}

test('serves v21 as the main Cluss TikTok overlay', async (t) => {
  const root = path.join(__dirname, '..');
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY v21\.html \.\//);
  assert.equal(fs.existsSync(path.join(root, 'v21.html')), true);
  assert.equal(fs.existsSync(path.join(root, 'v21 (1).html')), false);
  assert.equal(fs.existsSync(path.join(root, 'v10.html')), false);
  assert.equal(fs.existsSync(path.join(root, 'cluss.html')), false);
  assert.equal(fs.existsSync(path.join(root, 'tortugas_tiktok.html')), false);
  assert.equal(fs.existsSync(path.join(root, 'tortugas.html')), false);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tortu-overlay-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const monitorService = createMonitorService();
  const { server } = createWebserver({
    configurationPath: path.join(directory, 'config.json'),
    overlayDataPath: path.join(directory, 'overlay'),
    monitorService,
  });
  const baseUrl = await listen(server);

  try {
    const backendResponse = await fetch(`${baseUrl}/backend`);
    assert.equal(backendResponse.status, 200);
    const backendHtml = await backendResponse.text();
    assert.match(backendHtml, /fetch\('\/api\/reconnect', \{ method: 'POST' \}\)/);
    assert.match(backendHtml, /id="tools-toggle"/);
    assert.match(backendHtml, /data-command="reset-cups"/);
    assert.match(backendHtml, /data-command="refresh"/);
    assert.match(backendHtml, /id="whatsapp-enable"/);
    assert.match(backendHtml, /id="whatsapp-form"/);
    assert.match(backendHtml, /id="game-settings-form"/);
    assert.match(backendHtml, /Object\.prototype\.hasOwnProperty\.call\(state, 'count'\)/);
    assert.match(backendHtml, /\/api\/game-tools\/reset/);
    assert.equal(monitorService.state.isConnected, false, 'opening the backend must not connect TikTok');

    const rootResponse = await fetch(baseUrl);
    assert.equal(rootResponse.status, 200);
    assert.equal(monitorService.state.isConnected, false, 'serving the overlay must not connect TikTok');
    assert.match(rootResponse.headers.get('cache-control'), /no-store/);
    const servedHtml = await rootResponse.text();
    assert.equal(servedHtml, fs.readFileSync(path.join(root, 'v21.html'), 'utf8'));
    assert.match(servedHtml, /new EventSource\('\/api\/events'\)/);
    assert.match(servedHtml, /source\.addEventListener\('status'/);
    assert.match(servedHtml, /source\.addEventListener\('update'/);
    assert.match(servedHtml, /toolsSource\.addEventListener\('game-command'/);
    assert.match(servedHtml, /if\(command==='refresh'\)\{location\.reload\(\);return\}/);
    assert.match(servedHtml, /\/api\/game-tools\/overlay-heartbeat/);
    assert.match(servedHtml, /toolsSource\.addEventListener\('game-settings'/);
    assert.doesNotMatch(servedHtml, /button\.id='bArch'|button\.id='bLiveEvents'/);
    assert.doesNotMatch(servedHtml, /b2\.title=need\?/);
    assert.match(servedHtml, /fetch\('\/api\/connect'/);
    assert.match(servedHtml, /recordReceivedEvent\('update'/);
    assert.match(servedHtml, /window\.addEventListener\('load',registerLiveProcessor,\{once:true\}\)/);
    assert.match(servedHtml, /addLiveEventStage\(item,'validation'/);
    assert.match(servedHtml, /addLiveEventStage\(item,'dispatch'/);
    assert.match(servedHtml, /addLiveEventStage\(item,'result'/);
    assert.match(servedHtml, /liveEvent(?:sById|Ids)\.has\(sourceId\)/);
    assert.match(servedHtml, /window\.getLiveEventSnapshot=\(\)=>/);
    assert.match(servedHtml, /LIVE_DIAGNOSTIC_DURATION=10\*60\*1000/);
    assert.match(servedHtml, /id="toggleLiveLog"/);
    assert.match(servedHtml, /id="copyLiveLog"/);
    assert.match(servedHtml, /navigator\.clipboard\.writeText/);
    assert.match(servedHtml, /if\(!isLiveDiagnosticActive\(\)\)return/);
    assert.match(servedHtml, /window\.liveEventMonitor\.completeRound\(T\[i\]\.id\)/);
    assert.match(servedHtml, /pendingChatRecords\.push/);
    assert.match(servedHtml, /<script src="\/api\/state\.js"><\/script>/);
    assert.match(servedHtml, /window\.SRV=/);
    assert.match(servedHtml, /SRV\.log\('user-events'/);
    assert.match(servedHtml, /SRV\.log\('chat-texts'/);
    assert.match(servedHtml, /SRVCHAT_JSON='\/api\/log\/chat-texts\.json'/);
    assert.match(servedHtml, /<script src="\/activity-policy\.js"><\/script>/);
    assert.match(servedHtml, /@keyframes gmGift/);
    assert.match(servedHtml, /@keyframes gmHeart/);
    assert.match(servedHtml, /function sincro\(\)/);
    assert.doesNotMatch(servedHtml, /(?:localStorage|sessionStorage|indexedDB)\.(?:getItem|setItem|open)/);
    assert.deepEqual(await fetch(`${baseUrl}/api/config`).then((response) => response.json()), {
      username: 'd4n1el325',
    });

    for (const route of ['/overlay', '/tortugas.html', '/tortugas_tiktok.html', '/v2.0.html']) {
      const response = await fetch(`${baseUrl}${route}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), servedHtml);
    }
    assert.equal((await fetch(`${baseUrl}/v1.3.html`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/v68.html`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/v60.html`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/v45.html`)).status, 404);
    const serviceWorker = await fetch(`${baseUrl}/sw.js`);
    assert.equal(serviceWorker.status, 200);
    assert.match(await serviceWorker.text(), /tortu-shell-v15/);
    assert.equal((await fetch(`${baseUrl}/activity-policy.js`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/api/activity-policy.js`)).status, 200);
    const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    const appManifest = await manifest.json();
    assert.equal(appManifest.name, 'TortuWorld');
    assert.equal(appManifest.short_name, 'TortuWorld');
    assert.equal(appManifest.display, 'fullscreen');
    assert.deepEqual(await fetch(`${baseUrl}/health`).then((response) => response.json()), {
      ok: true,
    });
  } finally {
    await close(server);
  }
});

test('shares server game tools and gift counts across clients until manually reset', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tortu-game-tools-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const monitorService = createMonitorService();
  const { server } = createWebserver({
    configurationPath: path.join(directory, 'config.json'),
    overlayDataPath: path.join(directory, 'overlay'),
    monitorService,
  });
  const baseUrl = await listen(server);
  let reader;

  try {
    const initial = await fetch(`${baseUrl}/api/game-tools`).then((response) => response.json());
    assert.equal(initial.giftCount, 0);
    assert.ok(Number.isSafeInteger(initial.timerStartedAt));
    assert.equal(Object.hasOwn(initial, 'audienceMultiplier'), false);
    assert.equal(initial.giftTurboProgress, 6);
    assert.equal(initial.tapTurboProgress, 3);

    const settingsResponse = await fetch(`${baseUrl}/api/game-tools/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        giftTurboProgress: 8.5,
        tapTurboProgress: 4,
      }),
    });
    assert.equal(settingsResponse.status, 200);
    const gameSettings = await settingsResponse.json();
    assert.equal(Object.hasOwn(gameSettings, 'audienceMultiplier'), false);
    assert.equal(gameSettings.giftTurboProgress, 8.5);
    assert.equal(gameSettings.tapTurboProgress, 4);
    monitorService.emitAudienceCount(12);

    const eventResponse = await fetch(`${baseUrl}/api/game-tools/events`);
    reader = eventResponse.body.getReader();
    await readEvent(reader, 'game-tools');
    const firstAudience = await readEvent(reader, 'game-settings');
    assert.match(firstAudience, /"count":12/);
    monitorService.emitAudienceCount(7);
    const updatedAudience = await readEvent(reader, 'game-settings');
    assert.match(updatedAudience, /"count":7/);

    const commandResponse = await fetch(`${baseUrl}/api/game-tools/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'sound-effects' }),
    });
    assert.deepEqual(await commandResponse.json(), { ok: true, command: 'sound-effects' });
    const commandEvent = await readEvent(reader, 'game-command');
    assert.match(commandEvent, /"command":"sound-effects"/);

    const refreshResponse = await fetch(`${baseUrl}/api/game-tools/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'refresh' }),
    });
    assert.deepEqual(await refreshResponse.json(), { ok: true, command: 'refresh' });
    assert.match(await readEvent(reader, 'game-command'), /"command":"refresh"/);

    monitorService.emit({ type: 'gift', activityCount: 3, username: 'viewer' });
    const giftEvent = await readEvent(reader, 'game-tools');
    assert.match(giftEvent, /"giftCount":3/);
    assert.equal(
      (await fetch(`${baseUrl}/api/game-tools`).then((response) => response.json())).giftCount,
      3,
    );

    const invalidCommand = await fetch(`${baseUrl}/api/game-tools/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'not-a-tool' }),
    });
    assert.equal(invalidCommand.status, 400);

    const reset = await fetch(`${baseUrl}/api/game-tools/reset`, { method: 'POST' })
      .then((response) => response.json());
    assert.equal(reset.giftCount, 0);
    assert.equal(Object.hasOwn(reset, 'audienceMultiplier'), false);
    assert.equal(reset.giftTurboProgress, 8.5);
    assert.equal(reset.tapTurboProgress, 4);
    assert.ok(reset.timerStartedAt >= initial.timerStartedAt);
    const { ok, ...savedReset } = reset;
    assert.equal(ok, true);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(directory, 'overlay', 'state', 'Y2x1c3MuZ2FtZVRvb2xz.json'), 'utf8')),
      savedReset,
    );
  } finally {
    if (reader) await reader.cancel();
    await close(server);
  }
});

test('sends WhatsApp alerts only when enabled and tracks overlay visibility', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tortu-whatsapp-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const monitorService = createMonitorService();
  const requests = [];
  const { server } = createWebserver({
    configurationPath: path.join(directory, 'config.json'),
    overlayDataPath: path.join(directory, 'overlay'),
    monitorService,
    whatsappFetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200 };
    },
  });
  const baseUrl = await listen(server);

  try {
    const configResponse = await fetch(`${baseUrl}/api/whatsapp/config`);
    const initialConfig = await configResponse.json();
    assert.equal(initialConfig.enabled, false);
    assert.equal(initialConfig.apiKeyConfigured, false);
    assert.equal(JSON.stringify(initialConfig).includes('secret-key'), false);

    const saveResponse = await fetch(`${baseUrl}/api/whatsapp/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiUrl: 'https://evolution.example.com/',
        instance: 'tortu live',
        apiKey: 'secret-key',
        phoneNumber: '+595981234567',
      }),
    });
    assert.equal(saveResponse.status, 400, 'instance names containing spaces are rejected');

    const validSaveResponse = await fetch(`${baseUrl}/api/whatsapp/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiUrl: 'https://evolution.example.com/',
        instance: 'tortu-live',
        apiKey: 'secret-key',
        phoneNumber: '+595981234567',
      }),
    });
    assert.equal(validSaveResponse.status, 200);
    const savedConfig = await validSaveResponse.json();
    assert.equal(savedConfig.config.apiKeyConfigured, true);
    assert.equal(JSON.stringify(savedConfig).includes('secret-key'), false);

    monitorService.emit({
      type: 'gift',
      activityCount: 2,
      giftName: 'Rosa',
      username: 'viewer',
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 0, 'disabled alerts must not call Evolution API');

    const enableResponse = await fetch(`${baseUrl}/api/whatsapp/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(enableResponse.status, 200);
    monitorService.emit({
      type: 'gift',
      activityCount: 2,
      giftName: 'Rosa',
      username: 'viewer',
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      'https://evolution.example.com/message/sendText/tortu-live',
    );
    assert.equal(requests[0].options.headers.apikey, 'secret-key');
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      number: '595981234567',
      text: '🎁 @viewer envió Rosa x2 en TikTok LIVE.',
    });

    const online = await fetch(`${baseUrl}/api/game-tools/overlay-heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'android-overlay-01', visible: true }),
    }).then((response) => response.json());
    assert.equal(online.status.online, true);
    const offline = await fetch(`${baseUrl}/api/game-tools/overlay-heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'android-overlay-01', visible: false }),
    }).then((response) => response.json());
    assert.equal(offline.status.online, false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 2);
    assert.match(JSON.parse(requests[1].options.body).text, /overlay de Android dejó de reportar/);

    await fetch(`${baseUrl}/api/whatsapp/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    monitorService.emit({ type: 'gift', activityCount: 1, giftName: 'Rosa' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 2, 'disabled alerts must stop future messages');

    const savedOnDisk = JSON.parse(fs.readFileSync(
      path.join(directory, 'whatsapp-notifications.json'),
      'utf8',
    ));
    assert.equal(savedOnDisk.enabled, false);
    assert.equal(savedOnDisk.apiKey, 'secret-key');
  } finally {
    await close(server);
  }
});

test('forwards normalized TikTok updates in the shape consumed by v21', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tortu-test-'));
  const monitorService = createMonitorService();
  const { server } = createWebserver({
    configurationPath: path.join(directory, 'config.json'),
    commentStatsPath: path.join(directory, 'comment-stats.json'),
    recentUsersPath: path.join(directory, 'recent-users.json'),
    monitorService,
  });

  test('archives real comment text and tracks free-tournament votes without user names', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tortu-free-mode-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const monitorService = createMonitorService();
    const { server } = createWebserver({
      configurationPath: path.join(directory, 'config.json'),
      commentStatsPath: path.join(directory, 'comment-stats.json'),
      recentUsersPath: path.join(directory, 'recent-users.json'),
      freeTournamentPath: path.join(directory, 'free-tournament.json'),
      commentArchivePath: path.join(directory, 'comments-archive.json'),
      monitorService,
    });
    const baseUrl = await listen(server);

    try {
      monitorService.emit({ type: 'chat', username: 'ana', content: 'Cerro Porteño' });
      const initialStats = await fetch(`${baseUrl}/api/free-tournament/stats`).then((response) => response.json());
      assert.equal(initialStats.enabled, true, 'free voting is enabled by default');
      assert.equal(initialStats.teams.length, 0, 'votes remain pending until the race finishes');
      assert.equal(fs.existsSync(path.join(directory, 'free-tournament.json')), false);

      const disabled = await fetch(`${baseUrl}/api/free-tournament/mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }).then((response) => response.json());
      assert.equal(disabled.enabled, false);
      monitorService.emit({ type: 'chat', username: 'ana', content: 'Cerro Porteño' });

      const enabled = await fetch(`${baseUrl}/api/free-tournament/mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      }).then((response) => response.json());
      assert.equal(enabled.enabled, true);
      monitorService.emit({ type: 'chat', username: 'ana', content: 'Vamos Cerro Porteño hoy' });

      const beforeFinish = await fetch(`${baseUrl}/api/comment-archive`).then((response) => response.json());
      assert.equal(beforeFinish.comments.length, 0, 'comments remain pending until the race finishes');
      const completedRound = await fetch(`${baseUrl}/api/round/complete`, { method: 'POST' });
      assert.equal((await completedRound.json()).stored, 3);
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(directory, 'free-tournament.json'), 'utf8')).teams[0].votes,
        2,
      );

      const votes = await fetch(`${baseUrl}/api/free-tournament/stats`).then((response) => response.json());
      assert.deepEqual(votes.teams.map(({ name, votes: total, users }) => ({ name, votes: total, users })), [
        { name: 'Cerro Porteño', votes: 2, users: 1 },
      ]);

      const archive = await fetch(`${baseUrl}/api/comment-archive`).then((response) => response.json());
      assert.deepEqual(archive.comments.map((comment) => comment.text), [
        'Cerro Porteño', 'Cerro Porteño', 'Vamos Cerro Porteño hoy',
      ]);
      assert.equal('username' in archive.comments[0], false);
      const textExport = await fetch(`${baseUrl}/api/comment-archive.txt`).then((response) => response.text());
      assert.equal(textExport, 'Cerro Porteño\nCerro Porteño\nVamos Cerro Porteño hoy');
      const savedVotes = fs.readFileSync(path.join(directory, 'free-tournament.json'), 'utf8');
      assert.doesNotMatch(savedVotes, /ana/);

      const deniedReset = await fetch(`${baseUrl}/api/comment-archive/reset`, { method: 'POST' });
      assert.equal(deniedReset.status, 400);
      const reset = await fetch(`${baseUrl}/api/comment-archive/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      }).then((response) => response.json());
      assert.equal(reset.count, 0);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'comments-archive.json'), 'utf8')).comments, []);
    } finally {
      await close(server);
    }
  });
  const baseUrl = await listen(server);
  let reader;

  try {
    const stream = await fetch(`${baseUrl}/api/events`);
    reader = stream.body.getReader();
    const initialStatus = await readEvent(reader, 'status');
    assert.doesNotMatch(initialStatus, /event: snapshot/);

    const configResponse = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '@race-host' }),
    });
    assert.deepEqual(await configResponse.json(), { ok: true, username: 'race-host' });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8')), {
      username: 'race-host',
    });
    assert.equal(monitorService.state.status, 'idle', 'saving configuration must not connect TikTok');
    const reconnectResponse = await fetch(`${baseUrl}/api/reconnect`, { method: 'POST' });
    assert.deepEqual(await reconnectResponse.json(), { ok: true, username: 'race-host' });
    assert.equal(monitorService.state.isConnected, true);

    const entry = {
      type: 'chat',
      username: 'viewer',
      content: 'Argentina',
      time: '2026-11-08T12:00:00.000Z',
    };
    monitorService.emit(entry);
    const update = await readEvent(reader, 'update');
    const payload = JSON.parse(update.match(/event: update\ndata: (.+)\n/)[1]);
    assert.deepEqual(payload.entry, {
      ...entry,
      lifecycle: payload.entry.lifecycle,
    });
    assert.deepEqual(payload.entry.lifecycle.map(({ stage }) => stage), [
      'backend_received',
      'sse_published',
    ]);

    const pendingStats = await fetch(`${baseUrl}/api/comment-stats`).then((response) => response.json());
    assert.equal(pendingStats.total, 0, 'comments are not persisted before the race finishes');
    assert.equal(fs.existsSync(path.join(directory, 'comments-archive.json')), false);
    const completedRound = await fetch(`${baseUrl}/api/round/complete`, { method: 'POST' });
    assert.equal((await completedRound.json()).stored, 1);
    const emptyCompletion = await fetch(`${baseUrl}/api/round/complete`, { method: 'POST' });
    assert.equal((await emptyCompletion.json()).stored, 0, 'finishing twice does not persist the same comments again');
    const stats = await fetch(`${baseUrl}/api/comment-stats`).then((response) => response.json());
    assert.equal(stats.total, 1);
    assert.equal(stats.teams.find((team) => team.code === 'AR').comments, 1);

    monitorService.emit({
      type: 'member',
      username: 'new-viewer',
      avatar: 'https://example.com/new-viewer.png',
    });
    const savedRecentUsers = await fetch(`${baseUrl}/api/recent-users`).then((response) => response.json());
    assert.equal(savedRecentUsers.users[0].username, 'new-viewer');
    assert.equal(savedRecentUsers.users[0].avatar, 'https://example.com/new-viewer.png');
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(directory, 'recent-users.json'), 'utf8')).users,
      savedRecentUsers.users,
    );

    const savedUsersResponse = await fetch(`${baseUrl}/api/recent-users`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        users: [{ username: 'fabricated-user', avatar: '', t: 1 }],
      }),
    });
    assert.equal(savedUsersResponse.status, 404);
    assert.deepEqual(
      (await fetch(`${baseUrl}/api/recent-users`).then((response) => response.json()))
        .users.map((user) => user.username),
      ['new-viewer'],
    );

    const manualConnection = await fetch(`${baseUrl}/api/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '@test-channel' }),
    });
    assert.deepEqual(await manualConnection.json(), { ok: true, username: 'test-channel' });
    assert.equal(monitorService.state.username, 'test-channel');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8')), {
      username: 'race-host',
    }, 'manual test connections must not change the saved configuration');

    const invalidManualConnection = await fetch(`${baseUrl}/api/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '   ' }),
    });
    assert.equal(invalidManualConnection.status, 400);
  } finally {
    if (reader) await reader.cancel();
    await close(server);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('server starts on the requested port and logs its address', async () => {
  const messages = [];
  const server = startServer({
    port: 0,
    host: '127.0.0.1',
    createWebserver: () => createWebserver({ monitorService: createMonitorService() }),
    logger: { log: (message) => messages.push(message), error() {} },
  });
  await once(server, 'listening');
  assert.match(messages[0], /http:\/\/localhost:\d+/);
  await close(server);
});
