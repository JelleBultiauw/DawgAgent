const { contextBridge, ipcRenderer, webUtils } = require('electron');

// De taal van de app wordt door het hoofdproces meegegeven bij het starten van dit venster,
// zodat de interface meteen in de juiste taal staat (geen Nederlandse flits vooraf).
const localeArg = process.argv.find((a) => a.startsWith('--orka-locale='));

contextBridge.exposeInMainWorld('orka', {
  locale: localeArg ? localeArg.split('=')[1] : 'nl',
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, fn) => {
    const handler = (_event, data) => fn(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
});
