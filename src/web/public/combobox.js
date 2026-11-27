for (const input of document.querySelectorAll('input[role="combobox"]')) {
  const list = document.getElementById(input.getAttribute('aria-controls'));
  const status = document.getElementById(
    input.getAttribute('aria-describedby'),
  );
  let timer;
  let request;
  let active = -1;

  const say = (text) => {
    if (status) {
      status.textContent = text;
    }
  };

  const close = () => {
    list.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const failed = () => {
    close();
    say('Could not load members. Press Open to search instead.');
  };

  const highlight = (index) => {
    const items = [...list.children];

    active = (index + items.length) % items.length;
    list.selectedIndex = active;
    input.setAttribute('aria-activedescendant', items[active].id);
  };

  const choose = (item) => {
    input.value = item.value;
    close();
    input.form.requestSubmit();
  };

  const show = (members) => {
    list.replaceChildren(
      ...members.map((member, index) => {
        const item = document.createElement('option');

        item.id = `${list.id}-${index}`;
        item.value = member.id;
        item.textContent = `${member.name} (${member.username})`;

        return item;
      }),
    );
    active = -1;
    list.size = Math.max(2, Math.min(members.length, 8));
    list.hidden = members.length === 0;
    input.setAttribute('aria-expanded', String(members.length > 0));
    say(
      members.length === 0
        ? 'No matching members.'
        : `Members found: ${members.length}.`,
    );
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    request?.abort();

    const query = input.value.trim();

    if (query === '') {
      close();
      say('');

      return;
    }

    timer = setTimeout(async () => {
      request = new AbortController();

      try {
        const response = await fetch(
          `${input.dataset.source}?q=${encodeURIComponent(query)}`,
          { signal: request.signal },
        );

        if (response.ok) {
          show(await response.json());
        } else {
          failed();
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          failed();
        }
      }
    }, 200);
  });

  input.addEventListener('keydown', (event) => {
    if (list.hidden) {
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;

      highlight(active < 0 && step < 0 ? -1 : active + step);
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      choose(list.children[active]);
    } else if (event.key === 'Escape') {
      close();
    }
  });

  list.addEventListener('mousedown', (event) => event.preventDefault());
  list.addEventListener('click', (event) => {
    const item = event.target.closest('option');

    if (item) {
      choose(item);
    }
  });
  input.addEventListener('blur', close);
}
