// ZeroWichtel – API-Client. Geheimnisse gehen nie in die URL, nur in den Header X-ZW-Auth.
// Fehlermeldungen des Servers sind deutsch; im Englischen übersetzt sie das Wörterbuch (sonst bleiben sie deutsch).

import { t } from './i18n.js';

let API_BASE = '/api';
let ORIGIN_BASE = null;

/** Für Tests und Sonderfälle: API- und Link-Basis setzen. */
export function configure({ apiBase, linkBase } = {}) {
  if (apiBase) API_BASE = apiBase.replace(/\/$/, '');
  if (linkBase) ORIGIN_BASE = linkBase.replace(/\/$/, '');
}

/** Basis für erzeugte Links, z. B. https://wichteln.example.org */
export function linkBase() {
  if (ORIGIN_BASE) return ORIGIN_BASE;
  const { origin, pathname } = globalThis.location;
  return (origin + pathname.replace(/index\.html$/, '')).replace(/\/$/, '');
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || t('Unbekannter Fehler'));
    this.status = status;
    this.code = code;
  }
}

export async function api(method, path, { body, auth } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) headers['X-ZW-Auth'] = auth;
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new ApiError(0, 'network', t('Keine Verbindung zum Server. Bitte Internetverbindung prüfen.'));
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) throw new ApiError(res.status, 'http', t('Serverfehler ({status}).', { status: res.status }));
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'http', data?.message ? t(data.message) : t('Fehler {status}', { status: res.status }));
  return data;
}
