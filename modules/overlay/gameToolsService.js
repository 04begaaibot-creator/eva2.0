const fs = require('node:fs');
const path = require('node:path');

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
const OVERLAY_OFFLINE_AFTER_MS = 90_000;
const HEARTBEAT_CHECK_INTERVAL_MS = 15_000;
const DEFAULT_GIFT_TURBO_PROGRESS = 6;
const DEFAULT_TAP_TURBO_PROGRESS = 3;
const MAX_TURBO_PROGRESS = 100;

function createGameToolsService({
  persistence,
  stream,
  notificationConfigPath = path.join(process.cwd(), 'data', 'tiktok', 'whatsapp-notifications.json'),
  fetchImpl = globalThis.fetch,
  now = Date.now,
  logger = console,
} = {}) {
  if (!persistence || typeof persistence.readState !== 'function'
    || typeof persistence.writeState !== 'function'
    || !stream || typeof stream.attach !== 'function'
    || typeof stream.broadcast !== 'function') {
    throw new Error('El servicio de herramientas necesita persistencia y un canal de eventos.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('El servicio de notificaciones necesita la API fetch.');
  }

  const saved = persistence.readState('cluss.gameTools');
  const savedState = saved.found && saved.value && typeof saved.value === 'object'
    && Number.isSafeInteger(saved.value.timerStartedAt) && saved.value.timerStartedAt >= 0
    && Number.isSafeInteger(saved.value.giftCount) && saved.value.giftCount >= 0
    ? saved.value
    : null;
  let state = saved.found && saved.value && typeof saved.value === 'object'
    && Number.isSafeInteger(saved.value.timerStartedAt) && saved.value.timerStartedAt >= 0
    && Number.isSafeInteger(saved.value.giftCount) && saved.value.giftCount >= 0
    ? {
      timerStartedAt: saved.value.timerStartedAt,
      giftCount: saved.value.giftCount,
      giftTurboProgress: Number.isFinite(saved.value.giftTurboProgress)
        && saved.value.giftTurboProgress >= 0
        && saved.value.giftTurboProgress <= MAX_TURBO_PROGRESS
        ? saved.value.giftTurboProgress
        : DEFAULT_GIFT_TURBO_PROGRESS,
      tapTurboProgress: Number.isFinite(saved.value.tapTurboProgress)
        && saved.value.tapTurboProgress >= 0
        && saved.value.tapTurboProgress <= MAX_TURBO_PROGRESS
        ? saved.value.tapTurboProgress
        : DEFAULT_TAP_TURBO_PROGRESS,
    }
    : {
      timerStartedAt: now(),
      giftCount: 0,
      giftTurboProgress: DEFAULT_GIFT_TURBO_PROGRESS,
      tapTurboProgress: DEFAULT_TAP_TURBO_PROGRESS,
    };

  let notificationConfig = {
    enabled: false,
    apiUrl: '',
    instance: '',
    apiKey: '',
    phoneNumber: '',
  };
  try {
    const storedConfig = JSON.parse(fs.readFileSync(notificationConfigPath, 'utf8'));
    if (!storedConfig || typeof storedConfig !== 'object'
      || typeof storedConfig.enabled !== 'boolean'
      || typeof storedConfig.apiUrl !== 'string'
      || typeof storedConfig.instance !== 'string'
      || typeof storedConfig.apiKey !== 'string'
      || typeof storedConfig.phoneNumber !== 'string') {
      throw new Error('El archivo de notificaciones de WhatsApp no tiene un formato válido.');
    }
    notificationConfig = { ...notificationConfig, ...storedConfig };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const overlayClients = new Map();
  const notificationStatus = { lastSentAt: null, lastError: '' };
  let audienceCount = null;
  let overlayOnline = false;

  function persist() {
    persistence.writeState('cluss.gameTools', state);
  }

  if (!savedState || state.timerStartedAt !== savedState.timerStartedAt
    || state.giftCount !== savedState.giftCount
    || Object.prototype.hasOwnProperty.call(savedState, 'audienceMultiplier')
    || state.giftTurboProgress !== savedState.giftTurboProgress
    || state.tapTurboProgress !== savedState.tapTurboProgress) persist();

  function getState() {
    return { ...state };
  }

  function publish() {
    stream.broadcast('game-tools', getState());
  }

  function getGameSettings() {
    return {
      count: audienceCount,
      giftTurboProgress: state.giftTurboProgress,
      tapTurboProgress: state.tapTurboProgress,
    };
  }

  function publishGameSettings() {
    stream.broadcast('game-settings', getGameSettings());
  }

  function setAudienceCount(count) {
    const nextCount = count === null ? null : Number(count);
    if (nextCount !== null
      && (!Number.isSafeInteger(nextCount) || nextCount < 0)) return false;
    if (nextCount === audienceCount) return true;
    audienceCount = nextCount;
    publishGameSettings();
    return true;
  }

  function setGameSettings(body) {
    const giftTurboProgress = Number(body?.giftTurboProgress);
    const tapTurboProgress = Number(body?.tapTurboProgress);
    if (!Number.isFinite(giftTurboProgress) || giftTurboProgress < 0
      || giftTurboProgress > MAX_TURBO_PROGRESS
      || !Number.isFinite(tapTurboProgress) || tapTurboProgress < 0
      || tapTurboProgress > MAX_TURBO_PROGRESS) {
      return {
        ok: false,
        status: 400,
        message: `Los avances de turbo deben estar entre 0 y ${MAX_TURBO_PROGRESS} por ciento.`,
      };
    }
    state = {
      ...state,
      giftTurboProgress: Math.round(giftTurboProgress * 10) / 10,
      tapTurboProgress: Math.round(tapTurboProgress * 10) / 10,
    };
    persist();
    publish();
    publishGameSettings();
    return { ok: true, ...getState() };
  }

  function getOverlayStatus() {
    const currentTime = now();
    let lastSeenAt = null;
    let online = false;
    for (const [clientId, client] of overlayClients) {
      if (currentTime - client.lastSeenAt > OVERLAY_OFFLINE_AFTER_MS) {
        overlayClients.delete(clientId);
        continue;
      }
      if (client.visible) online = true;
      if (lastSeenAt === null || client.lastSeenAt > lastSeenAt) lastSeenAt = client.lastSeenAt;
    }
    return {
      online,
      lastSeenAt: lastSeenAt === null ? null : new Date(lastSeenAt).toISOString(),
      timeoutMs: OVERLAY_OFFLINE_AFTER_MS,
    };
  }

  function getWhatsAppConfig() {
    return {
      enabled: notificationConfig.enabled,
      apiUrl: notificationConfig.apiUrl,
      instance: notificationConfig.instance,
      phoneNumber: notificationConfig.phoneNumber,
      apiKeyConfigured: Boolean(notificationConfig.apiKey),
      lastSentAt: notificationStatus.lastSentAt,
      lastError: notificationStatus.lastError,
    };
  }

  function publishWhatsAppStatus() {
    stream.broadcast('whatsapp-status', getWhatsAppConfig());
  }

  function publishOverlayStatus() {
    stream.broadcast('overlay-status', getOverlayStatus());
  }

  function sendWhatsAppMessage(text) {
    if (!notificationConfig.enabled) return;
    const endpoint = `${notificationConfig.apiUrl}/message/sendText/${encodeURIComponent(notificationConfig.instance)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    Promise.resolve().then(() => fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: notificationConfig.apiKey,
      },
      body: JSON.stringify({
        number: notificationConfig.phoneNumber,
        text,
      }),
      signal: controller.signal,
    })).then((response) => {
      if (!response.ok) {
        const error = new Error(`Evolution API respondió HTTP ${response.status}.`);
        error.status = response.status;
        throw error;
      }
      notificationStatus.lastSentAt = now();
      notificationStatus.lastError = '';
      publishWhatsAppStatus();
    }).catch((error) => {
      notificationStatus.lastError = Number.isInteger(error.status)
        ? `Evolution API respondió HTTP ${error.status}.`
        : 'No se pudo conectar con Evolution API.';
      logger.error(`[WhatsApp] ${notificationStatus.lastError}`, error.message);
      publishWhatsAppStatus();
    }).finally(() => clearTimeout(timeout));
  }

  function checkOverlayStatus() {
    const nextStatus = getOverlayStatus();
    if (nextStatus.online === overlayOnline) return nextStatus;
    const wasOnline = overlayOnline;
    overlayOnline = nextStatus.online;
    publishOverlayStatus();
    if (wasOnline && !overlayOnline) {
      sendWhatsAppMessage('⚠️ El overlay de Android dejó de reportar al servidor. Puede estar suspendido (por ejemplo, con la pantalla apagada) o sin conexión.');
    }
    return nextStatus;
  }

  const heartbeatTimer = setInterval(checkOverlayStatus, HEARTBEAT_CHECK_INTERVAL_MS);
  heartbeatTimer.unref?.();

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

    const sender = typeof entry.username === 'string' && entry.username.trim()
      ? `@${entry.username.trim()}`
      : 'Un usuario';
    const giftName = typeof entry.giftName === 'string' && entry.giftName.trim()
      ? entry.giftName.trim()
      : 'un regalo';
    sendWhatsAppMessage(`🎁 ${sender} envió ${giftName}${count > 1 ? ` x${count}` : ''} en TikTok LIVE.`);
  }

  function resetCounters() {
    state = {
      ...state,
      timerStartedAt: now(),
      giftCount: 0,
    };
    persist();
    publish();
    return getState();
  }

  function sendCommand(command) {
    if (!GAME_COMMANDS.has(command)) return false;
    stream.broadcast('game-command', { command, sentAt: now() });
    return true;
  }

  function saveWhatsAppConfig(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, status: 400, message: 'La configuración de WhatsApp no es válida.' };
    }
    const apiUrl = typeof body.apiUrl === 'string' ? body.apiUrl.trim() : notificationConfig.apiUrl;
    const instance = typeof body.instance === 'string' ? body.instance.trim() : notificationConfig.instance;
    const phoneNumber = typeof body.phoneNumber === 'string'
      ? body.phoneNumber.trim().replace(/^\+/, '')
      : notificationConfig.phoneNumber;
    const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim()
      ? body.apiKey.trim()
      : notificationConfig.apiKey;

    let normalizedApiUrl = '';
    if (apiUrl) {
      try {
        const parsed = new URL(apiUrl);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
          || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) {
          throw new Error();
        }
        normalizedApiUrl = parsed.origin;
      } catch {
        return { ok: false, status: 400, message: 'Ingresa una URL base HTTP o HTTPS válida de Evolution API.' };
      }
    }
    if (instance && !/^[a-zA-Z0-9._-]{1,100}$/.test(instance)) {
      return { ok: false, status: 400, message: 'El nombre de instancia no es válido.' };
    }
    if (phoneNumber && !/^\d{6,20}$/.test(phoneNumber)) {
      return { ok: false, status: 400, message: 'Ingresa el número destino con código de país, solo con dígitos.' };
    }

    const nextConfig = {
      ...notificationConfig,
      apiUrl: normalizedApiUrl,
      instance,
      apiKey,
      phoneNumber,
    };
    if (nextConfig.enabled && (!nextConfig.apiUrl || !nextConfig.instance
      || !nextConfig.apiKey || !nextConfig.phoneNumber)) {
      return { ok: false, status: 400, message: 'Completa URL, instancia, API Key y número antes de activar las alertas.' };
    }

    try {
      fs.mkdirSync(path.dirname(notificationConfigPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(notificationConfigPath, JSON.stringify(nextConfig, null, 2), { mode: 0o600 });
    } catch (error) {
      logger.error('[WhatsApp] No se pudo guardar la configuración.', error.message);
      return { ok: false, status: 500, message: 'No se pudo guardar la configuración en el servidor.' };
    }
    notificationConfig = nextConfig;
    publishWhatsAppStatus();
    return { ok: true, config: getWhatsAppConfig() };
  }

  function setWhatsAppEnabled(enabled) {
    if (typeof enabled !== 'boolean') {
      return { ok: false, status: 400, message: 'Indica si las notificaciones deben estar activadas.' };
    }
    if (enabled && (!notificationConfig.apiUrl || !notificationConfig.instance
      || !notificationConfig.apiKey || !notificationConfig.phoneNumber)) {
      return { ok: false, status: 400, message: 'Guarda URL, instancia, API Key y número antes de activar las alertas.' };
    }
    notificationConfig = { ...notificationConfig, enabled };
    try {
      fs.mkdirSync(path.dirname(notificationConfigPath), { recursive: true, mode: 0o700 });
      fs.writeFileSync(notificationConfigPath, JSON.stringify(notificationConfig, null, 2), { mode: 0o600 });
    } catch (error) {
      logger.error('[WhatsApp] No se pudo guardar el estado de las notificaciones.', error.message);
      return { ok: false, status: 500, message: 'No se pudo guardar el estado de las alertas en el servidor.' };
    }
    publishWhatsAppStatus();
    return { ok: true, config: getWhatsAppConfig() };
  }

  function recordOverlayHeartbeat(body) {
    if (!body || typeof body.clientId !== 'string'
      || !/^[a-zA-Z0-9._-]{8,128}$/.test(body.clientId)
      || typeof body.visible !== 'boolean') {
      return { ok: false, status: 400, message: 'La señal del overlay no es válida.' };
    }
    overlayClients.set(body.clientId, { lastSeenAt: now(), visible: body.visible });
    return { ok: true, status: checkOverlayStatus() };
  }

  function registerRoutes(app) {
    app.get('/api/game-tools', (request, response) => {
      response.json(getState());
    });

    app.get('/api/game-tools/events', (request, response) => {
      stream.attach(response, [
        ['game-tools', getState()],
        ['game-settings', getGameSettings()],
        ['overlay-status', checkOverlayStatus()],
        ['whatsapp-status', getWhatsAppConfig()],
      ]);
    });

    app.put('/api/game-tools/settings', (request, response) => {
      const result = setGameSettings(request.body);
      if (!result.ok) {
        response.status(result.status).json({ ok: false, message: result.message });
        return;
      }
      response.json(result);
    });

    app.get('/api/game-tools/overlay-status', (request, response) => {
      response.json(checkOverlayStatus());
    });

    app.post('/api/game-tools/overlay-heartbeat', (request, response) => {
      const result = recordOverlayHeartbeat(request.body);
      if (!result.ok) {
        response.status(result.status).json({ ok: false, message: result.message });
        return;
      }
      response.json(result);
    });

    app.get('/api/whatsapp/config', (request, response) => {
      response.json(getWhatsAppConfig());
    });

    app.put('/api/whatsapp/config', (request, response) => {
      const result = saveWhatsAppConfig(request.body);
      if (!result.ok) {
        response.status(result.status).json({ ok: false, message: result.message });
        return;
      }
      response.json(result);
    });

    app.post('/api/whatsapp/notifications', (request, response) => {
      const result = setWhatsAppEnabled(request.body?.enabled);
      if (!result.ok) {
        response.status(result.status).json({ ok: false, message: result.message });
        return;
      }
      response.json(result);
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

  function close() {
    clearInterval(heartbeatTimer);
  }

  return {
    getState,
    getOverlayStatus: checkOverlayStatus,
    getWhatsAppConfig,
    recordEvent,
    recordOverlayHeartbeat,
    resetCounters,
    registerRoutes,
    setAudienceCount,
    close,
  };
}

module.exports = { createGameToolsService, GAME_COMMANDS };
