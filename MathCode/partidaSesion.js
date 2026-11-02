(() => {
  let token = '';
  try { token = sessionStorage.getItem('mathoro-game-session') || ''; } catch (_) {}
  if (!token) return;

  const send = (action) => {
    const scoreNode = document.getElementById('puntajeValor');
    const score = Math.max(0, Number.parseInt(scoreNode?.textContent || '0', 10) || 0);
    return fetch('/api/game/presence', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionToken: token, action, score }),
    keepalive: action === 'leave'
    }).catch(() => {});
  };

  void send('heartbeat');
  const heartbeat = window.setInterval(() => { void send('heartbeat'); }, 15000);

  window.MathoroGamePresence = Object.freeze({
    async leave() {
      window.clearInterval(heartbeat);
      try { sessionStorage.removeItem('mathoro-game-session'); } catch (_) {}
      await send('leave');
    }
  });
})();
