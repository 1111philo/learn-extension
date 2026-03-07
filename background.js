chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle screenshot capture requests from the side panel
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'captureScreenshot') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' })
      .then(dataUrl => sendResponse({ dataUrl }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // keep channel open for async response
  }
});
