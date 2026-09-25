# AI Pictionary · realtime lab

Banco de pruebas para la activación **AI Pictionary** de AWS re:Play 2026: dibujas en el lienzo y la IA
reinterpreta el trazo *mientras dibujas*, con un render final de alta calidad al terminar la ronda.

Sirve para dos cosas a la vez:

1. **Demo de UX** — el patrón "dibujo + botones de estilo" (la referencia de Tomáš Procházka), montado sobre el
   design system de digo labs (`DrawingProvider` + `DrawingCanvas` + `DrawingToolbar`).
2. **Medición** — latencia por frame, fps, frames descartados y coste estimado por modelo, con un botón que copia
   la fila lista para la tabla de resultados de *Modelos en tiempo real - Comparativa*.

## Arrancar

**Si solo quieres probar**, abre la URL de Vercel del equipo con la contraseña del lab y salta a «Qué probar». Lo
que sigue es para correrlo en tu máquina.

Necesitas Node 20.19 o más reciente y un navegador Chromium (Chrome, Edge, Brave): el carril de Daydream lee los
frames con `MediaStreamTrackProcessor`, que Firefox y Safari no tienen.

```bash
npm install
cp .env.example .env   # pon FAL_KEY y DAYDREAM_API_KEY
npm run dev
```

La app queda en <http://localhost:5178>. **Las claves no van en el repo**: pídeselas a David por privado y
pégalas en tu `.env` (está en `.gitignore`). Las dos cuentas son compartidas, así que lo que gastes sale del saldo
del equipo: para el bucle cuando no estés dibujando (`Espacio`).

- Sin `FAL_KEY` el lienzo funciona, pero fal responde 401 y la app lo avisa con una banda ámbar.
- Sin `DAYDREAM_API_KEY` los modelos de StreamDiffusion salen bloqueados.
- Vite solo lee `.env` al arrancar: si cambias una clave, reinicia `npm run dev`.

Las claves viven solo en el servidor: el navegador habla con `/api/fal/*` y `/api/daydream/*`, y `api/lab.ts`
reenvía con la cabecera `Authorization` puesta en el servidor (el proxy de fal sigue el contrato de
`@fal-ai/server-proxy`). El mismo fichero sirve en local, montado en Vite por `vite-plugin-api.ts`, y en Vercel
como función.

## Desplegar en Vercel

El repo está listo para Vercel tal cual (preset Vite):

- `api/lab.ts` es la única función. `vercel.json` reescribe `/api/<ruta>` a `/api/lab?path=<ruta>` y le da hasta
  300 s, por los arranques en frío de fal.
- `middleware.ts` pone **una contraseña compartida delante de toda la web**: la URL gasta créditos del equipo y no
  puede quedar abierta. El navegador la pide una vez; vale cualquier usuario.
- El vídeo de Daydream y el socket de klein van del navegador al proveedor: la función solo crea streams, firma
  tokens y reenvía peticiones cortas.

Variables de entorno en Vercel (Settings → Environment Variables), **nunca en el repo**:

| Variable | Qué es |
|:--|:--|
| `FAL_KEY` | Clave de fal del equipo |
| `DAYDREAM_API_KEY` | Clave de Daydream |
| `LAB_PASSWORD` | Contraseña que se pide al abrir la web. Sin ella, la web queda abierta |

Tras cambiar una variable hay que volver a desplegar.

### Qué probar

1. **klein realtime** (el modelo por defecto): pulsa `T` para dibujar la casa de prueba o dibuja tú, y cambia de
   estilo con los botones o con `1`-`9`. Prueba con y sin palabra en «Palabra».
2. **SDXL-Turbo en Daydream**: elígelo en el selector de modelo, aplica una receta en «Ajustes» («Transformar»
   con palabra, «Scribble TD» sin palabra) y enciende el bucle. El primer frame tarda unos segundos.
3. Si algo sale raro, mira el prompt exacto en «Prompt enviado» (abajo del panel de ajustes) y guarda la medida con
   `G`: queda en «Resultados» con miniatura (solo en tu navegador).

## Qué hay dentro

### Cambiar de modelo

El selector del centro de la barra lista todos los modelos. **Los de fal cambian en caliente**: comparten proxy y
`FAL_KEY`, así que basta con elegir otro y el panel se limpia para no mezclar frames. Los de otros proveedores salen
bloqueados con lo que necesitan: su clave en `.env` y **reiniciar `npm run dev`**, porque Vite solo lee `.env` al
arrancar.

| Modelo | Endpoint | Transporte | Estado |
|:--|:--|:--|:--|
| FLUX.2 klein realtime | `fal-ai/flux-2/klein/realtime` | WebSocket | Referencia |
| FLUX.2 klein 4B / 9B edit | `fal-ai/flux-2/klein/{4b,9b}/edit` | HTTP | A probar (aísla el efecto del socket) |
| SDXL Lightning i2i | `fal-ai/fast-lightning-sdxl/image-to-image` | HTTP | A probar |
| LCM SD1.5 i2i | `fal-ai/lcm-sd15-i2i` | HTTP | A probar (motor de draw-fast) |
| SDXL ControlNet Union | `fal-ai/sdxl-controlnet-union/image-to-image` | HTTP | A probar |
| Z-Image Turbo + canny | `fal-ai/z-image/turbo/controlnet` | HTTP | Solo render final |
| Z-Image Turbo i2i | `fal-ai/z-image/turbo/image-to-image` | HTTP | Descartado (frames en negro) |
| klein 4B en Runware · en Workers AI | | WebSocket · HTTP | Bloqueados: falta conector y clave |
| Decart Lucy 2.5 realtime | `decart/lucy-2-5/realtime` | WebRTC | Bloqueado: necesita su propio carril |
| Daydream SDXL-Turbo | `stabilityai/sdxl-turbo` en Daydream | WebRTC | **Mejor en cloud: 490-620 ms, 11-23 fps** |
| Daydream SD-Turbo | `stabilityai/sd-turbo` en Daydream | WebRTC | Rápido, apenas transforma |
| Daydream DreamShaper 8 | `Lykon/dreamshaper-8` en Daydream | WebRTC | No arrancó en 3,5 min (23 sep) |

Render final («Revelar»): klein 4B edit, klein 9B edit, Nano Banana Lite, Nano Banana, Z-Image + canny.

Todo el registro vive en `src/data/models.ts`: para añadir un modelo de fal basta una entrada con su `buildInput`.

### Test estándar y «Probar todos»

`T` (o el botón) dibuja la misma casa de prueba con el modelo activo:

1. Pone el dibujo entero y espera la primera respuesta. Ese tiempo es el **arranque en frío**, y se guarda aparte.
2. Borra, redibuja la casa trazo a trazo a velocidad de puntero (~9 s) y mide solo ese tramo.
3. Guarda la medida en «Resultados» (en `localStorage`), con miniatura.

«Probar todos» repite el test con cada modelo disponible no descartado. La pestaña de resultados enseña el mejor p50
de cada modelo como barra y copia la tabla en markdown para la nota *Modelos en tiempo real - Comparativa*.

### La interfaz

- **Lado a lado** o **Superpuesto** (`O`): en superpuesto dibujas encima del render, con tu trazo como un fantasma
  de lápiz (idea de realtime-canvas).
- Cada frame nuevo entra con un fundido sobre el anterior, así 1-2 fps se leen como una transformación y no como
  cortes.
- La **cinta de latencia** de abajo deja una marca por frame: azul por debajo de 700 ms, ámbar hasta 1,4 s, rojo
  por encima. La marca discontinua es el frame que sigue en vuelo.
- «Proteger la silueta» añade al prompt el fondo liso del estilo y, en klein, la orden de seguir el trazo sin
  añadir nada. Evita que el modelo invente una escena alrededor de un garabato (idea de realtime-canvas).
- klein realtime expone sus parámetros propios: memoria del frame anterior (`output_feedback_strength`, menos
  parpadeo), `schedule_mu`, interpolación RIFE y salida a 1024 px.
- Atajos: `Espacio` bucle, `T` test, `R` revelar, `O` vista, `G` guardar medida, `1`-`9` estilos, `Esc` parar el test.

### El bucle

Cada 40 ms, si el dibujo cambió y no hay otro frame en vuelo: se serializa el SVG vivo del canvas (incluye el trazo
en curso), se rasteriza a un JPEG cuadrado al tamaño que pide el modelo y se envía. **Un solo frame en vuelo**,
siempre el último trazo. Las respuestas de un modelo o sesión anterior se descartan por generación, y un frame sin
respuesta caduca a los 15 s (240 s si el modelo aún no ha contestado nunca).

Las FPS que se muestran son reales: salen del intervalo entre respuestas mientras se dibuja, no de `1000 / latencia`.

## Estilos y prompts

Los 14 estilos viven en `src/data/presets.ts`. Un estilo **no es un prompt**, es un juego de piezas:

| Pieza | Para qué |
|:--|:--|
| `kind` | `material` (el dibujo se reconstruye como objeto: madera, cristal, fieltro…) o `medium` (se redibuja en otra técnica: cartoon, tinta, acuarela…) |
| `look` | Qué es, en prosa, para los modelos que leen instrucciones |
| `color` | Colores con nombre. Sin ellos klein devuelve objetos grises (se queda con la tinta negra) |
| `light` | Luz |
| `backdrop` | Fondo propio del estilo (Neon va sobre pared oscura, no sobre fondo claro) |
| `tags` | Etiquetas cortas para CLIP, lo importante primero |
| `negative` | Solo lo leen los modelos con CFG real (ni klein ni SDXL-Turbo con guidance 1) |

`buildPrompt` (`src/data/models.ts`) las monta según el modelo:

- **klein y Nano Banana** (`instruction`): frases. *«Rebuild this house sketch as a physical object made of glowing
  neon glass tubes… Hot pink and electric cyan light… Follow the drawn lines exactly… add nothing that is not
  drawn. Dark brick wall at night background…»*. Los `medium` usan «Redraw … as …».
- **SDXL-Turbo y demás difusión** (`description`): `house, glowing neon tubes, hot pink and electric cyan, …,
  centered, dark brick wall at night background`. La palabra va delante porque CLIP pesa más los primeros tokens y
  corta a los 77.

Reglas que salieron de la matriz (25 sep 2026):

- **Nada de sustantivos de objeto** («figurine», «sign», «plush toy», «vase»). Sin palabra, SDXL dibuja ese
  sustantivo en vez del dibujo: Plush daba un osito, Neon «sign» un poste.
- **CLIP también dibuja los sustantivos de las etiquetas**: «studio softboxes» sacaba un foco de estudio, «pigment
  blooms» flores, «blown glass» un vaso. En `look` pueden quedarse (klein los lee como descripción), en `tags` no.
- **En klein la palabra casi no cambia nada**: lee el trazo solo. Para el juego es bueno: puede ir sin palabra y no
  regala la respuesta.
- **Con palabra, SDXL «Transformar» añade lo que no dibujaste** (chimenea, más ventanas). **Sin palabra inventa** en
  algunos estilos (Wood y Stone salen paneles tallados). «Scribble TD» sigue el trazo sin palabra, pero en Chrome,
  Ink, Sticker y Studio se queda casi en líneas blancas sobre oscuro.

### Recetas de StreamDiffusion

Aparte de los estilos, «Ajustes» tiene **recetas**: no tocan el prompt, solo los parámetros del pipeline
(`STREAM_RECIPES` en `src/data/models.ts`). Estilo y receta se combinan libremente.

| Receta | Qué hace |
|:--|:--|
| Transformar | t_index [4, 12], líneas 0,6. Convierte el dibujo en objeto; con palabra, la palabra manda |
| Fiel al trazo | t_index [12, 25], líneas 0,6. Pinta encima sin cambiar la forma |
| Escena | Fiel + textura 0,5. Construye un escenario alrededor; mejor con «Proteger la silueta» apagado |
| Negro TD | Trazo blanco sobre negro, sin ControlNet, [8, 20]. Render limpio sobre fondo oscuro |
| Scribble TD | Blanco sobre negro, ControlNet passthrough 0,9, [4, 12]. Sigue el trazo sin palabra |
| Por defecto TD | Los valores del backend de Daydream en StreamDiffusionTD, para comparar |
| Neutro | Todo apagado: devuelve un calco limpio |

Cambiar el preprocesador (Scribble TD lo hace) recarga el pipeline: la salida puede quedarse en negro ~30 s. Si
no vuelve, para y enciende el bucle otra vez.

### Matriz de estilos

`scripts/prompt-matrix/` pasa todos los estilos, con y sin palabra, por el modelo activo y monta una hoja con cada
imagen y su prompt exacto. Sirve para comparar antes y después de tocar `presets.ts`:

1. `node scripts/prompt-matrix/capture-server.mjs` (puerto 5191; `SHOTS_DIR=<carpeta>` para separar tandas).
2. En el lab: elige modelo (y receta), pulsa `T` y espera a que conteste.
3. Pega `scripts/prompt-matrix/harness.js` en la consola del navegador y lanza `__matrixRun('klein', 'image')`
   (klein) o `__matrixRun('sdxl', 'video')` (Daydream, con el bucle encendido).
4. `node scripts/prompt-matrix/build-sheet.mjs <carpeta-después> [carpeta-antes] [salida.html]`.

## Carril WebRTC: Daydream (StreamDiffusion)

Necesita `DAYDREAM_API_KEY` en `.env` (app.daydream.live → API Dashboard → New API Key) y reiniciar. El lienzo se
pinta a 30 fps en un canvas oculto, sale por WHIP con `@daydreamlive/browser` y vuelve por WHEP. El servidor de Vite
solo crea el stream (`POST /api/daydream/streams`) y le cambia prompt, semilla, peso del ControlNet y
`t_index_list` en caliente (`PATCH /api/daydream/streams/:id`); el vídeo nunca pasa por él.

- **No hay respuesta por frame**, así que la latencia se mide con **«Medir latencia» (`L`)**: pone el lienzo en negro
  5 veces y cronometra cuándo se oscurece la salida. Es la latencia de extremo a extremo que siente quien dibuja.
  Las FPS salen de los frames que llegan, leídos con `MediaStreamTrackProcessor` (Chromium) para que sigan contando
  aunque la ventana no pinte.
- Con 50 pasos, un primer `t_index` de ~20 o más devuelve el boceto limpio; **con el ControlNet de líneas («Lineart
  simple» 0,6) y t_index 4-8 lo convierte en objeto**.
- El filtro NSFW de Daydream cambia cada frame marcado por negro puro y es muy agresivo: por eso sale apagado.
- **Controles de StreamDiffusion tal cual**: prompt libre (vacío = estilo + palabra), `num_inference_steps` y cada
  `t_index` con su slider y el % del dibujo que sobrevive, guidance, delta, textura de fondo (ruido de color bajo el trazo,
  el truco de TouchDesigner) y filtro NSFW. Todo sale apagado: `t_index_list` [29, 39] de 50, guidance 1, sin textura,
  NSFW apagado y ningún ControlNet. Por qué, en la nota del vault «StreamDiffusion - Como funciona».
- **Si Daydream corta el stream, el lab dice por qué**: consulta `/v1/streams/:id/status` cada 3 s y enseña el
  `gateway_status.error` (p. ej. `credit_exhaustion`, cuenta sin créditos: corta a los ~6 s tras el primer frame). Cada stream se crea con todos los ControlNet que sirve su modelo (SDXL: canny, depth, tile;
  SD1.5: canny, depth, tile; SD-Turbo: canny, HED, depth, color) con peso 0, que es «apagado»: encenderlos y cambiar
  su peso va en caliente. Los umbrales de canny y el filtro NSFW hacen que Daydream recargue el pipeline (~30 s).
- Los PATCH solo llevan lo que ha cambiado respecto a lo que tiene el pipeline.
- Daydream activa por defecto un IP-Adapter con una textura fractal; aquí se manda desactivado (SD-Turbo no lo
  tiene y rechaza la clave).
- Si la salida se corta, el reproductor del SDK reconecta con un stream nuevo y el lab lo recoge solo.
- Cambiar de modelo recarga el pipeline: cada combinación es su propio stream y su propio arranque en frío.

## Medidas del 22 sep 2026 (Madrid → fal, us-west)

Latencia de ida y vuelta por frame, con **un solo frame en vuelo** (enviar, esperar, enviar el siguiente),
que es el mejor caso posible del bucle. Script: `node scripts/bench-realtime.mjs`.

| Configuración de klein realtime | 1ª respuesta | Media | p50 | Mejor |
|:--|--:|--:|--:|--:|
| 3 pasos, salida 768, entrada 704 | 1764 ms | 687 ms | 675 ms | 648 ms |
| **2 pasos, salida 768, entrada 704** | 1373 ms | **586 ms** | 572 ms | 545 ms |
| 1 paso, salida 768, entrada 512 | 1204 ms | 651 ms | 643 ms | 541 ms |
| 3 pasos, salida 1024, entrada 704 | 1456 ms | 767 ms | 757 ms | 740 ms |

En la app, dibujando de verdad: **778 ms de media, p50 709 ms, 1,3 fps**, 16 de 16 frames.

El suelo de red son ~125 ms de RTT a `fal.run` (TCP connect medido con curl), así que de los ~600 ms, un quinto
es transporte y el resto es fal. Bajar pasos o resolución apenas mueve la aguja: el coste está en la petición,
no en el modelo.

**Conclusión: por cloud, desde esta red, el techo son 1,5 a 1,7 fps.** Krea en local va a 10-20 fps. Sirve para
"el dibujo se transforma con medio segundo de retraso", no para "se transforma mientras trazas".

### Todos los endpoints, por HTTP

`node scripts/bench.mjs`, dos llamadas por modelo con el mismo garabato (casa, puerta, ventana, sol).

| Modelo | 1ª llamada | En caliente | Inferencia | Veredicto |
|:--|--:|--:|--:|:--|
| Z-Image Turbo i2i (768) | 0,8 s | **0,8 s** | 263 ms | Rápido, pero blanquea frames (ver abajo) |
| LCM SD1.5 i2i (512) | 128,0 s | 1,6 s | 70 ms | Rápido en caliente, arranque en frío brutal |
| SDXL ControlNet Union (768) | 59,9 s | 1,6 s | 589 ms | Plan B de calidad, hay que calentarlo |
| FLUX.2 klein 4B edit (1024) | 1,8 s | **1,8 s** | 1053 ms | Mejor render final |
| Z-Image Turbo + canny (768) | 2,9 s | 4,4 s | 3374 ms | Fidelidad al trazo, fuera del bucle |
| Nano Banana edit | 9,8 s | 7,9 s | - | Lento para un revelado |
| Bria FIBO sketch→color | 19,9 s | 21,7 s | - | Solo como control de fidelidad |
| LCM SDXL i2i (512) | sin respuesta en 150 s | 53,7 s | - | Descartado |

Lo que enseña la tabla: **fal cobra medio segundo fijo por petición**, venga por socket o por HTTP. Z-Image Turbo
i2i infiere en 263 ms y la llamada son 800 ms; LCM SD1.5 infiere en 70 ms y la llamada son 1,6 s. Por eso el
WebSocket solo ahorra unos 100 ms frente a HTTP, y por eso no hay tuning de modelo que arregle esto.

### El filtro NSFW de fal devuelve frames en negro

Con Z-Image Turbo, parte de los renders vuelven con **HTTP 200, `has_nsfw_concepts: true` y la imagen
completamente negra**. Pasa con dibujos inocentes (una casa a trazo suelto) y es determinista para un par
(prompt, dibujo) dado: cambiando una coma del prompt deja de pasar, y vuelve a pasar con otra combinación.
**`enable_safety_checker: false` se ignora en este endpoint**, así que no hay forma de desactivarlo.

**SDXL ControlNet Union hace lo mismo** con su filtro por defecto (v1): un trazo rojo suelto con el preset 3D Toy
vuelve negro y con `has_nsfw_concepts: true`, con `enable_safety_checker` a `true` o a `false` (probado el 23 sep
2026, `scripts/nsfw-check.mjs`). Con `safety_checker_version: 'v2'` el mismo dibujo, prompt y semilla pasan. El lab
manda v2 a SDXL Union y a SDXL Lightning, y a LCM le manda `enable_safety_checks: false` (en ese endpoint el
parámetro se llama distinto). En LCM no se reprodujo el negro con el mismo trazo.

Además, un frame negro **ya no sustituye al último bueno**: se queda el anterior, sale un aviso en la esquina y
cuenta como fallo en la cinta.

Un modelo que blanquea frames sin avisar no vale para una activación con público delante. La app ahora lo
detecta midiendo el brillo del frame recibido y lo dice en pantalla en vez de mostrar un panel negro.

### Trampas que costaron las primeras medidas

- **El endpoint no devuelve `request_id`.** Si el cliente espera a emparejarlo para cerrar el frame, la cola no
  se vacía nunca y el bucle se para tras el primer frame. Con eso medíamos 5 s en vez de 0,7 s.
- **Dos frames en vuelo doblan el retraso percibido**, porque el frame que el invitado espera va detrás de otro.
  Uno en vuelo y siempre el último trazo.
- **El intervalo del bucle se suma a la latencia.** Ahora el bucle mira cada 40 ms y `Espera mínima` es solo un
  tope inferior, no una cadencia fija.
- **Al cambiar de modelo hay que limpiar el panel.** Si no, el último frame del modelo anterior se queda en
  pantalla mientras el nuevo arranca en frío, y parece que el nuevo modelo contesta con esa imagen. Con un frame
  negro de Z-Image delante, parece que fallan todos.
- **Unas motas no son un dibujo.** Restos de goma o un clic suelto dejan el lienzo "no vacío" y el modelo se
  inventa un objeto entero a partir del prompt. Antes de enviar se cuenta la tinta real en una miniatura de 64 px
  (`MIN_INK_CELLS` en `src/lib/raster.ts`); por debajo del umbral no sale nada y el panel se queda vacío.
- **Con el lienzo vacío no se envía nada.** Si le mandas un frame en blanco, el modelo se inventa una figura a
  partir del prompt y parece que la activación "dibuja sola".
- **Un cambio de estilo o de parámetro tiene que marcar el frame como sucio.** Si solo se mira el dibujo, cambiar
  de preset no hace nada hasta el siguiente trazo, y parece que el cambio de estilo tarda eternidades.
- **Arranque en frío de hasta 187 s** en la primera llamada del día a un endpoint. Hay que calentar antes.
- **`fal-ai/flux-2/klein/realtime` es el único endpoint con worker realtime.** `lcm-sd15-i2i/realtime` acepta el
  socket y contesta `Error while forwarding the request` a los 36 s.
- **El socket habla msgpack.** Un frame JSON a pelo vuelve como `INTERNAL_ERROR: 'bytes'`; hay que ir por el cliente.
- **Los tokens realtime no se piden por el proxy genérico**: con la cabecera `x-fal-client-proxy`, fal ignora
  `allowed_apps` y emite un token sin permisos, y el socket responde `Forbidden` al primer frame.

## Límites conocidos

- El endpoint de tokens realtime solo firma para los endpoints de `src/data/endpoints.ts`; antes firmaba para
  cualquier app que pidiera el navegador.
- La contraseña de `middleware.ts` es una sola para todo el equipo: si se filtra, se cambia `LAB_PASSWORD` y se
  vuelve a desplegar. No hay límite de gasto por usuario; el tope lo ponen los saldos de fal y Daydream.
- La lista de endpoints realtime está en dos sitios (`src/data/endpoints.ts` y `api/lab.ts`): la función de Vercel
  no puede importar ficheros relativos sin extensión, así que lleva su copia.
- Los `@digo-labs/*` publicados declaran una condición de export `development` que apunta a `./src`, que npm no
  publica. `vite.config.ts` quita esa condición para que resuelvan a `dist`.
- Fuera del template hay que montar los providers a mano. **`TooltipProvider` no es opcional**: cada botón de la
  `DrawingToolbar` va envuelto en un `Tooltip`, y sin provider el tooltip no renderiza nada, así que la barra
  aparece vacía (solo se ven los separadores) y te quedas sin lápiz, goma, color ni deshacer.
- El coste solo se estima donde fal publica tarifa (klein realtime, 0,00194 $/s). En los demás se muestra la
  unidad de facturación, no un número inventado.
