// ZeroWichtel – Einstieg und Router. Alle Routen leben im URL-Fragment.

import { parseFragment } from './lib/links.js';
import { clearAlerts } from './lib/dom.js';
import { markNavigation } from './views/common.js';
import { renderHome } from './views/home.js';
import { renderCreate } from './views/create.js';
import { renderAdmin } from './views/admin.js';
import { renderInvite } from './views/invite.js';
import { renderPerson } from './views/person.js';
import { renderRecover } from './views/recover.js';
import { renderInfo } from './views/info.js';
import { renderDiceOnly } from './views/game.js';
import { renderBackend } from './views/backend.js';
import { renderJump } from './views/jump.js';
import { renderJoin } from './views/join.js';
import { renderDemo } from './views/demo.js';
import { renderAnalogRound } from './views/analog.js';
import { initMusic } from './lib/music.js';
import { initCryptoInfo } from './views/crypto-info.js';
import { initFooterDonation, initFooterSource } from './lib/donation.js';
import { stopSnow } from './lib/snow.js';
import { t, lang, setLang, applyStatic } from './lib/i18n.js';

const root = document.getElementById('app');

async function route() {
  markNavigation();
  clearAlerts();
  stopSnow();
  const hash = location.hash;
  const link = parseFragment(hash);
  try {
    if (link?.kind === 'a') return await renderAdmin(root, link);
    if (link?.kind === 'i') {
      return await renderInvite(root, link, { onClaimed: (pctx) => renderPerson(root, pctx) });
    }
    if (link?.kind === 'p') return await renderPerson(root, link);
    if (link?.kind === 'j') return await renderJoin(root, link, { onJoined: (pctx) => renderPerson(root, pctx) });

    const [name, arg] = hash.replace(/^#/, '').split('/');
    switch (name) {
      case 'neu': return await renderCreate(root, decodeURIComponent(arg || ''));
      case 'backend': return await renderBackend(root, arg || '');
      case 'zu': return renderJump(root, arg || '');
      case 'wiederherstellen': return renderRecover(root, arg || '');
      case 'wuerfel': return renderDiceOnly(root);
      case 'demo': return renderDemo(root);
      case 'analog': return renderAnalogRound(root);
      case 'datenschutz':
      case 'impressum':
      case 'hilfe':
      case 'barrierefreiheit':
      case 'lizenzen': return renderInfo(root, name);
      default: return renderHome(root);
    }
  } catch (e) {
    console.error(e);
    root.textContent = t('Es ist ein Fehler aufgetreten. Bitte Seite neu laden.');
  }
}

window.addEventListener('hashchange', route);
applyStatic();
initMusic();
initCryptoInfo();
initFooterDonation();
initFooterSource();

// B5: Sprunglink – ohne den Hash zu ändern (die Adresse ist hier der Router)
document.getElementById('skip-link')?.addEventListener('click', (ev) => {
  ev.preventDefault();
  const target = root.querySelector('h1') || root;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus();
});
// Sprache umschalten: Seite neu zeichnen (ohne Neuladen – die Musik läuft weiter)
document.getElementById('lang-toggle')?.addEventListener('click', () => {
  setLang(lang() === 'en' ? 'de' : 'en');
  document.dispatchEvent(new CustomEvent('zw:lang'));
  route();
});
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
}
