 // Sombra sutil en el nav al hacer scroll
  const nav = document.querySelector('.nav');
  window.addEventListener('scroll', () => {
    nav.style.boxShadow = window.scrollY > 8 ? 'var(--shadow-1)' : 'none';
  });