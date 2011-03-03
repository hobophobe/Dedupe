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
  let tabString = aTab.linkedBrowser.contentTitle;
  if (aTab.direction == "rtl") {
    let stringArray = tabString.split('').reverse();
    return stringArray.join('');
  }
  else {
    return tabString;
  }
}

function getChopsInSet(aTabSet, aDomain) {
// chopList associates a tab with its cutpoint.
  let chopList = {};
  // Phase 2.1: Sort the current domain's tabs by titles
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

  // Phase 2.2: build and apply the chopList for the domain
  for (let i = 0; i < aTabSet.length; i++) {
    let tab = aTabSet[i];
    let tabString = getStringForTab(tab);
    let panel = tab.linkedPanel;
    if (!chopList[panel]) {
      chopList[panel] = [tab, 0];
    }
    let end = aTabSet.length;
    if (i == end - 1) {
      break;
    }
    // We have tabs beyond the current one
    let next = i + 1;
    let nextTab = aTabSet[next];
    let nextString = getStringForTab(nextTab);

    // Phase 2.2.1: Treat neighbors with same title as ourselves
    let allTabsSame = false;
    while (tabString == nextString) {
      next += 1;
      if (next == end) {
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
      aTabSet.slice(index + 1).forEach(function(aTab) {
        let panel = aTab.linkedPanel;
        chopList[panel] = [aTab, chopAt];
      });
      break;
    }
    let maxChop = 0;
    let tabParts = tabString.split(' ');
    let nextParts = nextString.split(' ');

    // Phase 2.2.2: Ensure that any cuts happen before some part
    // of the title that's identical (ie, don't make it worse)
    let tabLast = tabParts.length - 1;
    let nextLast = nextParts.length - 1;
    let shorter = Math.min(tabLast, nextLast);
    for (let j = 0; j < shorter; j++) {
      if (tabParts[tabLast - j] != nextParts[nextLast - j]) {
        maxChop = tabLast - j;
        break;
      }
    }

    // Phase 2.2.3: Check for sameness at the front; get chop point
    for (let j = 0; j <= maxChop && j < tabParts.length; j++) {
      if (tabParts[j] != nextParts[j]) {
        if (j > 0 && j <= maxChop) {
        // FIXME should preclude chops at "- Happy Fun Ball"
        // Regex?
        // Phase 2.2.3.2: Found a chop, mark all the relevant tabs
          aTabSet.slice(i, next + 1).forEach(function(tab) {
            let panel = tab.linkedPanel;
            if (!chopList[panel] || j > chopList[panel][1]) {
              chopList[panel] = [tab, j];
            }
            else {
              dump("earlier chop override at 2.2.3.2\n");
            }
          });
        }
        else {
          // Phase 2.2.3.3: No chop, mark as unchoppable.
          aTabSet.slice(i, next + 1).forEach(function(tab) {
            let panel = tab.linkedPanel;
            if (!chopList[panel]) {
              chopList[panel] = [tab, 0];
            }
            else {
              dump("earlier chop override at 2.2.3.3\n");
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
    let newLabel = title.split(' ').slice(chop).join(' ');
    if (tab.direction == "rtl") {
      newLabel = reverseString(newLabel);
    }
    tab.label = newLabel;
    aTabbrowser._tabAttrModified(tab);
  }
  aTabbrowser.tabContainer.addEventListener(
    "TabAttrModified", handleRetitle, false);
}

function getDomainForTab(aTab) {
  let eTLDSVC =
      Cc["@mozilla.org/network/effective-tld-service;1"].getService(
        Ci.nsIEffectiveTLDService);
  let browserURI = aTab.linkedBrowser.currentURI;
  let tabDomain = "unknown";
  switch (browserURI.scheme)
  {
  case "about":
  case "chrome":
  case "file":
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
  // FIXME only include tabs that are actually visible?
  // FIXME only include tabs with labels that are currently cropped?
  // FIXME skip selected?
  // FIXME RTL needs testing/lookover by someone that's done RTL stuff before
  // FIXME new event for before this fires?
  // FIXME handling sites that try to use the titlebar as a marquee?

function setTabTitles (tabbrowser) {
  // Start by getting an array of arrays
  // Each subarray contains the index and full content title

  let visTabs = tabbrowser.visibleTabs;

  // Phase 1: Put the tabs into bins by domain
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

  // Phase 2: Process each domain
  for (domain in domainSets) {
    if (domain == "unknown") {
      continue;
    }
    let tabSet = domainSets[domain];
    let chopList = getChopsInSet(tabSet, domain);

    // Phase 2.2.4: Apply the chopList
    applyChoplist(tabbrowser, chopList);
  }
  let event = document.createEvent("Events");
  event.initEvent("TabsRelabeled", true, false);
  this.dispatchEvent(event);
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
