// Función de Netlify: POST /api/form  { "url": "https://forms.gle/..." }
import { handleFormRequest } from '../../lib/forms.mjs';

export default async (req) => {
  if (req.method !== 'POST') return Response.json({ ok: false, error: 'Método no permitido' }, { status: 405 });
  let body = {};
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: 'JSON no válido' }, { status: 400 }); }
  const out = await handleFormRequest(body.url);
  return Response.json(out.body, { status: out.status, headers: { 'Cache-Control': 'no-store' } });
};

export const config = { path: '/api/form' };
