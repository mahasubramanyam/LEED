(function () {
  try {
    if (localStorage.getItem('leed_theme_v3') === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {}
})();
