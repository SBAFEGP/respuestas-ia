# Respuestas simuladas con IA para formularios

Aplicación web gratuita que genera respuestas **simuladas** a un formulario de Google Forms o Microsoft Forms.
Cada respuesta la produce un «encuestado virtual» con su propio perfil, según el público objetivo que definas, y todo se descarga en un **Excel**.

Sirve para pilotar un cuestionario antes de lanzarlo, probar el análisis de datos o preparar prácticas con alumnado.
Las respuestas son sintéticas y el Excel lo indica en la hoja «Información». La aplicación **no envía nada** al formulario original.

## Qué hace

1. **Formulario**, de tres formas:
   - **Enlace** público de Google Forms (`forms.gle/…`, `docs.google.com/forms/…`) o Microsoft Forms (`forms.office.com/r/…`, `forms.cloud.microsoft/…`).
   - **PDF** del formulario (Google: ⋮ → Imprimir → Guardar como PDF; Microsoft: ··· → Imprimir formulario).
   - **Texto** pegado.
   Detecta el tipo de cada pregunta: respuesta corta o larga, opción única, desplegable, casillas, escala, valoración, cuadrícula/Likert, clasificación, fecha y hora. Puedes excluir preguntas o corregir la estructura en JSON.
2. **Público objetivo y perfiles**: descripción del público, contexto, número de respuestas y rango de edad. Añade campos de perfil como procedencia, género o nivel de estudios, con sus porcentajes (`Zaragoza: 50`); las respuestas se reparten exactamente con esas proporciones. Si dejas un campo sin valores, la IA los elige. También ajustas la diversidad de opiniones, la longitud de las respuestas abiertas y el idioma.
3. **Modelo de IA**: Google Gemini (nivel gratuito) o cualquier API compatible con OpenAI (Groq, OpenRouter…). Cada usuario pone su propia clave, que se usa **desde su navegador** y no pasa por el servidor.
4. **Generar y descargar**: lotes con reintentos automáticos si se alcanza el límite gratuito. Las respuestas se validan contra las opciones reales del formulario. El Excel tiene 4 hojas: **Respuestas** (una fila por encuestado, con el formato del export de Google Forms), **Perfiles**, **Preguntas** e **Información**.

## Clave gratuita de Gemini

1. Entra en https://aistudio.google.com/apikey con una cuenta de Google.
2. Pulsa **Create API key** y cópiala en el paso 3 de la aplicación.

Modelos con nivel gratuito (noviembre de 2026): `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite` y `gemini-3.1-flash-lite`.
Si aparecen avisos de cuota, sube la pausa entre peticiones o usa un modelo *flash-lite*.
En el nivel gratuito, Google puede usar lo que se envía para mejorar sus productos: no incluyas datos personales reales.

## Publicar gratis

La lectura de formularios **por enlace** necesita un pequeño servidor, porque los navegadores no pueden leer páginas de Google o Microsoft directamente. El proyecto incluye uno para cada plataforma y **no tiene dependencias**.

### Render (recomendado)
1. Sube esta carpeta a un repositorio de GitHub.
2. En https://dashboard.render.com → **New → Blueprint** → elige el repositorio (usa `render.yaml`).
   O bien **New → Web Service**: Runtime *Node*, Build command `echo ok`, Start command `node server.mjs`, plan *Free*.
3. El plan gratuito se «duerme» tras 15 minutos sin uso: la primera visita tarda unos 30–60 s en despertar.

### Netlify
1. Sube esta carpeta a GitHub e impórtala en https://app.netlify.com (**Add new site → Import an existing project**).
2. Netlify lee `netlify.toml`: publica `public/` y crea la función `/api/form` automáticamente.
   (Arrastrar la carpeta a Netlify Drop **no** despliega la función; en ese caso funcionan las pestañas PDF y Texto, pero no la de Enlace.)

### En tu ordenador
```bash
node server.mjs      # Node 18 o superior
# abre http://localhost:3000
```

## Uso simultáneo

Cada persona usa su propia clave y su navegador guarda sus ajustes. El servidor solo lee formularios y no guarda nada, así que muchas personas pueden usarlo a la vez.

## Limitaciones

- Formularios restringidos a una organización (que piden iniciar sesión) no se pueden leer por enlace: usa el PDF.
- La lectura por enlace depende del formato interno de Google y Microsoft, que puede cambiar. Si falla, la aplicación pasa automáticamente el contenido a la IA para analizarlo, y el PDF siempre funciona como alternativa.
- No se simulan preguntas de subida de archivos.

## Estructura

```
public/index.html          Aplicación (interfaz, IA y Excel en el navegador)
lib/forms.mjs              Lector de Google Forms y Microsoft Forms
server.mjs                 Servidor para Render / local
netlify/functions/form.mjs Función para Netlify
render.yaml, netlify.toml  Configuración de despliegue
```
