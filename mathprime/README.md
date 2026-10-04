# MATHORO

MATHORO es un juego educativo de matemáticas para navegador, desarrollado con HTML5, CSS3 y JavaScript Vanilla. Esta guía describe las pantallas, los recursos, las reglas y la estructura interna de la versión actual, incluida la mecánica **Ultimate / Rayo Matemático** y el sistema de recuperación de errores.

## Contenido

- [Requisitos y ejecución](#requisitos-y-ejecución)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Navegación entre pantallas](#navegación-entre-pantallas)
- [Descripción de páginas](#descripción-de-páginas)
- [Instancia jugable: reglas y mecánicas](#instancia-jugable-reglas-y-mecánicas)
- [Arquitectura modular del juego](#arquitectura-modular-del-juego)
- [Configuración central](#configuración-central)
- [Preguntas, integridad y respaldo](#preguntas-integridad-y-respaldo)
- [Gestión de errores y recuperación](#gestión-de-errores-y-recuperación)
- [Estilos, animaciones y adaptación de pantalla](#estilos-animaciones-y-adaptación-de-pantalla)
- [Recursos multimedia](#recursos-multimedia)
- [Tecnologías y límites actuales](#tecnologías-y-límites-actuales)

## Requisitos y ejecución

El proyecto no necesita paquetes npm, frameworks, compilación ni servicios externos. Las páginas utilizan archivos HTML, CSS, módulos JavaScript y recursos guardados dentro de este mismo proyecto.

Como `nivel1.html` carga archivos JavaScript con `type="module"`, se recomienda servir la carpeta mediante un servidor web local. Abrir directamente el HTML como `file://` puede hacer que algunos navegadores bloqueen los imports de módulos.

Una opción sencilla es iniciar un servidor desde la carpeta del proyecto:

```bash
python -m http.server 8000
```

Luego se abre `http://localhost:8000/menu.html` en el navegador. También se puede usar una extensión local de servidor de Visual Studio Code.

## Estructura del proyecto

```text
mathprime/
├── menu.html             # Menú principal y accesos a las demás pantallas
├── jugar.html            # Pantalla previa al comienzo del nivel
├── empiezo.html          # Confirmación, carga y paso al nivel 1
├── nivel1.html           # Estructura HTML de la instancia jugable
├── controles.html        # Pantalla gráfica de controles
├── opciones.html         # Pantalla gráfica de opciones
├── login.html            # Pantalla gráfica de inicio de sesión
├── estilos.css           # Presentación, posiciones, estados y animaciones del nivel
├── preguntas.js          # Banco, pregunta de respaldo y validador
├── gameLogic.js          # Reglas, estado, poderes y recuperación de la partida
├── audioEngine.js        # Síntesis de sonidos con Web Audio API
├── uiController.js       # Mediador entre eventos, reglas, audio y DOM
├── imagenes/             # Imágenes usadas por las páginas
├── videos/               # Videos usados o conservados como recursos
└── .vscode/              # Configuración del editor
```

Los módulos de `nivel1.html` tienen responsabilidades separadas. La página carga `uiController.js`; el controlador importa el banco de preguntas, la lógica y el motor de audio. La lógica importa únicamente el validador y la pregunta de respaldo.

```text
nivel1.html
    └── uiController.js
          ├── preguntas.js
          ├── gameLogic.js ──> preguntaDeRespaldo / validarPregunta
          └── audioEngine.js
```

## Navegación entre pantallas

```text
menu.html ── Jugar ──> jugar.html ── clic ──> empiezo.html
                                                   │
                                      clic: pantalla de carga
                                                   │
                                                   v
                                               nivel1.html
```

Desde el menú también se abren `controles.html`, `opciones.html` y `login.html`. `jugar.html` y `empiezo.html` avanzan mediante un clic en cualquier parte de su pantalla. En `empiezo.html`, el clic muestra `imagenes/cargasmath.png` por 2,4 segundos antes de abrir el nivel.

### Efectos comunes de las pantallas gráficas

`menu.html`, `jugar.html`, `empiezo.html`, `controles.html`, `opciones.html` y `login.html` tienen sus estilos y scripts directamente en cada página. En general, esos scripts esperan al evento `load`, quitan el velo oscuro de entrada después de un breve retraso y agregan 32 partículas decorativas. Las partículas nacen en posiciones horizontales aleatorias, suben desde el borde inferior y tienen duraciones aleatorias aproximadas de 6 a 14 segundos. Los overlays de brillo y viñeta se dibujan con CSS y no bloquean los clics.

El menú también aplica un fundido de entrada y un fundido de salida. Sus botones aceptan clic de ratón y evento táctil; bloquean activaciones repetidas por un intervalo corto y reproducen tonos de confirmación y transición generados con Web Audio.

## Descripción de páginas

### `menu.html` — Menú principal

- Usa `imagenes/menumath.png` como fondo, junto con `imagenes/logomath.png`, `imagenes/iniciomath.png` y `imagenes/barritamath.png` como elementos del encabezado.
- Implementa zonas de clic transparentes sobre las opciones dibujadas en la imagen. Los botones son `btnJugar`, `btnControles`, `btnOpciones` y `btnInicio`.
- El botón Jugar abre `jugar.html`; Controles y Opciones conducen a sus páginas gráficas, e Inicio abre `login.html`.
- Incluye animación de brillo, viñeta, destellos generados por JavaScript, fundido de entrada y fundido de salida.
- Genera tonos breves de botones y un efecto de transición mediante Web Audio API.
- Tiene un contenedor de carga con `imagenes/cargasmath.png`.

### `jugar.html` — Pantalla previa al inicio

- Presenta `imagenes/jugarmath.png` ocupando toda la pantalla.
- Cualquier clic lleva a `empiezo.html`.
- Conserva los efectos visuales de fundido de entrada, brillo, viñeta y partículas luminosas.

### `empiezo.html` — Pantalla de comienzo

- Presenta `imagenes/empiezomath.png` a pantalla completa.
- Al recibir un clic, muestra el overlay de carga que contiene `imagenes/cargasmath.png`.
- Espera 2,4 segundos y navega a `nivel1.html`.
- Conserva el fundido de entrada y los efectos ambientales.

### `nivel1.html` — Estructura de la instancia jugable

Esta página mantiene el marcado y los contenedores visuales. No contiene la hoja de estilos ni las reglas de juego en línea: enlaza `estilos.css` y carga `uiController.js` como módulo ES.

- `#contenedor` agrupa el tablero del nivel y usa `imagenes/nivel122.png` como fondo.
- `.video-wrapper` presenta el video de fondo `videos/jefemath.mp4`.
- `.barra-vida` contiene el indicador de vidas y la etiqueta que señala si el escudo está activo.
- `#pregunta` incluye salud del enemigo, dificultad, enunciado, combo, multiplicador, tres poderes y el panel Ultimate.
- Seis botones `.opcion` muestran las respuestas y tienen índices de 0 a 5.
- Las zonas inferiores presentan puntaje, cronómetro y mensaje motivacional.
- `#rageOverlay` dibuja el efecto del modo Rage.
- `#gameover` es el panel final compartido por victoria y derrota. Usa otro elemento de video con `videos/jefemath.mp4`, un título, un resumen y el botón «Jugar de nuevo».

### `controles.html` — Pantalla de controles

Muestra `imagenes/controles.png` como imagen estática de pantalla completa. Incluye fundido, brillo, viñeta y destellos; no contiene lógica de control interactiva propia.

### `opciones.html` — Pantalla de opciones

Muestra `imagenes/opciones.png` como imagen estática de pantalla completa. Incluye fundido, brillo, viñeta y destellos; actualmente la pantalla no implementa preferencias configurables.

### `login.html` — Pantalla de inicio de sesión

Muestra `imagenes/iniciarmath3.png` con los efectos visuales de las demás pantallas gráficas. En esta versión es una pantalla visual; no implementa formulario, autenticación ni persistencia de usuarios.

## Instancia jugable: reglas y mecánicas

### Preguntas y respuestas

- Cada turno presenta una pregunta y seis opciones de respuesta, con una respuesta correcta.
- El controlador selecciona una pregunta aleatoria del banco y mezcla las seis opciones antes de colocarlas en los botones.
- La dificultad se representa con entre una y tres estrellas.
- Una respuesta seleccionada se bloquea visualmente durante la transición. El juego ilumina la opción correcta en verde; si se eligió una respuesta incorrecta también la marca en rojo.
- Las respuestas se pueden seleccionar con el ratón, un control táctil o el teclado numérico `1` a `6`.

### Vidas, enemigo, puntaje y cronómetro

- La partida comienza con **5 vidas** y el enemigo con **1000 HP**.
- Una respuesta equivocada resta una vida, salvo que haya un escudo activo. El error reinicia el combo y la carga consecutiva del Ultimate.
- El daño normal base por acierto es **100 HP**. El multiplicador de combo puede aumentar este daño.
- El puntaje base es **100 puntos por respuesta correcta**. Se suma un bono según el tiempo transcurrido desde que apareció esa pregunta: **50 puntos** si se responde antes de 3 segundos, **25 puntos** si se responde antes de 5 segundos y ningún bono a partir de ese umbral.
- El cronómetro mostrado mide la duración completa de la partida. No es un límite de tiempo ni cuenta regresiva por pregunta.
- Si los HP del enemigo llegan a cero, el resultado es victoria. Si las vidas del jugador llegan a cero, el resultado es derrota. El panel final muestra el resultado, el puntaje y el tiempo.

### Combo y multiplicador

- Cada respuesta correcta consecutiva incrementa el combo.
- El multiplicador se calcula en grupos de tres aciertos: empieza en `1x`, llega a `2x` al tercer acierto seguido, a `3x` al sexto y continúa hasta un máximo de `5x`.
- La respuesta incorrecta reinicia el combo y devuelve el multiplicador a `1x`.
- El puntaje y el daño de una respuesta correcta utilizan el multiplicador vigente para ese acierto.
- Al alcanzar cinco aciertos consecutivos aparece **Rage Mode**, un resplandor animado en los bordes de la pantalla. El efecto desaparece cuando se rompe la racha.

### Poderes existentes

Los poderes estándar se habilitan después de **dos respuestas correctas seguidas**. Están disponibles mientras la partida está en curso y no se está animando una respuesta.

- **Furia (`Q`):** arma el siguiente acierto. Ese acierto duplica el puntaje que le corresponda y el daño causado. Una respuesta equivocada desarma Furia.
- **50/50 (`W`):** cuesta **200 puntos** y descarta dos opciones incorrectas del turno. La opción correcta permanece disponible.
- **Escudo (`E`):** cuesta **150 puntos** y bloquea una pérdida de vida. Se consume cuando se responde mal y no protege contra efectos distintos de ese error.

Los botones reflejan si el poder está habilitado de acuerdo con el combo, el puntaje disponible, el estado del escudo y si Furia ya está armada.

### Atajos de teclado

| Tecla | Acción |
| --- | --- |
| `1`–`6` | Seleccionar la respuesta ubicada en el índice correspondiente. |
| `Q` | Activar Furia cuando esté disponible. |
| `W` | Activar 50/50 cuando el combo y el puntaje lo permitan. |
| `E` | Activar Escudo cuando el combo y el puntaje lo permitan. |
| `R` | Activar el Rayo Matemático cuando la barra esté completa. |

Los botones también se pueden usar con clic o toque. Una opción deshabilitada o descartada no se selecciona con el teclado.

### Ultimate / Rayo Matemático (`R`)

- La barra Ultimate acumula una unidad por cada respuesta correcta consecutiva y se carga por completo con **tres aciertos seguidos**.
- Una respuesta equivocada devuelve la carga a cero.
- Cuando está cargado, se puede activar con el botón **RAYO · 300 HP** o con la tecla `R`.
- El Rayo causa **300 HP de daño inmediato**. No necesita esperar ni consumir tiempo restante de respuesta; el cronómetro general sigue midiendo el tiempo de la partida.
- Si el ataque reduce los HP del enemigo a cero, se activa la victoria. Si el enemigo sobrevive, la misma pregunta continúa disponible después de la animación.
- Activar Ultimate consume únicamente su carga. No cambia vidas, puntaje, combo, multiplicador, Furia ni Escudo.
- El ataque tiene un destello azul/celeste y una secuencia de audio ascendente.

### Pantalla final y reinicio

Al ganar o perder, se detiene el cronómetro y aparece el panel final sobre el video del jefe. El botón **Jugar de nuevo** reinicia vidas, HP del enemigo, puntaje, combo, poderes, Ultimate, cronómetro y pregunta inicial. Las tareas temporizadas de la ronda anterior se cancelan durante el reinicio.

## Arquitectura modular del juego

### `preguntas.js` — Datos y validación del banco

- Exporta `PREGUNTAS`, una lista de **50 preguntas**, organizada en cinco temas con diez preguntas por tema.
- Cada objeto incluye `tema`, `dificultad`, `pregunta`, `opciones` y `correcta`.
- Exporta `preguntaDeRespaldo`, una pregunta de suma sencilla y válida para la recuperación de emergencia. Sus opciones están congeladas para que no se modifiquen accidentalmente.
- Exporta `validarPregunta(pregunta)`, que verifica que el valor sea un objeto y que tenga tema y enunciado no vacíos, dificultad entera entre 1 y 3, seis respuestas de texto no vacías y distintas entre sí, y una respuesta correcta incluida en la lista.
- El controlador revisa las preguntas al seleccionarlas. Una entrada inválida genera una advertencia en la consola y se omite; si no encuentra ninguna pregunta válida, usa el respaldo.

### `gameLogic.js` — Reglas y estado independiente del DOM

Este módulo no busca elementos HTML, no dibuja la interfaz y no sintetiza audio.

- Exporta `GAME_CONFIG`, el objeto central de balance y valores de la partida.
- Exporta `safeExecute(operation, fallback, context)` para ejecutar una operación dentro de un `try/catch`; informa el fallo con `console.warn` y devuelve el valor de respaldo o ejecuta una función de respaldo.
- Exporta `validateData(value, validator, fallback)`, que usa `safeExecute` para validar un dato sin propagar excepciones.
- Exporta `randomInteger`, `randomItem` y `shuffleList` para generación y mezcla aleatoria reutilizable.
- Exporta la clase `GameLogic`. Su estado incluye vidas, HP enemigo, puntaje, combo, multiplicador, Furia, Escudo, carga Ultimate, fase y resultado.
- `reset()` inicializa una partida nueva; `setQuestion()` valida y prepara la respuesta correcta del turno; `answer()` resuelve la respuesta, bonificaciones, daño, combo, vida y carga Ultimate.
- `activateFury()`, `useFiftyFifty()` y `activateShield()` implementan las reglas y costos de los poderes existentes.
- `activateUltimate()` consume una carga completa y aplica hasta 300 puntos de daño sin modificar los demás atributos del jugador.
- `finish()` registra victoria o derrota. `getState()` entrega una copia del estado e indica si el Ultimate está listo.
- `recoverGameState()` restaura la pregunta de respaldo, reanuda una fase jugable y conserva el puntaje. Si las vidas o los HP estaban en cero al momento del fallo, los eleva al mínimo necesario para continuar.
- `answer()` contiene su propio manejo de errores. Ante una excepción, invoca la recuperación y devuelve una indicación para que la interfaz presente la pregunta de respaldo.

### `audioEngine.js` — Sonido

- Exporta `AudioEngine`, responsable exclusivamente del audio generado con Web Audio API.
- Crea un `AudioContext` si el navegador lo permite; no usa archivos de sonido ni paquetes externos.
- `resume()` intenta reanudar un contexto suspendido luego de interacción del usuario.
- `tone()` crea un oscilador y una envolvente de volumen para producir un tono con frecuencia, forma de onda, duración, volumen y retraso configurables.
- `playCorrect()`, `playError()` y `playPower()` generan sonidos de acierto, error y poderes.
- `playUltimate()`, `playVictory()` y `playDefeat()` generan secuencias diferenciadas para Rayo Matemático y resultados de la partida.
- La inicialización, el reanudado y la reproducción tienen `try/catch`. Si el permiso o la API fallan, los métodos dejan el audio desactivado sin interrumpir el juego.

### `uiController.js` — Control de interfaz

- Importa el banco, la pregunta de respaldo, el validador, la lógica, las funciones auxiliares y el motor de audio.
- `cacheElements()` obtiene los elementos de `nivel1.html` y detecta si falta alguno.
- `bindEvents()` conecta los botones y las entradas de teclado con la lógica; los clics de respuesta y los poderes pasan por `runSafely()`.
- `selectValidQuestion()` recorre el banco desde un índice aleatorio, omite preguntas inválidas y elige el respaldo si todas fallan.
- `showQuestion()` configura el enunciado, las estrellas de dificultad y las seis opciones mezcladas.
- `handleAnswer()` resuelve y presenta aciertos y errores, sonidos, animaciones, daño, vidas y transición al siguiente turno o a la pantalla final.
- `handleFury()`, `handleFiftyFifty()` y `handleShield()` conectan los tres poderes con sus botones y sonidos.
- `handleUltimate()` activa el ataque cuando está cargado, reproduce el efecto, actualiza HP y carga, anima el rayo y presenta la victoria si el golpe derrota al enemigo.
- `handleKeydown()` admite `1`–`6` para respuestas, `Q` para Furia, `W` para 50/50, `E` para Escudo y `R` para Ultimate.
- `render()` actualiza barras de vida y HP, puntaje, combo, multiplicador, estados de botones, Rage Mode y barra Ultimate.
- `startTimer()`, `stopTimer()` y `formatTime()` controlan y muestran el cronómetro.
- `showEndScreen()` prepara el resultado y el video final. `restart()` inicia una ronda nueva.
- `recoverGameState()` limpia animaciones y estados visuales temporales, mantiene el puntaje, presenta la pregunta de respaldo y vuelve a habilitar la partida.
- `bindGlobalErrorRecovery()` atiende errores globales y promesas rechazadas. `schedule()` protege las transiciones temporizadas y `showFloatingText()` presenta textos flotantes de daño o bloqueo.

### `estilos.css` — Presentación visual del nivel

Contiene los estilos que antes estaban en línea dentro de `nivel1.html`:

- Reinicio básico, pantalla completa y contenedor del nivel.
- Posición, tamaño y recorte del fondo y del video.
- Barra de vida del jugador, indicador de escudo y barra de HP del enemigo.
- Panel de pregunta, dificultad por estrellas, combo y colores por multiplicador.
- Botones de los poderes, opciones de respuesta y posiciones de las seis respuestas sobre el fondo.
- Estados de respuesta correcta, incorrecta y descartada; animaciones de brillo y puntaje.
- Mensaje motivacional, puntaje, cronómetro y números de daño flotantes.
- Bordes animados de Rage Mode y overlay de victoria/derrota.
- Barra y botón Ultimate, pulso de carga y destello del rayo.
- Media queries para ajustes en orientación vertical pequeña y pantallas apaisadas bajas.

## Configuración central

Los valores de balance se encuentran en `GAME_CONFIG` dentro de `gameLogic.js`:

| Propiedad | Valor actual | Función |
| --- | ---: | --- |
| `maxLives` | 5 | Vidas iniciales y máximo de la barra. |
| `maxEnemyHp` | 1000 | HP iniciales del enemigo. |
| `baseDamage` | 100 | Daño de cada respuesta correcta antes del multiplicador. |
| `basePoints` | 100 | Puntaje base por acierto antes del bono y multiplicador. |
| `fastBonus` | 50 | Bono para respuestas de menos de 3 segundos. |
| `mediumBonus` | 25 | Bono para respuestas de menos de 5 segundos, luego del umbral rápido. |
| `fastThresholdMs` | 3000 | Límite del bono rápido en milisegundos. |
| `mediumThresholdMs` | 5000 | Límite del bono medio en milisegundos. |
| `fiftyFiftyCost` | 200 | Costo del poder 50/50. |
| `shieldCost` | 150 | Costo del Escudo. |
| `powerComboRequired` | 2 | Combo mínimo para habilitar Furia, 50/50 y Escudo. |
| `rageComboRequired` | 5 | Aciertos seguidos para activar Rage Mode. |
| `maxMultiplier` | 5 | Máximo multiplicador de puntaje y daño normal. |
| `ultimateDamage` | 300 | Daño del Rayo Matemático. |
| `ultimateCorrectStreak` | 3 | Aciertos consecutivos necesarios para cargar el Ultimate. |

`GAME_CONFIG` se exporta como objeto congelado. Para cambiar el balance, modifica sus valores en un solo lugar.

## Preguntas, integridad y respaldo

El banco cuenta con diez preguntas por cada uno de estos cinco temas:

1. Números naturales y enteros.
2. Divisibilidad.
3. Números racionales.
4. Proporcionalidad.
5. Geometría.

La validación se aplica en dos puntos: el controlador filtra las preguntas antes de mostrarlas, y `GameLogic.setQuestion()` valida también antes de preparar un turno. Una pregunta corrupta no debe bloquear el banco: se advierte en consola y se pasa a la siguiente. Si no hay ninguna válida, se utiliza la pregunta de respaldo «¿Cuánto es 2 + 2?» con seis opciones.

Para agregar preguntas, mantén el mismo formato de objeto, la dificultad entre 1 y 3, seis opciones diferentes y la respuesta correcta dentro de esas opciones.

## Gestión de errores y recuperación

- Los datos de preguntas se validan antes de usarse. Los datos inválidos se omiten en vez de permitir que la interfaz quede esperando una pregunta incorrecta.
- `safeExecute()` protege callbacks de la interfaz y registra advertencias sin terminar el ciclo de juego.
- `GameLogic.answer()` contiene un `try/catch` de turno. Si una operación de lógica falla, llama a `recoverGameState()` y devuelve el estado de recuperación.
- El controlador también escucha errores globales y rechazos de promesas no atendidos.
- La recuperación elimina los textos flotantes y estados temporales, vuelve a mostrar la pregunta de emergencia, reanuda el cronómetro si se había detenido y conserva los puntos acumulados.
- El motor de audio trata el bloqueo por permisos o ausencia de Web Audio como una degradación opcional: el juego sigue funcionando en silencio.
- Los intentos de reproducción del video final manejan la promesa devuelta por el navegador para evitar rechazos sin atender.

## Estilos, animaciones y adaptación de pantalla

El tablero conserva una composición a pantalla completa posicionada sobre la ilustración del nivel. Las respuestas tienen coordenadas porcentuales relativas al tablero. Las animaciones incluyen:

- Escala emergente del combo y puntaje.
- Resplandor verde para la respuesta correcta y rojo para la equivocada.
- Pulso dorado de Furia cuando está armada.
- Números flotantes para puntaje, daño, pérdida de vida y bloqueo por escudo.
- Pulso de bordes para Rage Mode.
- Barra de carga luminosa, pulso del botón cuando Ultimate está listo y destello celeste al disparar.
- Fondo oscurecido y contenido centrado en la pantalla de victoria o derrota.

Las media queries reducen tamaños y alturas de controles en pantallas verticales pequeñas y pantallas apaisadas de poca altura. El fondo utiliza `object-fit: fill`, así que puede estirarse para ajustarse a la proporción disponible.

## Recursos multimedia

### Imágenes de `imagenes/`

| Archivo | Uso actual o estado |
| --- | --- |
| `barritamath.png` | Decoración del encabezado de `menu.html`. |
| `cargamath.png` | Recurso conservado; no se referencia en las páginas actuales. |
| `cargasmath.png` | Overlay de carga de `empiezo.html` y recurso de carga de `menu.html`. |
| `controles.png` | Fondo estático de `controles.html`. |
| `empiezomath.png` | Fondo de `empiezo.html`. |
| `iniciarmath2.png` | Recurso conservado; el inicio de sesión actual usa `iniciarmath3.png`. |
| `iniciarmath3.png` | Fondo de `login.html`. |
| `iniciomath.png` | Imagen del acceso a Inicio en el encabezado del menú. |
| `jugarmath.png` | Fondo de `jugar.html`. |
| `logomath.png` | Logotipo del encabezado del menú. |
| `menumath.png` | Fondo del menú y base visual de sus zonas interactivas. |
| `nivel122.png` | Fondo de `nivel1.html`. |
| `opciones.png` | Fondo estático de `opciones.html`. |

### Videos de `videos/`

| Archivo | Uso actual o estado |
| --- | --- |
| `jefemath.mp4` | Video de fondo del nivel y video de la pantalla final. |
| `controlesmath.mp4` | Video conservado; `controles.html` muestra actualmente una imagen. |
| `opcionesmath.mp4` | Video conservado; `opciones.html` muestra actualmente una imagen. |
| `videomath.mp4` | Video conservado; no está referenciado por las páginas actuales. |

Los archivos conservados pero no utilizados no afectan la partida. Se pueden mantener como material del proyecto para uso futuro.

## Archivos auxiliares

- `.vscode/launch.json`: configuración de lanzamiento del editor.
- `.vscode/settings.json`: preferencias de Visual Studio Code para este proyecto.

## Tecnologías y límites actuales

- HTML5 organiza las páginas y los componentes visibles.
- CSS3 controla la presentación, las posiciones del tablero, los estados, las animaciones y los ajustes adaptables.
- JavaScript ES Modules separa preguntas, lógica de dominio, audio y mediación visual.
- Web Audio API genera efectos de sonido sin descargar archivos de audio adicionales.
- No hay framework, servidor de aplicación, base de datos, cuentas, almacenamiento persistente ni autenticación implementados.
- La pantalla de Opciones es una ilustración estática y todavía no modifica preferencias del juego.
- La pantalla de Controles también es una ilustración; los controles de la partida se detallan en esta guía y en los botones de la interfaz.
