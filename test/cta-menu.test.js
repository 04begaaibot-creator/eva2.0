const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'overlay.html'), 'utf8');

test('gift CTA menu, team banners, and gift buttons are hidden', () => {
  assert.match(html, /#panCta,#regalos,\.ctaBox,\.rosita-cta,\.pistola-cta,#honor,#gmGift,#gmNtf,#metaLive\{display:none!important\}/);
  assert.doesNotMatch(html, /isMoneyGunGift|function alarma\(|CAPI=|PERF=/);
});
