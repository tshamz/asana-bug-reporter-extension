// console.log('\'Allo \'Allo! Event Page for Browser Action');

chrome.runtime.onInstalled.addListener(function (details) {
  console.log('previousVersion', details.previousVersion);
});

Asana.ExtensionServer.listen();
Asana.ServerModel.startPrimingCache();

// chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
//   chrome.tabs.sendMessage(tabs[0].id, {greeting: 'hello from background.js'}, function(response) {
//     console.log('dong');
//   });
// });

// chrome.tabs.captureVisibleTab(null, {}, (dataUrl) => {
//   console.log('screenshot taken.');
//   console.log(dataUrl);
// });

// chrome.runtime.onMessage.addListener(
//   function(request, sender, sendResponse) {
//     console.log(
//       sender.tab ?
//         'from a content script:' + sender.tab.url :
//         'from the extension'
//     );
//     if (request.greeting == 'hello') {
//       // sendResponse({farewell: 'goodbye'});
//       console.log('dong');
//     }
//     return true;
//   });

// Modify referer header sent to typekit, to allow it to serve to us.
// See http://stackoverflow.com/questions/12631853/google-chrome-extensions-with-typekit-fonts
// chrome.webRequest.onBeforeSendHeaders.addListener(function(details) {
//   var requestHeaders = details.requestHeaders;
//   for (var i = 0; i < requestHeaders.length; ++i) {
//     if (requestHeaders[i].name.toLowerCase() === 'referer') {
//       // The request was certainly not initiated by a Chrome extension...
//       return;
//     }
//   }
//   // Set Referer
//   requestHeaders.push({
//     name: 'referer',
//     // Host must match the domain in our Typekit kit settings
//     value: 'https://abkfopjdddhbjkiamjhkmogkcfedcnml'
//   });
//   return {
//     requestHeaders: requestHeaders
//   };
// }, {
//   urls: ['*://use.typekit.net/*'],
//   types: ['stylesheet', 'script']
// }, ['requestHeaders','blocking']);
