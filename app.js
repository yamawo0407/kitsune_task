function showView(name) {
  document.querySelectorAll(".view").forEach(v => {
    v.classList.add("hidden");
  });

  const target = document.getElementById("view-" + name);
  if (target) target.classList.remove("hidden");
}

function route() {
  const hash = location.hash.replace("#", "") || "home";
  showView(hash);
}

window.addEventListener("hashchange", route);
window.addEventListener("load", route);
