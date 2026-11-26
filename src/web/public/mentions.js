for (const picker of document.querySelectorAll('fieldset.mentions')) {
  const search = picker.querySelector('input[list]');
  const chips = picker.querySelector('.chips');
  const options = [...picker.querySelectorAll('datalist option')];

  const add = (option) => {
    const value = option.dataset.mention;

    if (picker.querySelector(`input[name="mention"][value="${value}"]`)) {
      return;
    }

    const chip = document.createElement('li');
    const hidden = document.createElement('input');
    const remove = document.createElement('button');

    hidden.type = 'hidden';
    hidden.name = 'mention';
    hidden.value = value;
    remove.type = 'button';
    remove.className = 'secondary outline';
    remove.setAttribute('aria-label', `Remove ${option.value}`);
    remove.textContent = '×';
    chip.append(hidden, option.value, remove);
    chips.append(chip);
  };

  search.addEventListener('input', () => {
    const typed = search.value.trim();
    const match = options.find((option) => option.value === typed);

    if (match) {
      add(match);
      search.value = '';
    }
  });

  chips.addEventListener('click', (event) => {
    if (event.target instanceof HTMLButtonElement) {
      event.target.closest('li').remove();
      search.focus();
    }
  });
}
