export function ThemeScript() {
  const script = `
    (function() {
      var stored = localStorage.getItem('stockmind-theme') || 'light';
      document.documentElement.setAttribute('data-theme', stored);
    })();
  `;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
