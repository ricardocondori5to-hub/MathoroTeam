(() => {
  if (document.getElementById('mathoro-particles')) return;

  const filter = document.createElement('div');
  filter.id = 'mathoro-color-filter';
  filter.setAttribute('aria-hidden', 'true');
  const field = document.createElement('div');
  field.id = 'mathoro-particles';
  field.setAttribute('aria-hidden', 'true');

  const colors = ['#fff1d8', '#f1c991', '#d5a56d', '#94653b'];
  for (let index = 0; index < 28; index += 1) {
    const particle = document.createElement('i');
    particle.className = 'mathoro-particle';
    particle.style.setProperty('--left', `${Math.random() * 100}%`);
    particle.style.setProperty('--size', `${4 + Math.random() * 4}px`);
    particle.style.setProperty('--color', colors[index % colors.length]);
    particle.style.setProperty('--alpha', `${0.28 + Math.random() * 0.2}`);
    particle.style.setProperty('--rest', `${Math.random() * 20}vh`);
    particle.style.setProperty('--duration', `${20 + Math.random() * 14}s`);
    particle.style.setProperty('--delay', `${-(index % 9) * 0.55}s`);
    particle.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 80)}px`);
    field.appendChild(particle);
  }

  document.body.append(filter, field);
})();
