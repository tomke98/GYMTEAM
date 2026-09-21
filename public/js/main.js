// Client-side JS placeholder — form validation and confirm dialogs added as needed

document.querySelectorAll('[data-confirm]').forEach(function(btn) {
  btn.closest('form').addEventListener('submit', function(e) {
    if (!window.confirm(btn.dataset.confirm)) e.preventDefault()
  })
})
