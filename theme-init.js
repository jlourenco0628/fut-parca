(() => {
  let theme = 'light';
  try {
    if (localStorage.getItem('fut-parca-theme') === 'dark') theme = 'dark';
  } catch {}
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0c1b13' : '#f5f7f2');
})();
