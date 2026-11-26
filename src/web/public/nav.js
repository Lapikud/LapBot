const navigation = document.querySelector('.primary-nav');
const links = document.querySelector('#primary-links');

if (navigation && links && links.children.length > 0) {
  const button = navigation.querySelector('.nav-menu-button');
  const fallback = !Object.hasOwn(HTMLElement.prototype, 'popover');

  if (fallback && button) {
    navigation.classList.add('nav-fallback');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
      const open = navigation.classList.toggle('menu-open');
      button.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (event) => {
      if (!navigation.contains(event.target)) {
        navigation.classList.remove('menu-open');
        button.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        navigation.classList.remove('menu-open');
        button.setAttribute('aria-expanded', 'false');
      }
    });
  }

  const fit = () => {
    navigation.classList.add('is-measuring', 'is-wide');
    navigation.classList.remove('menu-open');
    links.removeAttribute('popover');

    if (navigation.scrollWidth > navigation.clientWidth) {
      navigation.classList.remove('is-wide');
      if (!fallback) {
        links.setAttribute('popover', 'auto');
      }
    }

    navigation.classList.remove('is-measuring');
  };

  fit();
  new ResizeObserver(fit).observe(navigation);
  document.fonts.ready.then(fit);
}
