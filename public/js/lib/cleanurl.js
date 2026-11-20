// ZeroWichtel – Tracking-Parameter aus Wunschlinks entfernen.
// Shops hängen an geteilte Links oft Kennungen an (Kampagne, Klick-ID, Partnerprogramm, wer geteilt hat).
// Die beschenkte Person soll nicht verraten, woher sie den Link hat, und der Wichtel nicht beim Öffnen
// zurückverfolgt werden. Entfernt wird nur, was sicher nichts mit dem Produkt zu tun hat.

const EXACT = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id',
  'igsh', 'igshid', 'si', 'mibextid', 'srsltid', 'epik', 'scid', 'rdt_cid', 'wickedid', 'irclickid', 'oly_anon_id', 'oly_enc_id',
  '_ga', '_gl', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking', 'mkt_tok', 'vero_id', 'vero_conv',
  'ref', 'ref_', 'referrer', 'ref_src', 'ref_url', 'share_id', 'shared', 'sharesource', 'from_share', 'trk', 'trkcampaign',
  // Amazon
  'tag', 'linkcode', 'linkid', 'ascsubtag', 'creative', 'creativeasin', 'camp', 'pd_rd_i', 'pd_rd_r', 'pd_rd_w', 'pd_rd_wg',
  'pf_rd_i', 'pf_rd_m', 'pf_rd_p', 'pf_rd_r', 'pf_rd_s', 'pf_rd_t', 'psc', 'smid', 'spla', 'sprefix', 'crid', 'qid', 'sr', 'content-id', 'dib', 'dib_tag', 'th',
  // eBay
  'mkevt', 'mkcid', 'mkrid', 'campid', 'customid', 'toolid', 'amdata', 'hash', 'var',
  // AliExpress, Etsy u. a.
  'spm', 'scm', 'algo_pvid', 'algo_exp_id', 'aff_fcid', 'aff_fsk', 'aff_platform', 'aff_trace_key', 'sk', 'terminal_id', 'ga_order', 'ga_search_query', 'ga_search_type', 'ga_view_type',
  'click_key', 'click_sum', 'organic_search_click', 'ls', 'sts', 'pro', 'frs',
]);
const PREFIX = ['utm_', 'adjust_', 'mc_', 'pk_', 'mtm_', 'matomo_', 'hmb_', 'ga_', 'oly_', '_bta_', 'awc', 'trk_', 'itm_', 'cmpid', 'ws_ab_test', '_trk'];
// Nur bei diesen Shops gelten auch allgemein klingende Namen als Tracking (sonst könnten sie zum Produkt gehören).
const SHOP_ONLY = new Set(['th', 'psc', 'sr', 'qid', 'crid', 'sprefix', 'smid', 'spla', 'hash', 'var', 'sk', 'ls', 'sts', 'pro', 'frs', 'tag', 'camp', 'creative', 'dib', 'dib_tag', 'content-id']);
const SHOPS = /(^|\.)(amazon\.[a-z.]+|amzn\.[a-z]+|ebay\.[a-z.]+|aliexpress\.[a-z.]+|etsy\.com)$/i;

function isTracking(name, shop) {
  const n = name.toLowerCase();
  if (SHOP_ONLY.has(n)) return shop;
  return EXACT.has(n) || PREFIX.some((p) => n.startsWith(p));
}

/**
 * Bereinigt einen https-Link. Gibt { url, removed } zurück (removed = Anzahl entfernter Angaben).
 * Ungültige oder fremde Schemata bleiben unverändert.
 */
export function cleanUrl(input) {
  let u;
  try { u = new URL(input); } catch { return { url: input, removed: 0 }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { url: input, removed: 0 };
  const shop = SHOPS.test(u.hostname);
  let removed = 0;
  for (const name of [...u.searchParams.keys()]) {
    if (isTracking(name, shop)) {
      removed += u.searchParams.getAll(name).length;
      u.searchParams.delete(name);
    }
  }
  if (shop) {
    // Amazon: /dp/ASIN/ref=sr_1_3 – alles ab „ref=“ im Pfad ist Herkunftsangabe
    const p = u.pathname.replace(/\/ref=[^/]*$/i, '');
    if (p !== u.pathname) { u.pathname = p; removed++; }
  }
  // Fragmente mit Tracking (#utm_…, #:~:text= bleibt)
  if (/^#(utm_|_gl=|xtor=)/i.test(u.hash)) { u.hash = ''; removed++; }
  if (!removed) return { url: input, removed: 0 };
  let out = u.href;
  if (!u.search && out.includes('?')) out = out.replace('?', '');
  return { url: out, removed };
}

/** Bereinigt alle https-Links in einem Text (z. B. Markdown eines Wunsches). */
export function cleanTextUrls(text) {
  let removed = 0;
  const out = String(text ?? '').replace(/https?:\/\/[^\s<>()"'\]]+/g, (m) => {
    // Satzzeichen am Ende gehören nicht zum Link
    const tail = /[.,;:!?]+$/.exec(m)?.[0] ?? '';
    const core = tail ? m.slice(0, -tail.length) : m;
    const r = cleanUrl(core);
    removed += r.removed;
    return r.url + tail;
  });
  return { text: out, removed };
}
