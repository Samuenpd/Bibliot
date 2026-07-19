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
  },
  tags: {
    getAll: () => ipcRenderer.invoke("tags:getAll"),
    add: (data) => ipcRenderer.invoke("tags:add", data),
    update: (id, data) => ipcRenderer.invoke("tags:update", id, data),
    delete: (id) => ipcRenderer.invoke("tags:delete", id),
  },
});
