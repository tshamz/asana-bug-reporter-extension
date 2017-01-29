console.log('\'Allo \'Allo! Content script');

// chrome.runtime.sendMessage({greeting: 'hello from contentscript.js'}, function(response) {
//   console.log('ding');
// });

chrome.runtime.onMessage.addListener(
  function(request, sender, sendResponse) {
    console.log(
      sender.tab ?
        'from a content script:' + sender.tab.url :
        'from the extension'
    );
    if (request.greeting == 'hello') {
      // sendResponse({farewell: 'goodbye'});
      console.log('ding');
    }
    return true;
  });
