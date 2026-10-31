(() => {
  const DURACION = 380;
  let navegando = false;
  const overlay = document.createElement('div');
  overlay.className = 'transicion-pantalla';
  overlay.setAttribute('aria-hidden', 'true');

  function navegar(url, duracion = DURACION) {
    if (navegando || !url) return;
    navegando = true;
    overlay.classList.remove('lista');
    void overlay.offsetWidth;
    overlay.classList.add('salida');
    window.setTimeout(() => { window.location.assign(url); }, Math.max(DURACION, duracion));
  }

  (document.body || document.documentElement).appendChild(overlay);
  window.navegarConFade = navegar;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => overlay.classList.add('lista'));
  });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    navegando = false;
    overlay.classList.remove('lista', 'salida');
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('lista')));
  });

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const objetivo = event.target instanceof Element ? event.target : event.target.parentElement;
    const enlace = objetivo?.closest('a[href]');
    if (!enlace || enlace.hasAttribute('download') || (enlace.target && enlace.target !== '_self')) return;

    const destino = new URL(enlace.href, window.location.href);
    if (destino.origin !== window.location.origin || destino.href === window.location.href) return;
    if (!/\.html?$/i.test(destino.pathname)) return;

    event.preventDefault();
    navegar(destino.href);
  }, true);
})();
