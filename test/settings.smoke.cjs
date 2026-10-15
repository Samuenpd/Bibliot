// Run with: electron test/settings.smoke.cjs
// Uses an isolated library and hidden window; never opens the user's library.
const { app, BrowserWindow, ipcMain } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createLibrary } = require("../electron/db.cjs");
const { createDataService } = require("../electron/data-service.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bibip-settings-smoke-"));
app.setPath("userData", path.join(root, "profile"));
let library, win;
let opened = 0, cleared = 0;
const pause = () => new Promise(resolve => setTimeout(resolve, 50));
const evaluate = source => win.webContents.executeJavaScript(source);
async function until(source) {
  for (let i = 0; i < 200; i++) {
    if (await evaluate(source)) return;
    await pause();
  }
  throw new Error(`Timed out: ${source}`);
}
const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
const type = value => evaluate(`{
  const input=document.getElementById('delete-library-confirmation');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
  input.dispatchEvent(new Event('input',{bubbles:true}));
}`);

app.whenReady().then(async () => {
  try {
    library = createLibrary(path.join(root, "library"));
    library.booksApi.add({ title: "Smoke test", author: "Test", pages: 100 });
    fs.writeFileSync(path.join(library.storageRoot, "covers", "test.jpg"), "test");
    const service = createDataService(() => library, async () => {});
    ipcMain.handle("books:getAll", () => library.booksApi.getAll());
    ipcMain.handle("tags:getAll", () => library.tagsApi.getAll());
    ipcMain.handle("settings:getStoragePath", () => library.storageRoot);
    ipcMain.handle("settings:openStoragePath", () => { opened++; });
    ipcMain.handle("data:clearLibrary", (_event, confirmation) => {
      cleared++;
      return service.clearLibrary(confirmation);
    });
    win = new BrowserWindow({ show: false, width: 1280, height: 1000, webPreferences: {
      preload: path.join(__dirname, "..", "electron", "preload.cjs"), contextIsolation: true, nodeIntegration: false,
    } });
    await win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Configurações')`);
    await click("Configurações");
    await until(`document.querySelector('h1')?.textContent==='Configurações'`);
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('main h2')).map(h=>h.textContent)`), [
      "Paleta de cores", "Atalhos de teclado", "Local de armazenamento", "Backup e restauração", "Importação e exportação", "Excluir tudo",
    ]);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('main h2')).slice(0,3).every(h=>h.parentElement.closest('section')===h.parentElement.parentElement||h.textContent==='Paleta de cores')`), true);
    await click("Abrir pasta");
    await until(`true`);
    assert.equal(opened, 1);
    await click("Excluir todos os dados");
    await until(`!!document.querySelector('[role="alertdialog"]')`);
    assert.equal(await evaluate(`document.querySelector('[role="alertdialog"] button[type="submit"]').disabled`), true);
    await type("BIBIP");
    await evaluate(`document.querySelector('[role="alertdialog"] form').requestSubmit()`);
    assert.equal(cleared, 0);
    assert.equal(library.booksApi.getAll().length, 1);
    await click("Cancelar");
    await until(`!document.querySelector('[role="alertdialog"]')`);
    assert.equal(library.booksApi.getAll().length, 1);
    await click("Excluir todos os dados");
    await until(`!!document.getElementById('delete-library-confirmation')`);
    assert.equal(await evaluate(`document.getElementById('delete-library-confirmation').value`), "");
    await type("bibip");
    await until(`!document.querySelector('[role="alertdialog"] button[type="submit"]').disabled`);
    await click("Confirmar exclusão");
    await until(`!document.querySelector('[role="alertdialog"]')`);
    assert.equal(cleared, 1);
    assert.deepEqual(library.booksApi.getAll(), []);
    assert.deepEqual(library.tagsApi.getAll(), []);
    assert.deepEqual(fs.readdirSync(path.join(library.storageRoot, "covers")), []);
    console.log("Settings smoke test passed: layout, open folder, cancel, typed confirmation, deletion.");
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    if (library) library.close();
  }
});
