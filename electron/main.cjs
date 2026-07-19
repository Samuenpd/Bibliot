// electron/main.cjs
const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");

let db, booksApi, tagsApi;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === "development") {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  // O "backend" (SQLite) só pode ser inicializado depois que o app está pronto,
  // pois depende de app.getPath("userData").
  ({ db, booksApi, tagsApi } = require("./db.cjs"));

  // ── Rotas do backend, expostas via IPC ──────────────────────────────
  // Envolvi cada rota num try/catch que loga o erro no terminal: se uma
  // escrita falhar (ex: SQLITE_BUSY, dado inválido etc), você vai VER o
  // erro no console em vez dela simplesmente sumir sem explicação.
  const wrap = (fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error("❌ Erro no backend:", err);
      throw err;
    }
  };

  ipcMain.handle("books:getAll", wrap(() => booksApi.getAll()));
  ipcMain.handle("books:add", wrap((_e, data) => booksApi.add(data)));
  ipcMain.handle("books:update", wrap((_e, id, data) => booksApi.update(id, data)));
  ipcMain.handle("books:delete", wrap((_e, id) => booksApi.delete(id)));
  ipcMain.handle("books:toggleRead", wrap((_e, id) => booksApi.toggleRead(id)));
  ipcMain.handle("books:toggleFavorite", wrap((_e, id) => booksApi.toggleFavorite(id)));

  ipcMain.handle("tags:getAll", wrap(() => tagsApi.getAll()));
  ipcMain.handle("tags:add", wrap((_e, data) => tagsApi.add(data)));
  ipcMain.handle("tags:update", wrap((_e, id, data) => tagsApi.update(id, data)));
  ipcMain.handle("tags:delete", wrap((_e, id) => tagsApi.delete(id)));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (db) {
    console.log("💾 Fechando o banco de dados...");
    db.close();
  }
  if (process.platform !== "darwin") app.quit();
});
