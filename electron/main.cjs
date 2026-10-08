// electron/main.cjs
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require("electron");

let library, booksApi, tagsApi, dataService;
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
    icon: path.join(__dirname, "..", "build", "icons", "icon.png"),
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
  const storageRoot = library?.storageRoot || app.getPath("userData");
  coversDir = path.join(storageRoot, "covers");
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

function imageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const size = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      if (size < 2) break;
      offset += size + 2;
    }
  }
  return { width: 0, height: 0 };
}

async function downloadBestImage(urls) {
  const candidates = await Promise.allSettled(urls.slice(0, 12).map(async (url) => {
    const res = await fetch(url);
    if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) throw new Error(`Capa inválida: ${url}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const dimensions = imageDimensions(buffer);
    return { buffer, contentType: res.headers.get("content-type") || "", score: dimensions.width * dimensions.height || buffer.length };
  }));
  const best = candidates
    .filter((candidate) => candidate.status === "fulfilled")
    .map((candidate) => candidate.value)
    .sort((a, b) => b.score - a.score)[0];
  if (!best) throw new Error("Nenhuma capa válida foi encontrada.");
  const ext = best.contentType.includes("png") ? ".png" : best.contentType.includes("webp") ? ".webp" : best.contentType.includes("gif") ? ".gif" : ".jpg";
  return saveBufferToCovers(best.buffer, ext);
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
    // Usa o parser de URL: com "standard: true" o nome do arquivo
    // em "cover://arquivo.jpg" é normalizado como host da URL.
    const parsedUrl = new URL(request.url);
    const filename = decodeURIComponent(parsedUrl.hostname);
    // Proteção básica contra path traversal: o valor vem da URL.
    if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      throw new Error(`Nome de arquivo de capa invalido: ${filename}`);
    }
    const filePath = path.join(coversDir, filename);
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

app.whenReady().then(() => {
  const { createLibrary } = require("./db.cjs");
  const { createDataService } = require("./data-service.cjs");
  const storageConfigPath = path.join(app.getPath("userData"), "storage.json");
  const configuredStoragePath = () => { try { return JSON.parse(fs.readFileSync(storageConfigPath, "utf8")).path || null; } catch { return null; } };
  const openLibrary = (root) => { library = createLibrary(root); booksApi = library.booksApi; tagsApi = library.tagsApi; coversDir = path.join(root, "covers"); };
  const announceChange = () => BrowserWindow.getAllWindows().forEach(win => win.webContents.send("library:changed"));
  const replaceLibrary = async (operation) => {
    const root=library.storageRoot; library.db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); library.close();
    try { await operation(root); openLibrary(root); announceChange(); }
    catch (error) { try { openLibrary(root); } catch {} throw error; }
  };
  openLibrary(configuredStoragePath() || app.getPath("userData"));
  dataService=createDataService(()=>library,replaceLibrary);

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
  ipcMain.handle("books:findDuplicates", wrap((_e, data, excludeId) => booksApi.findDuplicates(data, excludeId)));
  ipcMain.handle("books:getReadingSessions", wrap((_e, id) => booksApi.getReadingSessions(id)));
  ipcMain.handle("books:updateReading", wrap((_e, id, data) => booksApi.updateReading(id, data)));
  ipcMain.handle("books:startReread", wrap((_e, id, startedAt) => booksApi.startReread(id, startedAt)));
  ipcMain.handle("books:toggleFavorite", wrap((_e, id) => booksApi.toggleFavorite(id)));
  ipcMain.handle("books:getNotes", wrap((_e, bookId) => booksApi.getNotes(bookId)));
  ipcMain.handle("books:addNote", wrap((_e, bookId, content) => booksApi.addNote(bookId, content)));
  ipcMain.handle("books:updateNote", wrap((_e, id, content) => booksApi.updateNote(id, content)));
  ipcMain.handle("books:deleteNote", wrap((_e, id) => booksApi.deleteNote(id)));
  ipcMain.handle("books:getLoans", wrap((_e, bookId) => booksApi.getLoans(bookId)));
  ipcMain.handle("books:addLoan", wrap((_e, bookId, borrower, lentAt, dueAt) => booksApi.addLoan(bookId, borrower, lentAt, dueAt)));
  ipcMain.handle("books:returnLoan", wrap((_e, id) => booksApi.returnLoan(id)));

  ipcMain.handle("tags:getAll", wrap(() => tagsApi.getAll()));
  ipcMain.handle("tags:add", wrap((_e, data) => tagsApi.add(data)));
  ipcMain.handle("tags:update", wrap((_e, id, data) => tagsApi.update(id, data)));
  ipcMain.handle("tags:delete", wrap((_e, id) => tagsApi.delete(id)));
  ipcMain.handle("settings:getStoragePath", wrap(() => library.storageRoot));
  ipcMain.handle("settings:chooseStoragePath", wrap(async () => {
    const result = await dialog.showOpenDialog({ title: "Escolher pasta do acervo", properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || !result.filePaths[0]) return null;
    const destination = result.filePaths[0];
    const current = library.storageRoot;
    if (path.resolve(destination) === path.resolve(current)) return destination;
    fs.mkdirSync(destination,{recursive:true});const probe=path.join(destination,`.bibip-write-${process.pid}`);fs.writeFileSync(probe,"ok");fs.unlinkSync(probe);
    const existing=path.join(destination,"biblioteca.db");
    let mode="copy";
    if(fs.existsSync(existing)){const answer=await dialog.showMessageBox({type:"warning",title:"Biblioteca existente",message:"Já existe uma biblioteca nessa pasta.",detail:"Você pode usar a biblioteca existente. Nenhum arquivo será sobrescrito.",buttons:["Usar biblioteca existente","Cancelar"],defaultId:1,cancelId:1});if(answer.response!==0)return null;mode="existing";}
    else {const answer=await dialog.showMessageBox({type:"question",title:"Transferir biblioteca",message:"Como deseja usar a nova pasta?",detail:"Copiar mantém os arquivos atuais como segurança.",buttons:["Copiar biblioteca atual","Criar biblioteca vazia","Cancelar"],defaultId:0,cancelId:2});if(answer.response===2)return null;mode=answer.response===0?"copy":"empty";}
    library.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    if(mode==="copy"){fs.copyFileSync(library.dbPath,existing);const sourceCovers=path.join(current,"covers"),targetCovers=path.join(destination,"covers");if(fs.existsSync(sourceCovers))fs.cpSync(sourceCovers,targetCovers,{recursive:true});}
    const candidate=createLibrary(destination);if(!candidate.integrityCheck()){candidate.close();throw new Error("A biblioteca no novo local não passou na validação.");}candidate.close();
    library.close();
    try { openLibrary(destination); fs.writeFileSync(storageConfigPath,JSON.stringify({path:destination},null,2)); }
    catch(error){ openLibrary(current); throw error; }
    announceChange();
    return destination;
  }));

  ipcMain.handle("data:createBackup",wrap(async()=>{const result=await dialog.showSaveDialog({title:"Salvar backup completo",defaultPath:`Bi-Bip-backup-${new Date().toISOString().slice(0,10)}.zip`,filters:[{name:"Backup Bi-Bip",extensions:["zip"]}]});return result.canceled?null:dataService.createBackup(result.filePath);}));
  ipcMain.handle("data:selectBackup",wrap(async()=>{const result=await dialog.showOpenDialog({title:"Selecionar backup",properties:["openFile"],filters:[{name:"Backup Bi-Bip",extensions:["zip"]}]});if(result.canceled)return null;return {file:result.filePaths[0],manifest:dataService.validateBackup(result.filePaths[0])};}));
  ipcMain.handle("data:restoreBackup",wrap((_e,file)=>dataService.restoreBackup(String(file))));
  ipcMain.handle("data:export",wrap(async(_e,format)=>{if(!["csv","json"].includes(format))throw new Error("Formato inválido.");const result=await dialog.showSaveDialog({title:`Exportar catálogo em ${format.toUpperCase()}`,defaultPath:`Bi-Bip-catalogo.${format}`,filters:[{name:format.toUpperCase(),extensions:[format]}]});if(result.canceled)return null;return format==="csv"?dataService.exportCsv(result.filePath):dataService.exportJson(result.filePath);}));
  ipcMain.handle("data:selectImport",wrap(async()=>{const result=await dialog.showOpenDialog({title:"Importar catálogo",properties:["openFile"],filters:[{name:"Catálogo",extensions:["csv","json"]}]});return result.canceled?null:dataService.previewImport(result.filePaths[0]);}));
  ipcMain.handle("data:previewImport",wrap((_e,file,mapping)=>dataService.previewImport(String(file),mapping||{})));
  ipcMain.handle("data:confirmImport",wrap((_e,preview,selected)=>dataService.importRows(preview.rows,selected)));

  // ── Rotas de imagem ─────────────────────────────────────────────────
  ipcMain.handle("download-image-from-url", wrap((_e, url) => downloadImageFromUrl(url)));
  ipcMain.handle("download-best-image", wrap((_e, urls) => downloadBestImage(urls)));
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
  if (library) {
    console.log("💾 Fechando o banco de dados...");
    library.close();
  }
  if (process.platform !== "darwin") app.quit();
});
