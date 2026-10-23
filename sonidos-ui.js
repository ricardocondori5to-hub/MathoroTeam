(() => {
  const AudioContextUI = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextUI) return;

  let context = null;
  let ultimoSonido = 0;

  function esControlInteractivo(target) {
    if (!(target instanceof Element)) return null;
    const control = target.closest('button, a[href], [role="button"], input[type="button"], input[type="submit"]');
    if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true') return null;
    return control;
  }

  function reproducirTono() {
    try {
      context ||= new AudioContextUI();
      const emitir = () => {
        const ahora = context.currentTime;
        const oscilador = context.createOscillator();
        const volumen = context.createGain();
        oscilador.type = 'sine';
        oscilador.frequency.setValueAtTime(660, ahora);
        oscilador.frequency.exponentialRampToValueAtTime(880, ahora + 0.045);
        volumen.gain.setValueAtTime(0.0001, ahora);
        volumen.gain.exponentialRampToValueAtTime(0.12, ahora + 0.012);
        volumen.gain.exponentialRampToValueAtTime(0.0001, ahora + 0.12);
        oscilador.connect(volumen);
        volumen.connect(context.destination);
        oscilador.start(ahora);
        oscilador.stop(ahora + 0.13);
        ultimoSonido = performance.now();
      };

      if (context.state === 'suspended') {
        context.resume().then(emitir).catch(() => {});
      } else {
        emitir();
      }
    } catch (error) {
      console.warn('[MATHORO] No se pudo reproducir el sonido de interfaz.', error);
    }
  }

  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !esControlInteractivo(event.target)) return;
    reproducirTono();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!['Enter', ' '].includes(event.key) || !esControlInteractivo(event.target)) return;
    reproducirTono();
  }, true);

  document.addEventListener('click', (event) => {
    if (!esControlInteractivo(event.target) || performance.now() - ultimoSonido < 500) return;
    reproducirTono();
  }, true);
})();
