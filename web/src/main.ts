// App shell entry (web-contract.md §1). The shell enables only the parts named by the subject config
// and mounts the active one. This is the scaffolding entry; part wiring lands with the first module.
const app = document.getElementById("app");
if (app) {
  app.textContent = "learning-harness web — scaffolding ready";
}
