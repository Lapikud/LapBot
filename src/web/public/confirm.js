document.addEventListener('submit', (event) => {
  const message = event.submitter?.dataset.confirm;

  if (message !== undefined && !window.confirm(message)) {
    event.preventDefault();
  }
});
