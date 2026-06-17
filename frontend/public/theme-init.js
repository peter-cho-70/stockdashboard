(function () {
  try {
    var t = localStorage.getItem("stockmind-theme") || "light";
    document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
