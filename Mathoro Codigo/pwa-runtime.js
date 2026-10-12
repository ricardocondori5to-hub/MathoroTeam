(() => {
  const installedQuery = window.matchMedia('(display-mode: standalone)');
  const isInstalled = () => installedQuery.matches || navigator.standalone === true;

  function updateLayoutMode() {
    const installed = isInstalled();
    document.documentElement.classList.toggle('pwa-installed', installed);
    document.documentElement.classList.toggle('pwa-portrait', installed && window.matchMedia('(orientation: portrait)').matches);
    document.documentElement.classList.toggle('pwa-landscape', installed && window.matchMedia('(orientation: landscape)').matches);
  }

  updateLayoutMode();
  window.addEventListener('orientationchange', updateLayoutMode, { passive: true });
  window.addEventListener('resize', updateLayoutMode, { passive: true });
  installedQuery.addEventListener?.('change', updateLayoutMode);

  if (isInstalled() && screen.orientation?.lock) {
    screen.orientation.lock('landscape').catch(() => {
      // Algunos navegadores, como Safari en iOS, reservan el giro para el usuario.
    });
  }
})();
