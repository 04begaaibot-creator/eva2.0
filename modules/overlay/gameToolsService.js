const GAME_COMMANDS = new Set([
  'language',
  'narrator',
  'chat-voice',
  'sound-effects',
  'statistics',
  'reset-cups',
  'turbo-down',
  'turbo-up',
  'tournament',
  'cta',
  'flags',
  'rose-prompt',
  'refresh',
]);

function createGameToolsService({ persistence, stream, now = Date.now } = {}) {
  if (!persistence || typeof persistence.readState !== 'function'
    || typeof persistence.writeState !== 'function'
    || !stream || typeof stream.attach !== 'function'
    || typeof stream.broadcast !== 'function') {
    throw new Error('El servicio de herramientas necesita persistencia y un canal de eventos.');
  }

  const saved = persistence.readState('cluss.gameTools');
  let state = saved.found && saved.value && typeof saved.value === 'object'
    && Number.isSafeInteger(saved.value.timerStartedAt) && saved.value.timerStartedAt >= 0
    && Number.isSafeInteger(saved.value.giftCount) && saved.value.giftCount >= 0
    ? { timerStartedAt: saved.value.timerStartedAt, giftCount: saved.value.giftCount }
    : { timerStartedAt: now(), giftCount: 0 };

  function persist() {
    persistence.writeState('cluss.gameTools', state);
  }

  if (!saved.found || state.timerStartedAt !== saved.value?.timerStartedAt
    || state.giftCount !== saved.value?.giftCount) persist();

  function getState() {
    return { ...state };
  }

  function publish() {
    stream.broadcast('game-tools', getState());
  }

  function recordEvent(entry) {
    if (!entry || entry.type !== 'gift') return;
    const rawCount = Number(entry.activityCount);
    const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.max(1, Math.floor(rawCount)) : 1;
    state = {
      ...state,
      giftCount: Math.min(Number.MAX_SAFE_INTEGER, state.giftCount + count),
    };
    persist();
    publish();
  }

  function resetCounters() {
    state = { timerStartedAt: now(), giftCount: 0 };
    persist();
    publish();
    return getState();
  }

  function sendCommand(command) {
    if (!GAME_COMMANDS.has(command)) return false;
    stream.broadcast('game-command', { command, sentAt: now() });
    return true;
  }

  function registerRoutes(app) {
    app.get('/api/game-tools', (request, response) => {
      response.json(getState());
    });

    app.get('/api/game-tools/events', (request, response) => {
      stream.attach(response, [['game-tools', getState()]]);
    });

    app.post('/api/game-tools/reset', (request, response) => {
      response.json({ ok: true, ...resetCounters() });
    });

    app.post('/api/game-tools/command', (request, response) => {
      const { command } = request.body || {};
      if (!sendCommand(command)) {
        response.status(400).json({ ok: false, message: 'La herramienta solicitada no es válida.' });
        return;
      }
      response.json({ ok: true, command });
    });
  }

  return { getState, recordEvent, resetCounters, registerRoutes };
}

module.exports = { createGameToolsService, GAME_COMMANDS };
