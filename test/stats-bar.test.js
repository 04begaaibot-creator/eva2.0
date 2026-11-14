const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'overlay.html'), 'utf8');
const connectionFunction = html.match(/function setConnection\(status\)\{[\s\S]*?\n\}/)?.[0];
const voiceFilter = html.match(/const voiceHasBlockedWord=text=>\/demonio\/i\.test\(String\(text\)\);/)?.[0];
const tapStepDurationFunction = html.match(/function tapStepDuration\(count\)\{[^}]+\}/)?.[0];

test('classic tournament starts locked in Spanish without a tournament selector', () => {
  assert.match(html, /let tournamentMode='clasico'/);
  assert.match(html, /pref\.clasico='es'/);
  assert.match(html, /TOURNAMENT_MODES\.splice\(0,TOURNAMENT_MODES\.length,'clasico'\)/);
});

test('classic mode runs expanded best-of-three club fixtures', () => {
  assert.match(html, /TOURNAMENT_OPTIONS=TOURNAMENT_MODES\.slice\(\)/);
  assert.match(html, /TOURNAMENT_MODES=\['libre','clasico'/);
  assert.match(html, /const CLASSICS_POOL=\{/);
  assert.match(html, /const CLASSIC_DEFS=\[/);
  assert.match(html, /\['ol','cp','SUPERCLÁSICO PARAGUAYO'\],\['ucl-bc','ucl-rm','EL CLÁSICO'\]/);
  assert.match(html, /const CLASSIC_FIXTURES=CLASSIC_DEFS\.map\(d=>\[d\[0\],d\[1\]\]\)/);
  assert.match(html, /const CLASSIC_WINS=2/);
  assert.match(html, /if\(mode==='clasico'\)return CLASSIC_FIXTURES\[classicFixtureIndex\]\.slice\(\)/);
  assert.match(html, /bracketFrom\(mode==='clasico'\?ids:ids\.slice\(\)\.sort/);
  assert.match(html, /if\(tournamentMode==='clasico'\)classicFixtureIndex=\(classicFixtureIndex\+1\)%CLASSIC_FIXTURES\.length/);
  assert.match(html, /PARTIDO '\+Math\.min\(3,\(P\.wins\[0\]\|\|0\)\+\(P\.wins\[1\]\|\|0\)\+1\)\+' DE 3/);
  assert.match(html, /P\.cl\[ck\]/);
  assert.match(html, /if\(k==='ol'\)return `<rect[^`]+fill="#fff"[^`]+fill="#111"/);
  assert.match(html, /cp:\['#0b3d91','#c8102e'\]/);
});

test('overlay toolbar includes user status, reload, tap limit, and backend controls', () => {
  const toolbar = html.match(/<div class="foot">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.ok(toolbar, 'toolbar should exist');
  assert.match(toolbar, /id="connection"/);
  const buttonIds = [...toolbar.matchAll(/<button\b[^>]*id="([^"]+)"/g)]
    .map(([, id]) => id);
  assert.deepEqual(buttonIds, ['bTurboDn', 'bTurboUp', 'bRefresh', 'bBackend']);
  assert.match(toolbar, /id="bBackend"[^>]*aria-label="Abrir herramientas del backend"/);
  assert.match(html, /\$\('#bBackend'\)\.onclick=\(\)=>\{location\.href='\/backend'\}/);
  assert.doesNotMatch(toolbar, /class="version"|id="turboLim"|id="deploySignature"/);
  assert.match(html, /w\.id='cronoRegalos'/);
  assert.match(html, /tx\.id='cronoTxt'/);
  assert.match(html, /#cronoRegalos #giftTotal\{[^}]*color:#ffe14d/);
  assert.doesNotMatch(html, /#cronoRegalos #giftTotal:before|ic\.textContent='⏱'/);
  assert.doesNotMatch(html, /id=['"](?:bTournament|bTorneoSel|bBanderas|bCta|rosaToggle)['"]/);
});

test('connection indicator shows the actual TikTok account and its connection state', () => {
  const classes = new Set();
  const attributes = {};
  const element = {
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
  };
  const context = { $: () => element };

  vm.runInNewContext(`${connectionFunction}; setConnection({
    connected: false, username: '@tortulive', status: 'connecting',
  });`, context);
  assert.equal(element.textContent, '@tortulive');
  assert.equal(element.title, 'conectando a @tortulive');
  assert.equal(attributes['aria-label'], 'conectando a @tortulive');
  assert.equal(classes.has('connecting'), true);

  vm.runInNewContext(`setConnection({
    connected: true, username: 'tortulive', status: 'connected',
  });`, context);
  assert.equal(element.textContent, '@tortulive');
  assert.equal(element.title, 'conectado a @tortulive');
  assert.equal(classes.has('connected'), true);
});

test('empty free-tournament lanes do not show waiting-team labels', () => {
  assert.doesNotMatch(html, /ESPERANDO EQUIPO|esperando equipo/);
  assert.match(html, /function libreDuel\(\)/);
  assert.match(html, /const g=gs\[Math\.floor\(Math\.random\(\)\*gs\.length\)\]/);
  assert.match(html, /Nunca queda un carril vacio/);
});

test('inactivity victories advance without awarding a cup', () => {
  assert.match(html, /if\(fin&&!lowActivityFinished\)\{P\.cp\[id\]/);
  assert.match(html, /Gana por inactividad · sin copa/);
});

test('race divider and versus badge stay beneath the winner popup', () => {
  assert.match(html, /\.win\{[^}]*z-index:5/);
  assert.match(html, /#lanes\{gap:22px!important/);
  assert.match(html, /la viga central y el cartel VS ya NO flotan encima/);
});

test('statistics bar exposes LIVE counters and the separate gift total', () => {
  const start = html.indexOf('<div class="evs" id="evs"');
  const end = html.indexOf('<div id="toast"', start);
  const bar = start < 0 || end < 0 ? '' : html.slice(start, end);
  for (const type of ['member', 'chat', 'like', 'follow', 'share']) {
    assert.match(bar, new RegExp(`data-k="${type}"`), `${type} counter is missing`);
  }
  assert.match(bar, /id="giftTotal"[^>]*>0<\/div>/);
  assert.match(html, /idleStat\.dataset\.k='idle'/);
  assert.match(html, /limStat\.dataset\.k='lim'/);
  assert.match(html, /id="idleCountdown"/);
  assert.match(html, /id="tapLimit"/);
});

test('team tap counters omit the turbo badge and use the freed width for the count', () => {
  assert.doesNotMatch(html, /<s class="gl"[^>]*>TURBO<\/s>/);
  assert.doesNotMatch(html, /querySelector\('\.gl'\)/);
  assert.match(html, /\.hb em\{justify-content:flex-start;left:20px;right:2px/);
});

test('each positive LIVE tap update kicks the turtle legs', () => {
  assert.match(html, /\.tap-step \.lg\{animation:tapStep var\(--tap-step-duration,\.3s\) ease-out\}/);
  assert.match(html, /function tapStep\(i,count\)/);
  assert.match(html, /if\(n>0\)tapStep\(t,n\)/);
  assert.ok(tapStepDurationFunction, 'tap speed should be calculated from the received tap count');
  const tapStepDuration = vm.runInNewContext(`${tapStepDurationFunction}; tapStepDuration`);
  assert.equal(tapStepDuration(1), 0.3);
  assert.ok(tapStepDuration(5) < tapStepDuration(1));
  assert.ok(tapStepDuration(10) < tapStepDuration(5));
  assert.equal(tapStepDuration(100), 0.07);
});

test('overlay messages do not solicit viewer actions', () => {
  assert.match(html, /REGLA PERMANENTE: ningun cuadro emergente, aviso, banner ni voz en off pide acciones a los espectadores/);
  assert.doesNotMatch(html, /cta-turnos|CTA v3: los 3 botones/);
  assert.doesNotMatch(html, /b\.textContent='¿Seguro\? Toca de nuevo'/);
  assert.match(html, /b\.textContent='Confirmación pendiente'/);
});

test('turbo tap limit starts at 50 and rises with race progress, not audience', () => {
  assert.match(html, /const HEART_START=50,HEART_STEP=10/);
  assert.match(html, /const heartBase=\(\)=>\{let mx=0;try\{mx=Math\.max\(0,\.\.\.S\.map\(s=>\+s\.p\|\|0\)\)/);
  assert.match(html, /const n=Math\.max\(10,Math\.min\(Number\.MAX_SAFE_INTEGER,heartBase\(\)\+heartLimitOffset\)\)/);
  assert.match(html, /TAP_POLICY\.consumeTapCount\(heart\[t\],n,HEART_N\)/);
  assert.match(html, /if\(!over\)syncHeartLimit\(\)/);
  assert.doesNotMatch(html, /audienceMultiplier|nextAudienceTapLimit|LEVEL_PROGRESS_START|LEVEL_MAX_TAPS/);
});

test('each team shows its live-wide event total in compact K and M notation', () => {
  assert.match(html, /class="team-total" id="teamTotal\$\{i\}"/);
  assert.match(html, /const teamEventTotals=new Map\(\)/);
  assert.match(html, /window\.addTeamEventTotal\(team,TAP_POLICY\.statEventDelta\(type,count\)\)/);
  assert.match(html, /teamEventTotals\.set\(teamId,\(teamEventTotals\.get\(teamId\)\|\|0\)\+count\)/);
  assert.match(html, /teamEventTotals\.get\(T\[team\]\.id\)\|\|0/);
  assert.match(html, /update\(\);T\.forEach\(\(_,i\)=>window\.renderTeamEventTotal\(i\)\)/);
  assert.match(html, /window\.addTeamEventTotal=addTeamEventTotal;\s*window\.renderTeamEventTotal=renderTeamEventTotal;/);
  assert.match(html, /row\.querySelector\('b'\)\.textContent=stFmt\(total\)/);
});

test('team names appear below each header flag and refresh when the duel changes', () => {
  assert.match(html, /\.cnTop\{display:block;position:relative/);
  assert.match(html, /let el=hd\.querySelector\('\.cnTop'\);if\(!el\).*?hd\.appendChild\(el\)/);
  assert.match(html, /const n=I18N\.tr\(String\(T\[i\]\.n\|\|''\)\.toUpperCase\(\)\)/);
  assert.match(html, /if\(el\.textContent!==n\)\{el\.textContent=n;cambio=true\}/);
  assert.match(html, /\.hd \.cn\{display:none!important\}/);
});

test('v30 gift layer reacts to gifts and supplies honor, turbo, and voice hooks', () => {
  assert.match(html, /<style id="gami22">/);
  assert.match(html, /function registerGift\(e\)/);
  assert.match(html, /function voice\(g\)/);
  assert.match(html, /window\.gami=\{level:LV,honor:HM,voice,/);
  assert.match(html, /window\.__gamiTurbo=\{turbo:turbo,giftTurboUntil:giftTurboUntil\}/);
  assert.match(html, /window\.gami&&window\.gami\.voice&&window\.gami\.voice\(g\)/);
});

test('activity policy fallback repairs a cached frozen policy missing team assignment', () => {
  const fallback = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map(([, source]) => source)
    .find((source) => source.includes('si /activity-policy.js no carga'));
  assert.ok(fallback, 'activity policy fallback script should exist');
  const window = {
    TORTUWORLD_ACTIVITY_POLICY: Object.freeze({
      resolveSupportSide: () => 1,
      statEventDelta: () => 1,
    }),
  };
  vm.runInNewContext(fallback, { window });
  assert.equal(window.TORTUWORLD_ACTIVITY_POLICY.resolveSupportSide('a', 2), 1);
  assert.equal(window.TORTUWORLD_ACTIVITY_POLICY.statEventDelta('chat'), 1);
  assert.equal(window.TORTUWORLD_ACTIVITY_POLICY.nextTapLimit(100), 110);
  const consumed = window.TORTUWORLD_ACTIVITY_POLICY.consumeTapCountWithNextLimit(0, 330, 100);
  assert.equal(consumed.remaining, 0);
  assert.equal(consumed.activations, 3);
  assert.equal(consumed.nextLimit, 130);
});

test('voiceover announces progress without asking for gifts or interactions', () => {
  const start = html.indexOf('/* ===== VOZ EN OFF:');
  const end = html.indexOf('/* ALIENTO:', start);
  const voiceover = start < 0 || end < 0 ? '' : html.slice(start, end);
  assert.ok(voiceover, 'voiceover block should exist');
  assert.match(voiceover, /El equipo '\+name\+' llegó al '\+percent\+'% de avance\./);
  assert.doesNotMatch(voiceover, /env[ií]a(?:n)? rositas|env[ií]a(?:n)? regalos|comenta en el chat|deja un like/);
  assert.doesNotMatch(html, /GIFT_TURBO_REMINDER_MS|giftTurboReminderAt/);
});

test('voice announces each team at 15% race milestones without prompting chat', () => {
  assert.match(html, /PROGRESS_MILESTONES=\[15,30,45,60,75,90\]/);
  assert.match(html, /const key='progress-'\+team\+'-'\+percent/);
  assert.match(html, /El equipo '\+name\+' llegó al '\+percent\+'% de avance\./);
  assert.doesNotMatch(html, /Comenta en el chat el club que apoyas/);
});

test('voiceover blocks demonio wherever it appears in the spoken text', () => {
  assert.ok(voiceFilter, 'voice filter should exist');
  const isBlocked = vm.runInNewContext(`${voiceFilter}; voiceHasBlockedWord`);
  for (const text of [
    'Demonio al comienzo',
    'Texto demonio en el medio',
    'Texto al final: DEMONIO',
  ]) {
    assert.equal(isBlocked(text), true);
  }
  assert.match(html, /if\(voiceHasBlockedWord\(text\)\)return false/);
  assert.match(html, /window\.TORTUWORLD_VOICE_FILTER\(txt\)/);
});

test('live gift goal bar celebrates every crossed real-gift milestone', () => {
  assert.match(html, /const LAD=\[\[3,'✨ Lluvia de estrellas'/);
  assert.match(html, /if\(e&&!e\.bot&&e\.type==='gift'\)/);
  assert.match(html, /previous<milestone\[0\]&&gifts>=milestone\[0\]/);
  assert.match(html, /milestone<=gifts;milestone\+=100/);
  assert.match(html, /#giftTotal\.sin\{display:none!important\}/);
});

test('team changes are announced before chat and per-round announcement state is cleared', () => {
  assert.match(html, /function enqueueTeamMove\(display,team,prev\)/);
  assert.match(html, /if\(prev!==team\)\{moved=true;teamAnnounceAt\.set\(user,now\);try\{enqueueTeamMove/);
  assert.match(html, /speak\(it\.say\|\|\(it\.name\+' dice: '\+it\.text\)/);
  assert.match(html, /function voReset\(\)\{chatSide\.clear\(\);teamAnnounceAt\.clear\(\)/);
});

test('overlay no longer exposes the rose prompt toggle', () => {
  assert.doesNotMatch(html, /rosaToggle|askRoseOn/);
});

test('perfume gifts finish the race and honor appears above the trophy table', () => {
  assert.match(html, /money\\s\*gun\|pistola\\s\*\(de\\s\*\)\?\(dinero\|dinheiro\)\|pistolet\\s\*a\\s\*argent\|geldpistole\|spara\[\\s-\]\?soldi\|perfume\|parfum\|profumo/);
  assert.match(html, /\.side>#honor\{order:-1\}[\s\S]*\.side>#copas\{order:1\}/);
});

test('race reset releases round-only caches and voice queues', () => {
  assert.match(html, /picks\.clear\(\);lastChat\.clear\(\);recentChatPicks\.clear\(\);clearRoundCaches\(\)/);
  assert.match(html, /function voReset\(\)\{[^}]*chatReadAt\.clear\(\);giftQueue\.length=0;voiceQueue\.length=0;activeVoiceRequest=null;giftSpeaking=false;giftSpeechGeneration\+\+/);
  assert.match(html, /registerRoundCleanup\(\(\)=>\{visto\.clear\(\);pts\.clear\(\);box\.replaceChildren\(\)\}\)/);
  assert.match(html, /registerRoundCleanup\(\(\)=>\{info\.clear\(\);last=null\}\)/);
  assert.match(html, /reset=function\(\)\{ultimo\.clear\(\);return _reset\.apply\(this,arguments\)\}/);
});

test('mobile overlay bounds canvas effects without resource or level indicators', () => {
  assert.match(html, /const LOW_MEMORY_DEVICE=Number\(navigator\.deviceMemory\)>0&&Number\(navigator\.deviceMemory\)<=4/);
  assert.match(html, /DPR=Math\.min\(LOW_MEMORY_DEVICE\?1\.25:2/);
  assert.match(html, /MAXP=LOW_MEMORY_DEVICE\?180:420/);
  assert.match(html, /LIVE_DIAGNOSTIC_LIMIT=1000,LIVE_EVENT_ID_CACHE_LIMIT=300/);
  assert.doesNotMatch(html, /resourceMeter|CPU\*|nivelBadge/);
});

test('statistics bar updates from real events and renders the live tap and idle values', () => {
  assert.match(html, /if\(e&&!e\.bot\)\{\s*const n=TAP_POLICY\.statEventDelta\(e\.type,e\.activityCount\)/);
  assert.match(html, /TAP_POLICY\.isInteractionEvent\(e\.type\)/);
  assert.match(html, /stFmt\(HEART_N\)/);
  assert.match(html, /const lim=idleLimitMs\(\),seconds=Math\.max/);
  assert.match(html, /ST\[e\.type\]\+=n/);
});

test('real tap, turbo, and gift calculations run through the browser activity policy', () => {
  assert.match(html, /const tapCount=TAP_POLICY\.tapEventDelta\(type,count\)/);
  assert.match(html, /window\.recordLiveTap\(team,tapCount\)/);
  assert.match(html, /window\.recordLiveTap=\(team,count\)=>heartAdd\(team,count\)/);
  assert.doesNotMatch(html, /const taps=TAP_POLICY\.tapEventDelta\(type,n\)/);
  assert.match(html, /TAP_POLICY\.consumeTapCount\(heart\[t\],n,HEART_N\)/);
  assert.match(html, /TAP_POLICY\.giftProgress\(gifts,GIFT_PROGRESS\)/);
  assert.match(html, /TAP_POLICY\.giftTurboDuration\(count,GIFT_TURBO_MS\)/);
  assert.match(html, /LS\.set\(ST_KEY,rest\)/);
});

test('gift, chat, and other voiceovers are queued in priority order', () => {
  assert.match(html, /const VOICE_PRIORITY=\{gift:0,chat:1,other:2\}/);
  assert.match(html, /if\(priority===VOICE_PRIORITY\.gift\)preemptLowerPriorityVoice\(priority\)/);
  assert.match(html, /if\(request\.priority>0&&giftQueue\.length\)return/);
  assert.match(html, /if\(request\.priority>1&&chatQueue\.length\)return/);
});

test('featured gift member is displayed without the crown icon', () => {
  assert.doesNotMatch(html, /<span class="cr">👑<\/span>/);
});

test('fan avatars and their live events use the same left or right side', () => {
  assert.match(html, /function supportTeamFor\(key\)/);
  assert.match(html, /TAP_POLICY\.resolveSupportSide\(key,T\.length,picks\.get\(key\),fanSides\.get\(key\)\)/);
  assert.match(html, /window\.resolveSupportTeamFor=supportTeamFor/);
  assert.match(html, /team=user\?window\.resolveSupportTeamFor\(key\):sel/);
  assert.match(html, /recentTeam>=0\?recentTeam:\(user\?window\.resolveSupportTeamFor\(key\):-1\)/);
  assert.doesNotMatch(html, /picks\.set\(key,team\);fanSides\.set\(key,team\)/);
});

test('large bottom-right gift count mirrors the real gift statistic without an icon', () => {
  assert.match(html, /id="giftTotal"[^>]*>0<\/div>/);
  assert.match(html, /#giftTotal\{[^}]*right:10px;bottom:5px[^}]*color:#ff3b30[^}]*font:900 38px/);
  assert.match(html, /giftTotal\.textContent=stFmt\(ST\.gift\)/);
  assert.match(html, /giftTotal\.setAttribute\('aria-label','Regalos recibidos: '\+ST\.gift\)/);
});
