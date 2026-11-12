// Lectura de formularios públicos de Google Forms y Microsoft Forms.
// Sin dependencias: usa fetch nativo de Node 18+.
// Devuelve una estructura normalizada de preguntas o, si no puede interpretarla,
// el texto/JSON bruto para que el navegador lo analice con IA.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const ALLOWED_HOSTS = [
  /^docs\.google\.com$/i,
  /^forms\.gle$/i,
  /^(www\.)?forms\.office\.com$/i,
  /^(www\.)?forms\.microsoft\.com$/i,
  /^(www\.)?forms\.cloud\.microsoft$/i,
  /^[a-z0-9-]+\.forms\.office\.com$/i
];
const LOGIN_HOSTS = [/^accounts\.google\.com$/i, /^login\.microsoftonline\.com$/i, /^login\.live\.com$/i];
const MAX_BYTES = 5 * 1024 * 1024;

export class FormError extends Error {
  constructor(message, extra = {}) { super(message); Object.assign(this, extra); }
}

const isAllowed = h => ALLOWED_HOSTS.some(r => r.test(h));

export function classify(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl).trim()); } catch { return null; }
  const h = u.hostname;
  if (/^docs\.google\.com$/i.test(h) && /\/forms\//.test(u.pathname)) return 'google';
  if (/^forms\.gle$/i.test(h)) return 'google';
  if (/forms\.office\.com$|forms\.microsoft\.com$|forms\.cloud\.microsoft$/i.test(h)) return 'microsoft';
  return null;
}

// fetch con redirecciones manuales limitadas a dominios de formularios (evita SSRF)
async function safeFetch(url, headers = {}, hops = 0) {
  const u = new URL(url);
  if (LOGIN_HOSTS.some(r => r.test(u.hostname))) {
    throw new FormError('El formulario exige iniciar sesión (solo para miembros de una organización). Descárgalo como PDF y súbelo en la pestaña PDF.', { status: 403 });
  }
  if (u.protocol !== 'https:' || !isAllowed(u.hostname)) {
    throw new FormError('Solo se admiten enlaces de Google Forms o Microsoft Forms.', { status: 400 });
  }
  const res = await fetch(u.href, {
    redirect: 'manual',
    headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8', ...headers },
    signal: AbortSignal.timeout(8000)
  });
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get('location');
    if (!loc || hops >= 6) throw new FormError('Demasiadas redirecciones al abrir el enlace.', { status: 502 });
    return safeFetch(new URL(loc, u).href, headers, hops + 1);
  }
  return { res, finalUrl: u.href };
}

async function readText(res) {
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) throw new FormError('La página del formulario es demasiado grande.', { status: 413 });
  return new TextDecoder('utf-8').decode(buf);
}

export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/* ======================= Google Forms ======================= */

function normalizeGoogleUrl(raw) {
  const u = new URL(raw);
  if (/^docs\.google\.com$/i.test(u.hostname)) {
    const m = u.pathname.match(/\/forms\/(?:u\/\d+\/)?d\/(e\/)?([A-Za-z0-9_-]+)/);
    if (m) return `https://docs.google.com/forms/d/${m[1] ? 'e/' : ''}${m[2]}/viewform`;
  }
  return u.href;
}

// Extrae el array FB_PUBLIC_LOAD_DATA_ respetando cadenas y corchetes anidados
export function extractFbData(html) {
  const at = html.indexOf('FB_PUBLIC_LOAD_DATA_');
  if (at < 0) return null;
  const start = html.indexOf('[', at);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

const G_TYPES = { 0: 'short', 1: 'paragraph', 2: 'single', 3: 'dropdown', 4: 'multiple', 5: 'scale', 7: 'grid', 9: 'date', 10: 'time', 13: 'file', 18: 'rating' };

export function parseGoogleData(data) {
  const info = Array.isArray(data?.[1]) ? data[1] : [];
  const items = Array.isArray(info[1]) ? info[1] : [];
  const title = (typeof info[8] === 'string' && info[8]) || (typeof data[3] === 'string' && data[3]) || 'Formulario de Google';
  const description = typeof info[0] === 'string' ? info[0] : '';
  const questions = [];
  let section = '';
  for (const it of items) {
    if (!Array.isArray(it)) continue;
    const code = it[3];
    const qTitle = typeof it[1] === 'string' ? it[1].trim() : '';
    const qDesc = typeof it[2] === 'string' ? it[2].trim() : '';
    if (code === 8) { section = qTitle; continue; }
    let type = G_TYPES[code];
    if (!type) continue; // títulos, imágenes, vídeos…
    const entries = Array.isArray(it[4]) ? it[4] : [];
    const q = { title: qTitle || '(sin título)', description: qDesc, type, options: [], other: false, required: false, section };
    if (type === 'grid') {
      q.rows = entries.map(e => (Array.isArray(e?.[3]) ? e[3][0] : '') || '').map(String);
      q.columns = (Array.isArray(entries[0]?.[1]) ? entries[0][1] : []).map(o => String(o?.[0] ?? '')).filter(Boolean);
      const isCheck = Array.isArray(entries[0]?.[11]) && entries[0][11][0] === 1;
      q.type = isCheck ? 'grid_multiple' : 'grid_single';
      q.required = entries.some(e => e?.[2] === 1);
    } else {
      const e = entries[0] || [];
      const opts = Array.isArray(e[1]) ? e[1] : [];
      q.options = opts.filter(o => Array.isArray(o) && o[0] !== '' && o[4] !== 1).map(o => String(o[0]));
      q.other = opts.some(o => Array.isArray(o) && o[4] === 1);
      q.required = e[2] === 1;
      if (type === 'scale' || type === 'rating') {
        const nums = q.options.map(Number).filter(Number.isFinite);
        const labels = Array.isArray(e[3]) ? e[3] : [];
        q.scale = {
          min: nums.length ? Math.min(...nums) : 1,
          max: nums.length ? Math.max(...nums) : (type === 'rating' ? 5 : 5),
          minLabel: typeof labels[0] === 'string' ? labels[0] : '',
          maxLabel: typeof labels[1] === 'string' ? labels[1] : ''
        };
        q.options = [];
      }
    }
    questions.push(q);
  }
  return { title, description, questions };
}

async function getGoogle(url) {
  const { res, finalUrl } = await safeFetch(normalizeGoogleUrl(url));
  if (res.status === 404) throw new FormError('No se encuentra el formulario. ¿El enlace es correcto y el formulario está publicado?', { status: 404 });
  if (!res.ok) throw new FormError(`Google respondió con un error (${res.status}).`, { status: 502 });
  const html = await readText(res);
  const data = extractFbData(html);
  if (data) {
    const form = parseGoogleData(data);
    if (form.questions.length) return { ok: true, form: { ...form, source: 'google', url: finalUrl } };
  }
  if (/ServiceLogin|accounts\.google\.com\/v3\/signin/i.test(html)) {
    throw new FormError('El formulario exige iniciar sesión con una cuenta de la organización. Descárgalo como PDF y súbelo en la pestaña PDF.', { status: 403 });
  }
  return { ok: false, error: 'No se pudo interpretar automáticamente la estructura; se analizará el texto con IA.', rawText: htmlToText(html).slice(0, 40000), source: 'google' };
}

/* ===================== Microsoft Forms ====================== */

const stripHtml = s => htmlToText(String(s || '')).replace(/\s+/g, ' ').trim();
const parseInfo = qi => {
  if (!qi) return {};
  if (typeof qi === 'object') return qi;
  try { return JSON.parse(qi); } catch { return {}; }
};
const choiceText = c => stripHtml(c?.Description ?? c?.FormsProDisplayRTText ?? c?.description ?? c?.Text ?? c);

function findQuestionsArray(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  if (Array.isArray(node.questions) && node.questions.some(q => q && (q.title !== undefined || q.questionInfo !== undefined))) return node;
  for (const k of Object.keys(node)) {
    const r = findQuestionsArray(node[k], depth + 1);
    if (r) return r;
  }
  return null;
}

export function parseMicrosoftForm(form) {
  const all = [...form.questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const questions = [];
  const byGroup = {};
  all.forEach(q => { if (q.groupId) (byGroup[q.groupId] = byGroup[q.groupId] || []).push(q); });
  for (const q of all) {
    const type = String(q.type || q['@odata.type'] || '');
    const info = parseInfo(q.questionInfo ?? q.deserializedQuestionInfo);
    const title = stripHtml(q.formsProRTQuestionTitle || q.title) || '(sin título)';
    const description = stripHtml(q.formsProRTSubtitle || q.subtitle);
    const base = { title, description, options: [], other: false, required: !!q.required, section: '' };
    if (/MatrixChoice$/i.test(type) && q.groupId) continue; // filas de una cuadrícula (se tratan en el grupo)
    if (/Choice$/i.test(type) && !/Matrix/i.test(type)) {
      const multi = info.ChoiceType === 2 || info.ChoiceType === 'Multi' || info.AllowMultipleSelections === true;
      questions.push({ ...base, type: multi ? 'multiple' : (info.ChoiceType === 3 ? 'dropdown' : 'single'),
        options: (info.Choices || []).map(choiceText).filter(Boolean), other: !!(info.AllowOtherAnswer || info.ShowOtherOption) });
    } else if (/TextField$/i.test(type)) {
      questions.push({ ...base, type: info.Multiline ? 'paragraph' : 'short' });
    } else if (/NPS$/i.test(type)) {
      questions.push({ ...base, type: 'scale', scale: { min: 0, max: 10, minLabel: stripHtml(info.LeftDescription || info.MinRatingDescription), maxLabel: stripHtml(info.RightDescription || info.MaxRatingDescription) } });
    } else if (/Rating$/i.test(type)) {
      questions.push({ ...base, type: 'rating', scale: { min: 1, max: +info.Length || 5, minLabel: stripHtml(info.MinRatingDescription || info.LeftDescription), maxLabel: stripHtml(info.MaxRatingDescription || info.RightDescription) } });
    } else if (/Date$/i.test(type)) {
      questions.push({ ...base, type: 'date' });
    } else if (/Ranking$/i.test(type)) {
      questions.push({ ...base, type: 'ranking', options: (info.Options || info.Choices || []).map(choiceText).filter(Boolean) });
    } else if (/MatrixChoiceGroup$|Likert$/i.test(type)) {
      const children = byGroup[q.id] || [];
      const rows = children.length ? children.map(c => stripHtml(c.formsProRTQuestionTitle || c.title)) : (info.Statements || []).map(choiceText);
      const cols = (info.Choices || info.Options || (children[0] && parseInfo(children[0].questionInfo).Choices) || []).map(choiceText).filter(Boolean);
      questions.push({ ...base, type: 'grid_single', rows, columns: cols, required: base.required || children.some(c => c.required) });
    } else if (/Upload|File/i.test(type)) {
      questions.push({ ...base, type: 'file' });
    } else if (Array.isArray(info.Choices) && info.Choices.length) {
      questions.push({ ...base, type: 'single', options: info.Choices.map(choiceText).filter(Boolean) });
    }
    // Secciones y separadores se ignoran
  }
  return {
    title: stripHtml(form.title || form.formsProRTTitle) || 'Formulario de Microsoft',
    description: stripHtml(form.description || form.formsProRTDescription),
    questions
  };
}

async function getMicrosoft(url) {
  let u = new URL(url);
  let id = u.searchParams.get('id') || u.searchParams.get('Id') || u.searchParams.get('ID');
  let host = u.hostname;
  if (!id) {
    const { res, finalUrl } = await safeFetch(url);
    const f = new URL(finalUrl);
    id = f.searchParams.get('id') || f.searchParams.get('Id');
    host = f.hostname;
    if (!id) {
      const html = await readText(res);
      const m = html.match(/[?&](?:id|Id)=([A-Za-z0-9_\-]{20,})/);
      if (m) id = m[1];
    }
  }
  if (!id) throw new FormError('No se encontró el identificador del formulario de Microsoft en el enlace.', { status: 400 });

  const hosts = [...new Set([host, 'forms.office.com'])];
  let lastErr = null;
  for (const h of hosts) {
    try {
      const api = `https://${h}/handlers/ResponsePageStartup.ashx?id=${encodeURIComponent(id)}&mobile=false`;
      const { res } = await safeFetch(api, { Accept: 'application/json' });
      if (!res.ok) { lastErr = new FormError(`Microsoft respondió con un error (${res.status}).`, { status: 502 }); continue; }
      const txt = await readText(res);
      let json;
      try { json = JSON.parse(txt); } catch { lastErr = new FormError('Respuesta inesperada de Microsoft Forms.', { status: 502 }); continue; }
      const form = findQuestionsArray(json);
      if (form) {
        const parsed = parseMicrosoftForm(form);
        if (parsed.questions.length) return { ok: true, form: { ...parsed, source: 'microsoft', url } };
        return { ok: false, error: 'Estructura de Microsoft no reconocida; se analizará con IA.', rawText: JSON.stringify(form).slice(0, 40000), source: 'microsoft' };
      }
      const errMsg = JSON.stringify(json).slice(0, 400);
      if (/login|auth|unauthori|restricted|organization/i.test(errMsg)) {
        throw new FormError('Este formulario de Microsoft solo admite personas de la organización. Imprímelo como PDF y súbelo en la pestaña PDF.', { status: 403 });
      }
      lastErr = new FormError('Microsoft Forms no devolvió las preguntas. Prueba con el PDF del formulario.', { status: 502 });
    } catch (e) {
      if (e instanceof FormError && e.status === 403) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new FormError('No se pudo leer el formulario de Microsoft.', { status: 502 });
}

/* ======================== Entrada única ===================== */

export async function getForm(url) {
  const kind = classify(url);
  if (!kind) throw new FormError('Pega un enlace de Google Forms (docs.google.com/forms o forms.gle) o de Microsoft Forms (forms.office.com / forms.cloud.microsoft).', { status: 400 });
  return kind === 'google' ? getGoogle(url) : getMicrosoft(url);
}

// Envoltorio común para el servidor de Render y la función de Netlify
export async function handleFormRequest(url) {
  try {
    if (!url || typeof url !== 'string' || url.length > 2000) return { status: 400, body: { ok: false, error: 'Falta el enlace del formulario.' } };
    const out = await getForm(url);
    return { status: 200, body: out };
  } catch (e) {
    const msg = e instanceof FormError ? e.message
      : (e?.name === 'TimeoutError' ? 'El servidor del formulario tardó demasiado en responder.' : 'No se pudo abrir el enlace del formulario.');
    return { status: e?.status || 502, body: { ok: false, error: msg } };
  }
}
