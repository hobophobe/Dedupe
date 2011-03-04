/* ***** BEGIN LICENSE BLOCK *****
 * Version: MIT/X11 License
 * 
 * Copyright (c) 2011 Adam Dane
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 *
 * Contributor(s):
 *   Adam Dane <unusualtears@gmail.com> (Original Author) 
 *
 *   Code from Restartless Restart extension (under the MIT/X11 license):
 *     Erik Vold <erikvvold@gmail.com>
 *     Greg Parris <greg.parris@gmail.com>
 *     Nils Maier <maierman@web.de>
 *
 * ***** END LICENSE BLOCK ***** */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");

const NS_XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

const TAB_EVENTS = [
  "TabPinned",
  "TabUnpinned",
  "TabHide",
  "TabShow",
  "TabOpen",
  "TabClose",
  "TabAttrModified"
];

(function(global) global.include = function include(src) (
    Services.scriptloader.loadSubScript(src, global)))(this);

function handleRetitle (aEvent) {
  let tabbrowser = this.tabbox.parentNode;
  if (tabbrowser) {
    setTabTitles(tabbrowser);
  }
}

// This is used for RTL part of the code.
// FIXME Should it memoize?
function getStringForTab (aTab) {
  let browser = aTab.linkedBrowser;
  let title = browser.contentTitle;
  if (aTab.direction == "rtl") {
    let stringArray = title.split('').reverse();
    return stringArray.join('');
  }
  else {
    return title;
  }
}

function getChopsInSet(aTabSet, aDomain) {
  // chopList associates a tab with its cutpoint.
  let chopList = {};
  // Sort the current domain's tabs by titles
  aTabSet.sort(function(aTab, bTab) {
    let aTabLabel = getStringForTab(aTab);
    let bTabLabel = getStringForTab(bTab);
    if (aTabLabel < bTabLabel) {
      return -1;
    }
    else if (aTabLabel > bTabLabel) {
      return 1;
    }
    else {
      return 0;
    }
  });

  // build and apply the chopList for the domain
  for (let i = 0; i < aTabSet.length; i++) {
    let tab = aTabSet[i];
    let tabString = getStringForTab(tab);
    let panel = tab.linkedPanel;
    if (!chopList[panel]) {
      chopList[panel] = [tab, 0];
    }
    if (i == aTabSet.length - 1) {
      break;
    }
    // We have tabs beyond the current one
    let next = i + 1;
    let nextTab = aTabSet[next];
    let nextString = getStringForTab(nextTab);

    // Treat neighbors with same title as ourselves
    let allTabsSame = false;
    while (tabString == nextString) {
      next += 1;
      if (next == aTabSet.length) {
        allTabsSame = true;
        break;
      }
      else {
        nextTab = aTabSet[next];
        nextString = getStringForTab(nextTab);
      }
    }
    if (allTabsSame) {
      let chopAt = 0;
      if (chopList[panel]) {
        chopAt = chopList[panel][1];
      }
      aTabSet.slice(i).forEach(function(aTab) {
        let panel = aTab.linkedPanel;
        if (!chopList[panel] || chopAt > chopList[panel][1]) {
          chopList[panel] = [aTab, chopAt];
        }
      });
      break;
    }

    let maxChop = 0;
    let tabParts = tabString.split(' ');
    let nextParts = nextString.split(' ');

    // Ensure that any chop happen before some part of the title that's
    // identical (ie, don't make it worse)
    let tabLast = tabParts.length - 1;
    let nextLast = nextParts.length - 1;
    let shorter = Math.min(tabLast, nextLast);
    for (let j = 0; j < shorter; j++) {
      if (tabParts[tabLast - j] != nextParts[nextLast - j]) {
        maxChop = tabLast - j;
        break;
      }
    }

    // Check for sameness at the front; get chop point
    for (let j = 0; j < tabParts.length; j++) {
      if (tabParts[j] != nextParts[j]) {
        if (j > 0) {
          // Found a chop, mark all the relevant tabs
          let chopAt = j > maxChop ? maxChop : j;
          aTabSet.slice(i, next + 1).forEach(function(aTab) {
            let panel = aTab.linkedPanel;
            if (!chopList[panel] || j > chopList[panel][1]) {
              chopList[panel] = [aTab, chopAt];
            }
          });
        }
        else {
          // No chop, mark as unchoppable.
          aTabSet.slice(i, next + 1).forEach(function(aTab) {
            let panel = aTab.linkedPanel;
            if (!chopList[panel]) {
              chopList[panel] = [aTab, 0];
            }
          });
        }
        break;
      }
    }
  }
  return chopList;
}

function applyChoplist(aTabbrowser, aChoplist) {
  aTabbrowser.tabContainer.removeEventListener(
    "TabAttrModified", handleRetitle, false);
  for (chopEntry in aChoplist) {
    let tab = aChoplist[chopEntry][0]
    let chop = aChoplist[chopEntry][1];
    let title = getStringForTab(tab);
    if (title.length == 0) {
      continue;
    }
    let newLabelArray = title.split(' ');
    if (chop > 0) {
      let preAdjustedChop = chop;
      while (chop > 0 && newLabelArray[chop] == "-") {
        chop--;
      }
      if (chop == 0) {
        chop = preAdjustedChop;
      }
    }
    let newLabel = newLabelArray.slice(chop).join(' ');
    if (chop > 0) {
      dump(newLabelArray.slice(0, chop).join(' ') + " :: " + title + "\n\n");
    }
    if (tab.direction == "rtl") {
      newLabel = reverseString(newLabel);
    }
    tab.setAttribute("label", newLabel);
    aTabbrowser._tabAttrModified(tab);
  }
  aTabbrowser.tabContainer.addEventListener(
    "TabAttrModified", handleRetitle, false);
}

function getDomainForTab(aTab) {
  let eTLDSVC = Cc["@mozilla.org/network/effective-tld-service;1"]
               .getService(Ci.nsIEffectiveTLDService);
  let browserURI = aTab.linkedBrowser.currentURI;
  let tabDomain = "unknown";
  switch (browserURI.scheme)
  {
  case "file":
  case "about":
  case "chrome":
  // FIXME how to modify to work with '/' separator?
  // Does Windows use \ for the path? ("file://C:\foo\")
  // What if a webapp file browser sets file paths as titles via script?
    tabDomain = browserURI.scheme;
    break;
  default:
    try {
      tabDomain = eTLDSVC.getBaseDomain(browserURI);
    }
    catch (e) {
      try {
        tabDomain = browserURI.host;
      }
      catch (ex) {}
    }
  }
  return tabDomain;
}

// Retitles the given tabs
  // FIXME new event for before this fires?
  // FIXME only include tabs that are actually visible?
  // FIXME only include tabs with labels that are currently cropped?
  // FIXME RTL needs testing/lookover by someone that's done RTL stuff before
  // FIXME handling sites that try to use the titlebar as a marquee?
        // Initial tests show this is fast enough to handle that case, assuming
        // that the site isn't scrolling fast enough to degrade performance on
        // its own.  If it is, though, this will only make it negligibly worse.

function setTabTitles (tabbrowser) {
  // Start by getting an array of arrays
  // Each subarray contains the index and full content title
  let visTabs = tabbrowser.visibleTabs;
  let startDate = Date.now();

  // Put the tabs into bins by domain
  let domainSets = {};
  visTabs.forEach(function(aTab) {
    if (aTab.pinned || aTab.linkedBrowser.contentTitle.length === 0) {
      return;
    }
    let tabDomain = getDomainForTab(aTab);
    if (tabDomain in domainSets) {
      domainSets[tabDomain].push(aTab);
    }
    else {
      domainSets[tabDomain] = [aTab];
    }
  });

  for (domain in domainSets) {
    if (domain == "unknown") {
      continue;
    }
    let tabSet = domainSets[domain];
    let chopList = getChopsInSet(tabSet, domain);
    applyChoplist(tabbrowser, chopList);
  }
  let event = tabbrowser.contentDocument.createEvent("Events");
  event.initEvent("TabsRelabeled", true, false);
  tabbrowser.dispatchEvent(event);

  dump("took " + ((Date.now() - startDate) / 1000) +
       " seconds for " + visTabs.length + " tabs\n");
}

function resetTabTitles (tabbrowser) {
  tabbrowser.visibleTabs.forEach(function(tab) {
    tab.label = tabbrowser.getBrowserForTab(tab).contentTitle;
  });
}

function attach2 (win) {
  attach(win, true);
}

function attach (win, setNow) {
  let tabs = win.document.getElementById("tabbrowser-tabs");
  if (tabs) {
    TAB_EVENTS.forEach(function(aEvent) {
      tabs.addEventListener(aEvent, handleRetitle, false);
    });
    unload(function() { clean(tabs); }, win);
    if (setNow) {
      setTabTitles(tabs.tabbox.parentNode);
    }
  }
}

function clean (tabs) {
  TAB_EVENTS.forEach(function(aEvent) {
    tabs.removeEventListener(aEvent, handleRetitle, false);
  });
  resetTabTitles(tabs.tabbox.parentNode);
}

function startup (data, reason) {
  AddonManager.getAddonByID(data.id, function(addon) {
    include(addon.getResourceURI("includes/utils.js").spec);
    if (reason === ADDON_ENABLE) {
      watchWindows(attach2);
    }
    else {
      watchWindows(attach);
    }
  });
}

function shutdown (data, reason) {
  if (reason !== APP_SHUTDOWN) unload();
}

function install (data, reason) {
}

function uninstall (data, reason) {
}
