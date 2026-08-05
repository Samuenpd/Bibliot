// electron/main.cjs
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require("electron");

let db, booksApi, tagsApi;
let coversDir;

// Define o nome do app para que o diretório no AppData seja "Bi-Bip"
// (em vez do nome do package.json "bi-bip").
app.setName("Bi-Bip");

// Registra o protocolo customizado como privilegiado (necessário para
// carregar imagens locais sem bloqueios de CSP).
protocol.registerSchemesAsPrivileged([
  {
    scheme: "cover",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

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

// ── Helpers de imagem ────────────────────────────────────────────────────────

function ensureCoversDir() {
  coversDir = path.join(app.getPath("userData"), "covers");
  if (!fs.existsSync(coversDir)) {
    fs.mkdirSync(coversDir, { recursive: true });
  }
  return coversDir;
}

function uniqueFileName(ext = ".jpg") {
  return `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
}

function toCoverUrl(filename) {
  // Retorna a URL no formato cover://filename
  return `cover://${filename}`;
}

function saveBufferToCovers(buffer, ext = ".jpg") {
  const dir = ensureCoversDir();
  const name = uniqueFileName(ext);
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, buffer);
  return toCoverUrl(name);
}

async function downloadImageFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar imagem: ${res.status} ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("content-type") || "";
  let ext = ".jpg";
  if (contentType.includes("png")) ext = ".png";
  else if (contentType.includes("webp")) ext = ".webp";
  else if (contentType.includes("gif")) ext = ".gif";
  return saveBufferToCovers(buffer, ext);
}

function copyFileToCovers(srcPath) {
  const dir = ensureCoversDir();
  const ext = path.extname(srcPath).toLowerCase() || ".jpg";
  const name = uniqueFileName(ext);
  const dest = path.join(dir, name);
  fs.copyFileSync(srcPath, dest);
  return toCoverUrl(name);
}

// ── Protocolo customizado cover:// ───────────────────────────────────────────

function registerCoverProtocol() {
  protocol.handle("cover", (request) => {
    const filename = request.url.replace("cover://", "");
    const filePath = path.join(coversDir, filename);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

app.whenReady().then(() => {
  // O "backend" (SQLite) só pode ser inicializado depois que o app está pronto,
  // pois depende de app.getPath("userData").
  ({ db, booksApi, tagsApi } = require("./db.cjs"));

  ensureCoversDir();
  registerCoverProtocol();

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

  // ── Rotas de imagem ─────────────────────────────────────────────────
  ipcMain.handle("download-image-from-url", wrap((_e, url) => downloadImageFromUrl(url)));
  ipcMain.handle("save-image-from-path", wrap((_e, filePath) => copyFileToCovers(filePath)));
  ipcMain.handle("save-image-from-buffer", wrap((_e, buffer) => {
    const buf = Buffer.from(buffer);
    return saveBufferToCovers(buf);
  }));
  ipcMain.handle("select-image-dialog", wrap(async () => {
    const result = await dialog.showOpenDialog({
      title: "Selecionar capa",
      filters: [
        { name: "Imagens", extensions: ["jpg", "jpeg", "png", "webp"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return copyFileToCovers(result.filePaths[0]);
  }));

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