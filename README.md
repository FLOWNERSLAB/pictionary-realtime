# AI Pictionary · realtime lab

Banco de pruebas para la activación **AI Pictionary** de AWS re:Play 2026: dibujas en el lienzo y la IA
reinterpreta el trazo *mientras dibujas*.

Desde el 23 oct 2026 el lab tiene **dos motores**, cada uno en su carril:

- **Flux realtime**: `fal-ai/flux-2/klein/realtime`, el único endpoint de imagen de fal con worker realtime por
  WebSocket. Un frame por petición, ~0,7 s, 1-1,5 fps. Es el carril de referencia.
- **StreamDiffusion**: SDXL-Turbo hosteado por Daydream, por WebRTC. Vídeo continuo a ~20 fps y ~0,4-0,5 s de
  extremo a extremo. Necesita `DAYDREAM_API_KEY`; sin ella la pestaña sale bloqueada.

Lo demás que se midió desde septiembre (FLUX.1 img2img, LoRAs, Z-Image, SDXL por HTTP, Nano Banana) era más
lento, devolvía frames en negro o necesitaba GPU propia, y se ha quitado del código.

## Arrancar

Necesitas Node 20.19 o más reciente.

```bash
npm install
cp .env.example .env   # pon FAL_KEY (y DAYDREAM_API_KEY si quieres StreamDiffusion)
npm run dev
```

La app queda en <http://localhost:5178>. **La clave no va en el repo**: pídesela a David por privado y pégala en tu
`.env` (está en `.gitignore`). La cuenta es compartida, así que lo que gastes sale del saldo del equipo: para el
bucle cuando no estés dibujando (`Espacio`). fal cobra 0,00194 $ por segundo de cómputo, unos 42 $ por 6 h al 100 %.

- Sin `FAL_KEY` el lienzo funciona, pero fal responde 401 y la app lo avisa con una banda ámbar.
- Vite solo lee `.env` al arrancar: si cambias la clave, reinicia `npm run dev`.

La clave vive solo en el servidor: el navegador pide un token realtime a `/api/fal/token` y abre el socket contra
fal directamente; `api/lab.ts` es la única función, y solo firma tokens para ese endpoint. El mismo fichero sirve
en local (montado en Vite por `vite-plugin-api.ts`) y en Vercel.

## Desplegar en Vercel

- `api/lab.ts` es la única función. `vercel.json` reescribe `/api/<ruta>` a `/api/lab?path=<ruta>`.
- `middleware.ts` pone **una contraseña compartida delante de toda la web** (`LAB_PASSWORD`): la URL gasta créditos
  del equipo y no puede quedar abierta.
- Variables en Vercel (Settings → Environment Variables, nunca en el repo): `FAL_KEY` y `LAB_PASSWORD`.
- Publicar: `vercel deploy --prod --yes --scope flowners` desde la carpeta.

## Cómo se usa

1. `Espacio` enciende el bucle. Dibuja: cada trazo sale hacia el modelo y la imagen de la derecha se actualiza.
2. **Pista**: qué estás dibujando («cat», «rocket»). Es opcional, pero con los estilos de foto klein no reconoce
   un garabato sin ella (sin pista devuelve el dibujo convertido en un objeto blanco con las líneas pintadas).
3. **AI Strength** (`[` `]`): bajo calca el dibujo, alto manda el prompt. Ocho peldaños, ver más abajo.
4. **Estilo** (`1`-`9` para los nueve primeros): tres grupos, Foto, Materia y Arte.
5. `T` borra y dibuja el boceto de prueba trazo a trazo con el bucle encendido (el boceto se elige en Ajustes).
6. La tira de abajo guarda los últimos frames: clic en uno para fijarlo en la caja de luz y compararlo; `Esc` o
   «Volver al directo» para soltarlo.
7. `O` cambia a la vista superpuesta: dibujas encima del render, con tu trazo como fantasma de lápiz.

La **cinta de latencia** deja una marca por frame: azul por debajo de 800 ms, ámbar hasta 1,5 s, rojo por encima.
La marca discontinua es el frame que sigue en vuelo. Las FPS son reales: salen del intervalo entre respuestas
mientras se dibuja.

## Cómo funciona el prompt

El prompt se monta en `src/lib/prompt.ts` a partir de tres partes que nunca se mezclan:

```
[fidelidad · AI Strength + pista]  [look del estilo]  [luz + paleta]  [fondo]
```

### AI Strength

klein realtime no tiene `strength`: es un modelo de edición y el boceto entra como referencia, no como latente
con ruido. El slider se traduce en ocho redacciones de la frase de fidelidad (`LADDER`), medidas el 23 oct 2026
con cinco bocetos y dos estilos (`scripts/lab/exp_ladder.py`):

| Tramo | Peldaño | Qué pide |
|:--|:--|:--|
| 0-12 | Calco | «Keep it a line drawing…»: el dibujo tal cual, teñido con los colores del estilo |
| 12-25 | Coloreado | Las mismas líneas con color plano y sombreado ligero |
| 25-38 | Recorte | Lo mismo, pero ya con el look completo: como un recorte fotografiado |
| 38-50 | Fiel | «Treat the ink as the only subject… texture them as if made of the materials of {S}»: la pista es material, no sujeto; **no completa** el objeto |
| 50-62 | Acabado | Como Fiel, con el detalle de superficie de la pista (valor por defecto, 55) |
| 62-75 | Limpio | «Turn this sketch into {S}…»: la pista ya nombra el sujeto y el objeto se completa aunque falten trazos |
| 75-88 | Libre | El dibujo solo sitúa y da la pose; además el boceto llega desenfocado |
| 88-100 | Prompt | Manda el prompt; del dibujo solo queda dónde está |

Por debajo de 0,38 el estilo se retira a «solo color y luz»: si le pides a la vez «sigue las líneas» y
«fotografíalo», klein hace una foto acabada siempre. En Fiel y Acabado la pista entra como **material**, no como
sujeto: es la única redacción con la que klein no completa el objeto desde un trazo suelto (23 oct,
`scripts/lab/exp_partial.py`: con «turn this sketch into a house» un rectángulo ya es una casa entera; pedirle
«do not draw parts that are not on the paper» no sirve). Es lo más parecido al img2img de Krea, donde el prompt
solo textura las formas que existen y el lienzo vacío no da nada. Lo que se probó y no sirve como strength: `schedule_mu` (no
cambia nada visible), los pasos (cambian la latencia, no la imagen), la memoria (`output_feedback_strength` por
debajo de 0,7 acumula manchas de color; el lab la limita a 0,3) y pintar el frame anterior bajo el trazo.

### Estilos

Los 20 estilos viven en `src/data/styles.ts`. Un estilo es un **tratamiento**, nunca un sujeto: dice cómo se hace la
imagen (`look`: cámara, material, técnica), su `light`, su `palette` y su `backdrop`. **No contiene ningún
sustantivo de objeto** («toy», «figurine», «sign», «vase»): era lo que hacía que «Cartoon» o «3D Toy» dibujaran un
juguete fuese lo que fuese el boceto. Qué es la imagen lo deciden solo el boceto y la pista.

| Grupo | Estilos |
|:--|:--|
| Foto | Natural, Estudio, Cine, 35 mm, Hora dorada, Noche, Macro, Blanco y negro |
| Materia | Arcilla, Cromo, Cristal, Madera, Papel, Neón |
| Arte | Acuarela, Tinta, Óleo, Cartoon, Pixel, Risografía |

## StreamDiffusion

La pestaña «StreamDiffusion» usa la misma pista, el mismo slider y los mismos estilos, pero es otra tecnología y
se adapta así (`src/data/stream.ts`, `src/lib/stream-prompt.ts`, `src/hooks/use-daydream-stream.ts`):

- **Entrada**: tu papel no cambia, pero el modelo recibe el trazo **en blanco sobre negro** (práctica de
  TouchDesigner): el ControlNet de líneas con preprocesador «Directo» lo lee como scribble y el render no sale con
  contorno negro. La miniatura «Lo que recibe» en la esquina del lienzo enseña el vídeo exacto que va a Daydream.
  Otras entradas: gris, ruido, o papel con «Lineart simple».
- **Prompt**: SDXL-Turbo lee CLIP, no frases: `pista, tags del estilo, centered, <fondo> background`. Cada estilo
  tiene sus `tags` (sin sustantivos de objeto: CLIP dibuja lo que lee).
- **AI Strength**: no hay escalera de frases. El valor coloca la primera pasada en `t_index_list` (0 = ruido puro,
  alto = el dibujo vuelve casi intacto; banda útil medida: ~20 calco, ~11 objeto, ~4 reinventa) y afloja el peso
  del ControlNet de líneas. El panel enseña el t_index resultante y el % del dibujo que sobrevive.
- **Recetas**: «Scribble TD» (por defecto), «Papel + lineart», «Negro sin líneas», «Escena». Cambiar el
  preprocesador o el filtro NSFW recarga el pipeline (~30 s).
- **Latencia**: no hay frames emparejados con respuestas. `L` pone la entrada en plano cinco veces y mide cuánto
  tarda la salida en seguirla (de extremo a extremo). Las FPS son las del vídeo que llega.
- Gotchas que siguen: Daydream descarta PATCH sin `model_id` (el hook lo manda siempre); guidance por encima de 1
  es ruido en Turbo; si la cuenta se queda sin créditos el stream se corta a los ~6 s y el lab enseña el motivo.

## El bucle (Flux realtime)

Cada 40 ms, si el dibujo cambió y no hay otro frame en vuelo: se serializa el SVG vivo del canvas (incluye el trazo
en curso), se rasteriza a un JPEG de 704 px al 50 % (lo que fal recomienda) y se envía por el socket. **Un solo
frame en vuelo**, siempre el último trazo. El socket es propio (`src/lib/realtime-socket.ts`): fal cierra todo
socket a los ~30 s, así que a los 15 s se abre uno de reserva, se calienta con el último frame y se cambia sin
frame en vuelo. Un frame sin respuesta a 3× la mediana se da por perdido y se reenvía el último dibujo.

Medido el 23 oct 2026 desde Madrid (`scripts/lab/exp_timing.py`), socket caliente, un frame en vuelo:

| Configuración | p50 | p90 |
|:--|--:|--:|
| 1 paso | 570 ms | 626 ms |
| 2 pasos | 593 ms | 641 ms |
| 3 pasos (por defecto) | 703 ms | 863 ms |
| 3 pasos · 1024 px | 900 ms | 939 ms |

Cambiar de estilo en cada frame no cuesta nada extra (p50 876 ms con 24 estilos seguidos). Un socket nuevo sobre
runner caliente contesta en ~1 s; sobre runner frío, de 9 a 17 s. Dibujando a un trazo cada 700 ms, la imagen va
de 0,8 a 1,5 s por detrás de la mano.

## scripts/lab

Arnés en Python (solo `websockets`, `PIL`, `numpy`, `scipy`; el msgpack va dentro) que habla con el socket de klein
sin la app, para medir sin sesgos del navegador:

```bash
python scripts/lab/sketches.py <carpeta>        # seis bocetos + etapas progresivas + variantes borrosas
python scripts/lab/exp_strength.py <carpeta>    # E1: todos los mandos como posible strength
python scripts/lab/exp_ladder.py <carpeta>      # E1b: la escalera de redacciones
python scripts/lab/exp_styles.py <carpeta>      # E2: 20 estilos × 4 bocetos × 3 strengths, con y sin pista
python scripts/lab/exp_timing.py <carpeta>      # E3: caliente, arranque, cambio de estilo, dibujo en directo
python scripts/lab/build_report.py <carpeta> informe.html
```

`promptkit.py` y `styles.json` son el espejo de `src/lib/prompt.ts` y `src/data/styles.ts`: si cambias uno,
cambia el otro. `metrics.py` mide cuánto del dibujo sobrevive en un render (adherencia: líneas dibujadas con un
borde del render cerca; novedad: bordes del render lejos de cualquier línea).

Los scripts `.mjs` de `scripts/` son las sondas antiguas del socket (`probe-socket.mjs`, `bench-realtime.mjs`).
