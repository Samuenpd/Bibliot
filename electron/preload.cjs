// electron/preload.cjs
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  books: {
    getAll: () => ipcRenderer.invoke("books:getAll"),
    add: (data) => ipcRenderer.invoke("books:add", data),
    update: (id, data) => ipcRenderer.invoke("books:update", id, data),
    delete: (id) => ipcRenderer.invoke("books:delete", id),
    toggleRead: (id) => ipcRenderer.invoke("books:toggleRead", id),
    toggleFavorite: (id) => ipcRenderer.invoke("books:toggleFavorite", id),
    getNotes: (bookId) => ipcRenderer.invoke("books:getNotes", bookId),
    addNote: (bookId, content) => ipcRenderer.invoke("books:addNote", bookId, content),
    updateNote: (id, content) => ipcRenderer.invoke("books:updateNote", id, content),
    deleteNote: (id) => ipcRenderer.invoke("books:deleteNote", id),
    getLoans: (bookId) => ipcRenderer.invoke("books:getLoans", bookId),
    addLoan: (bookId, borrower, lentAt, dueAt) => ipcRenderer.invoke("books:addLoan", bookId, borrower, lentAt, dueAt),
    returnLoan: (id) => ipcRenderer.invoke("books:returnLoan", id),
  },
  tags: {
    getAll: () => ipcRenderer.invoke("tags:getAll"),
    add: (data) => ipcRenderer.invoke("tags:add", data),
    update: (id, data) => ipcRenderer.invoke("tags:update", id, data),
    delete: (id) => ipcRenderer.invoke("tags:delete", id),
  },
  settings: {
    getStoragePath: () => ipcRenderer.invoke("settings:getStoragePath"),
    chooseStoragePath: () => ipcRenderer.invoke("settings:chooseStoragePath"),
  },
  downloadImage: (url) => ipcRenderer.invoke("download-image-from-url", url),
  saveImageFromPath: (path) => ipcRenderer.invoke("save-image-from-path", path),
  saveImageFromBuffer: (buffer) => ipcRenderer.invoke("save-image-from-buffer", buffer),
  selectImage: () => ipcRenderer.invoke("select-image-dialog"),
});
