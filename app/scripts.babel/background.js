chrome.runtime.onInstalled.addListener(function (details) {
  console.log('previousVersion', details.previousVersion);
});

Asana.ExtensionServer.listen();
Asana.ServerModel.startPrimingCache();
