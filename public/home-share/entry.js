/* global window */
'use strict';

// Old bookmarks use root-level hash routes. Marketing section anchors stay here.
function redirectLegacyRoute() {
  const { hash, search } = window.location;
  if (/^#\/(?:login|register|view\/[^/?#]+|market(?:\/[^?#]*)?|email-verified|email-verify-failed|email-verify-expired)(?:\?.*)?$/.test(hash)) {
    window.location.replace('/app/' + search + hash);
  }
}
redirectLegacyRoute();
window.addEventListener('hashchange', redirectLegacyRoute);
