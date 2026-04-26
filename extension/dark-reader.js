/* Zing — Dark Reader (document_start content script)
   Sole job: listen for ESC and ask background to remove dark-reader CSS for this tab. */
(function () {
  'use strict';
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    try {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({ type: 'DARK_READER_ESC' });
      }
    } catch (_) {}
  }, true);
})();
