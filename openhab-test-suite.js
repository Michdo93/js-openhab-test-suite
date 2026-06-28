/**
 * js-openhab-test-suite
 * ─────────────────────
 * Browser-side test suite for openHAB, powered by js-openhab-rest-client.
 * Mirrors the Python openhab-test-suite: same class names, same method names.
 *
 * All methods return Promise<boolean> unless noted.
 * SSE-based tests (testSwitch, testDimmer, …) open a ReadableStream internally
 * and time out after `timeoutSec` seconds.
 *
 * Usage:
 *   const client    = new OpenHABClient("https://myopenhab.org", "user", "pass");
 *   const itemTest  = new ItemTester(client);
 *   const ok        = await itemTest.testSwitch("MySwitch", "ON", "ON", 10);
 */

"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _parseJson(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

async function _parseResponse(rawOrPromise) {
  const raw = rawOrPromise instanceof Promise ? await rawOrPromise : rawOrPromise;
  return _parseJson(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// ItemTester
// ─────────────────────────────────────────────────────────────────────────────

class ItemTester {
  constructor(client) {
    this._items      = new Items(client);
    this._itemEvents = new ItemEvents(client);
  }

  // ── Static validators ──────────────────────────────────────────────────────

  static isValidSwitchValue(v) {
    return typeof v === "string" && ["ON","OFF"].includes(v.trim().toUpperCase());
  }
  static isValidContactValue(v) {
    return typeof v === "string" && ["OPEN","CLOSED"].includes(v.trim().toUpperCase());
  }
  static isValidDimmerValue(v) {
    if (!v) return false;
    const u = String(v).trim().toUpperCase();
    if (["ON","OFF","INCREASE","DECREASE"].includes(u)) return true;
    const n = parseFloat(u);
    return !isNaN(n) && n >= 0 && n <= 100;
  }
  static isValidRollershutterValue(v) {
    if (!v) return false;
    const u = String(v).trim().toUpperCase();
    if (["UP","DOWN","STOP","MOVE"].includes(u)) return true;
    const n = parseFloat(u);
    return !isNaN(n) && n >= 0 && n <= 100;
  }
  static isValidColorValue(v) {
    if (!v) return false;
    const u = String(v).trim().toUpperCase();
    if (["ON","OFF","INCREASE","DECREASE"].includes(u)) return true;
    const parts = String(v).trim().split(",");
    if (parts.length === 3) {
      const [h,s,b] = parts.map(Number);
      return !isNaN(h)&&!isNaN(s)&&!isNaN(b) &&
             h>=0&&h<=360 && s>=0&&s<=100 && b>=0&&b<=100;
    }
    return false;
  }
  static isValidPlayerValue(v) {
    return typeof v === "string" &&
      ["PLAY","PAUSE","NEXT","PREVIOUS","REWIND","FASTFORWARD"]
        .includes(v.trim().toUpperCase());
  }
  static isValidNumberValue(v) {
    if (v == null) return false;
    return /^-?\d+(\.\d+)?(\s+\S+)?$/.test(String(v).trim());
  }
  static isValidDateTimeValue(v) {
    return typeof v === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(v.trim());
  }
  static isValidLocationValue(v) {
    if (!v) return false;
    const parts = String(v).trim().split(",");
    if (parts.length < 2 || parts.length > 3) return false;
    const lat = parseFloat(parts[0]), lon = parseFloat(parts[1]);
    return !isNaN(lat)&&!isNaN(lon) && lat>=-90&&lat<=90 && lon>=-180&&lon<=180;
  }
  static isValidImageValue(v) {
    return typeof v === "string" &&
      (v.startsWith("http://") || v.startsWith("https://") ||
       /^data:image\/[a-zA-Z+]+;base64,/.test(v));
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async doesItemExist(itemName) {
    try {
      const item = await _parseResponse(this._items.getItem(itemName));
      if (item && item.name === itemName) return true;
    } catch {}
    console.error(`Error: The item '${itemName}' does not exist!`);
    return false;
  }

  async checkItemIsType(itemName, itemType) {
    const valid = ["Color","Contact","DateTime","Dimmer","Group","Image",
                   "Location","Number","Player","Rollershutter","String","Switch"];
    if (!valid.includes(itemType)) {
      console.error(`Error: '${itemType}' is not a valid item type.`);
      return false;
    }
    try {
      const item   = await _parseResponse(this._items.getItem(itemName));
      if (!item) { console.error(`Error: item '${itemName}' not found.`); return false; }
      const actual = item.type || "";
      const base   = actual.includes(":") ? actual.split(":")[0] : actual;
      if (base === itemType) return true;
      console.error(`Error: '${itemName}' is type '${actual}', expected '${itemType}'.`);
    } catch (e) {
      console.error(`Error checking type of '${itemName}': ${e.message}`);
    }
    return false;
  }

  async checkItemHasState(itemName, expected) {
    try {
      const state = await this._items.getItemState(itemName);
      return String(state) === String(expected);
    } catch { return false; }
  }

  async isGroupItem(itemName) { return this.checkItemIsType(itemName, "Group"); }

  async getGroupMembers(groupName) {
    try {
      const item = await _parseResponse(this._items.getItem(groupName, { recursive: true }));
      return item?.members || [];
    } catch (e) {
      console.error(`Error reading group '${groupName}': ${e.message}`);
      return [];
    }
  }

  async doesGroupContainMember(groupName, memberName) {
    const members = await this.getGroupMembers(groupName);
    return members.some(m => m.name === memberName);
  }

  async checkGroupMemberState(groupName, memberName, expectedState) {
    const members = await this.getGroupMembers(groupName);
    const m       = members.find(m => m.name === memberName);
    return m ? String(m.state) === String(expectedState) : false;
  }

  // ── Per-type test methods ──────────────────────────────────────────────────

  async testSwitch(itemName, command, expectedState = null, timeoutSec = 10) {
    if (!await this.checkItemIsType(itemName, "Switch")) return false;
    if (!ItemTester.isValidSwitchValue(command)) {
      console.error(`Invalid Switch command '${command}'. Use ON or OFF.`); return false;
    }
    return this._runTest(itemName, "Switch", command, expectedState, timeoutSec);
  }

  async testContact(itemName, update = null, expectedState = null, timeoutSec = 10) {
    if (!await this.checkItemIsType(itemName, "Contact")) return false;
    if (update && !ItemTester.isValidContactValue(update)) {
      console.error(`Invalid Contact update '${update}'. Use OPEN or CLOSED.`); return false;
    }
    return this._runTest(itemName, "Contact", update, expectedState, timeoutSec);
  }

  async testColor(itemName, command, expectedState = null, timeoutSec = 10) {
    if (!await this.checkItemIsType(itemName, "Color")) return false;
    if (!ItemTester.isValidColorValue(command)) {
      console.error(`Invalid Color command '${command}'.`); return false;
    }
    return this._runTest(itemName, "Color", command, expectedState, timeoutSec);
  }

  async testDimmer(itemName, command, expectedState = null, timeoutSec = 10) {
    if (!await this.checkItemIsType(itemName, "Dimmer")) return false;
    if (!ItemTester.isValidDimmerValue(command)) {
      console.error(`Invalid Dimmer command '${command}'.`); return false;
    }
    return this._runTest(itemName, "Dimmer", command, expectedState, timeoutSec);
  }

  async testRollershutter(itemName, command, expectedState = null, timeoutSec = 10) {
    if (!await this.checkItemIsType(itemName, "Rollershutter")) return false;
    if (!ItemTester.isValidRollershutterValue(command)) {
      console.error(`Invalid Rollershutter command '${command}'.`); return false;
    }
    return this._runTest(itemName, "Rollershutter", command, expectedState, timeoutSec);
  }

  async testNumber(itemName, command, expectedState = null, timeoutSec = 10) {
    if (!await this.checkItemIsType(itemName, "Number")) return false;
    if (!ItemTester.isValidNumberValue(command)) {
      console.error(`Invalid Number command '${command}'.`); return false;
    }
    return this._runTest(itemName, "Number", command, expectedState, timeoutSec);
  }

  async testPlayer(itemName, command, expectedState = null, timeoutSec = 10) {
    if (!await this.checkItemIsType(itemName, "Player")) return false;
    if (!ItemTester.isValidPlayerValue(command)) {
      console.error(`Invalid Player command '${command}'.`); return false;
    }
    return this._runTest(itemName, "Player", command, expectedState, timeoutSec);
  }

  async testDateTime(itemName, command, expectedState = null, timeoutSec = 10) {
    if (!await this.checkItemIsType(itemName, "DateTime")) return false;
    if (!ItemTester.isValidDateTimeValue(command)) {
      console.error(`Invalid DateTime command '${command}'. Use ISO-8601.`); return false;
    }
    return this._runTest(itemName, "DateTime", command, expectedState, timeoutSec);
  }

  async testLocation(itemName, update, expectedState = null, timeoutSec = 10) {
    if (!await this.checkItemIsType(itemName, "Location")) return false;
    if (!ItemTester.isValidLocationValue(update)) {
      console.error(`Invalid Location update '${update}'.`); return false;
    }
    return this._runTest(itemName, "Location", update, expectedState, timeoutSec);
  }

  async testImage(itemName, command, expectedState = null, timeoutSec = 10) {
    if (!await this.checkItemIsType(itemName, "Image")) return false;
    if (!ItemTester.isValidImageValue(command)) {
      console.error(`Invalid Image command '${command}'.`); return false;
    }
    return this._runTest(itemName, "Image", command, expectedState, timeoutSec);
  }

  async testString(itemName, command, expectedState = null, timeoutSec = 10) {
    if (!await this.checkItemIsType(itemName, "String")) return false;
    if (command == null) {
      console.error("Command for String item must not be null."); return false;
    }
    return this._runTest(itemName, "String", command, expectedState, timeoutSec);
  }

  // ── Private core ───────────────────────────────────────────────────────────

  async _runTest(itemName, itemType, commandOrUpdate, expectedState, timeoutSec) {
    let initialState = null;
    let result       = false;
    const isUpdateOnly = ["Contact","Location"].includes(itemType);

    try {
      if (commandOrUpdate != null) {
        try { initialState = await this._items.getItemState(itemName); }
        catch { console.warn(`Warning: could not read initial state of '${itemName}'.`); }
      }

      // Open SSE before sending so we don't miss the event
      const response = await this._itemEvents.ItemStateChangedEvent(itemName);
      const reader   = response.body.getReader();
      const decoder  = new TextDecoder();

      // Send command / update
      if (commandOrUpdate != null) {
        if (isUpdateOnly) await this._items.postUpdate(itemName, commandOrUpdate);
        else              await this._items.sendCommand(itemName, commandOrUpdate);
      }

      if (expectedState == null) {
        result = true;
        reader.cancel();
      } else {
        // Read SSE stream with timeout
        const deadline = Date.now() + timeoutSec * 1000;
        let   buf      = "";
        outer: while (Date.now() < deadline) {
          const timeout   = new Promise(r => setTimeout(() => r({ done: true }), 500));
          const { done, value } = await Promise.race([reader.read(), timeout]);
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          for (const line of buf.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            buf = "";
            try {
              const event   = JSON.parse(line.slice(6));
              if (event.type !== "ItemStateChangedEvent") continue;
              const payload = JSON.parse(event.payload);
              if (String(payload.value) === String(expectedState)) {
                console.log(`OK: '${itemName}' reached state '${payload.value}'.`);
                result = true;
                reader.cancel();
                break outer;
              }
            } catch { /* malformed event */ }
          }
        }
        if (!result) {
          reader.cancel();
          result = await this.checkItemHasState(itemName, expectedState);
          if (!result)
            console.error(
              `Error: state of '${itemName}' is not '${expectedState}' after ${timeoutSec}s.`);
        }
      }
    } catch (e) {
      console.error(`Error testing '${itemName}': ${e.message}`);
    } finally {
      await this._resetItem(itemName, itemType, initialState);
    }
    return result;
  }

  async _resetItem(itemName, itemType, initialState) {
    if (initialState == null) return;
    try {
      if (["Contact","Location"].includes(itemType))
        await this._items.postUpdate(itemName, initialState);
      else
        await this._items.sendCommand(itemName, initialState);
    } catch (e) {
      console.warn(`Warning: could not reset '${itemName}' to '${initialState}': ${e.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ThingTester
// ─────────────────────────────────────────────────────────────────────────────

class ThingTester {
  constructor(client) { this._things = new Things(client); }

  async getThingStatus(thingUID) {
    try {
      const thing = await _parseResponse(this._things.getThing(thingUID));
      return thing?.statusInfo?.status ?? "UNKNOWN";
    } catch (e) {
      console.error(`Error reading status of '${thingUID}': ${e.message}`);
      return "UNKNOWN";
    }
  }

  async isThingStatus(thingUID, status) {
    return (await this.getThingStatus(thingUID)) === status;
  }

  async isThingOnline(uid)        { return this.isThingStatus(uid, "ONLINE"); }
  async isThingOffline(uid)       { return this.isThingStatus(uid, "OFFLINE"); }
  async isThingPending(uid)       { return this.isThingStatus(uid, "PENDING"); }
  async isThingUnknown(uid)       { return this.isThingStatus(uid, "UNKNOWN"); }
  async isThingUninitialized(uid) { return this.isThingStatus(uid, "UNINITIALIZED"); }
  async isThingError(uid)         { return this.isThingStatus(uid, "ERROR"); }

  async enableThing(thingUID) {
    try {
      await this._things.enableThing(thingUID);
      console.log(`Thing '${thingUID}' enabled successfully.`);
      return true;
    } catch (e) {
      console.error(`Error enabling '${thingUID}': ${e.message}`);
      return false;
    }
  }

  async disableThing(thingUID) {
    try {
      await this._things.disableThing(thingUID);
      console.log(`Thing '${thingUID}' disabled successfully.`);
      return true;
    } catch (e) {
      console.error(`Error disabling '${thingUID}': ${e.message}`);
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RuleTester
// ─────────────────────────────────────────────────────────────────────────────

class RuleTester {
  constructor(client) {
    this._rules = new Rules(client);
    this._items = new Items(client);
  }

  async getRuleStatus(ruleUID) {
    try {
      const rule = await _parseResponse(this._rules.getRule(ruleUID));
      if (rule?.status) return {
        status:       rule.status.status       ?? "UNKNOWN",
        statusDetail: rule.status.statusDetail ?? "UNKNOWN",
        editable:     rule.editable            ?? false,
        name:         rule.name                ?? "",
        uid:          rule.uid                 ?? "",
      };
    } catch (e) {
      console.error(`Error reading status of rule '${ruleUID}': ${e.message}`);
    }
    return {};
  }

  async isRuleActive(ruleUID)   { return (await this.getRuleStatus(ruleUID)).status !== "UNINITIALIZED"; }
  async isRuleDisabled(ruleUID) {
    const s = await this.getRuleStatus(ruleUID);
    return s.status === "UNINITIALIZED" && s.statusDetail === "DISABLED";
  }
  async isRuleRunning(ruleUID)  { return (await this.getRuleStatus(ruleUID)).status === "RUNNING"; }
  async isRuleIdle(ruleUID)     { return (await this.getRuleStatus(ruleUID)).status === "IDLE"; }

  async enableRule(ruleUID) {
    try {
      await this._rules.enable(ruleUID);
      console.log(`Rule '${ruleUID}' enabled successfully.`);
      return true;
    } catch (e) {
      console.error(`Error enabling rule '${ruleUID}': ${e.message}`);
      return false;
    }
  }

  async disableRule(ruleUID) {
    try {
      await this._rules.disable(ruleUID);
      console.log(`Rule '${ruleUID}' disabled successfully.`);
      return true;
    } catch (e) {
      console.error(`Error disabling rule '${ruleUID}': ${e.message}`);
      return false;
    }
  }

  async runRule(ruleUID, contextData = null) {
    if (await this.isRuleDisabled(ruleUID)) {
      console.error(`Error: Rule '${ruleUID}' is disabled.`);
      return false;
    }
    try {
      await this._rules.runNow(ruleUID, contextData);
      console.log(`Rule '${ruleUID}' executed successfully.`);
      return true;
    } catch (e) {
      console.error(`Error executing rule '${ruleUID}': ${e.message}`);
      return false;
    }
  }

  async testRuleExecution(ruleUID, expectedItem, expectedValue) {
    if (!await this.runRule(ruleUID)) return false;
    await new Promise(r => setTimeout(r, 2000));
    try {
      const state = await this._items.getItemState(expectedItem);
      if (String(state) === String(expectedValue)) {
        console.log(`OK: item '${expectedItem}' = '${state}'.`);
        return true;
      }
      console.error(`Error: '${expectedItem}' expected '${expectedValue}', found '${state}'.`);
      return false;
    } catch (e) {
      console.error(`Error reading state of '${expectedItem}': ${e.message}`);
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ChannelTester
// ─────────────────────────────────────────────────────────────────────────────

class ChannelTester {
  constructor(client) { this._links = new Links(client); }

  async isItemLinkedToChannel(itemName, channelUID) {
    try {
      const link = await _parseResponse(this._links.getLink(itemName, channelUID));
      return link?.itemName === itemName;
    } catch (e) {
      console.error(`Error checking link '${itemName}' → '${channelUID}': ${e.message}`);
      return false;
    }
  }

  async getLinksForItem(itemName) {
    try {
      const raw = await _parseResponse(this._links.getLinks(null, itemName));
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      console.error(`Error reading links for '${itemName}': ${e.message}`);
      return [];
    }
  }

  async isItemLinkedToAnyChannel(itemName) {
    return (await this.getLinksForItem(itemName)).length > 0;
  }

  async hasOrphanedLinks() {
    try {
      const raw = await _parseResponse(this._links.getOrphanLinks());
      return Array.isArray(raw) && raw.length > 0;
    } catch (e) {
      console.error(`Error reading orphan links: ${e.message}`);
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PersistenceTester
// ─────────────────────────────────────────────────────────────────────────────

class PersistenceTester {
  constructor(client) { this._persistence = new Persistence(client); }

  async isItemPersisted(serviceId, itemName) {
    try {
      const raw  = await _parseResponse(
        this._persistence.getItemsFromService(serviceId));
      const list = Array.isArray(raw) ? raw : [];
      return list.some(e =>
        (typeof e === "object" ? e.name : e) === itemName);
    } catch (e) {
      console.error(`Error checking persistence for '${itemName}': ${e.message}`);
      return false;
    }
  }

  async hasDataInRange(serviceId, itemName, startTime, endTime) {
    try {
      const raw  = await _parseResponse(
        this._persistence.getItemPersistenceData(itemName, serviceId,
          startTime, endTime));
      return Array.isArray(raw?.data) && raw.data.length > 0;
    } catch (e) {
      console.error(`Error reading persistence data for '${itemName}': ${e.message}`);
      return false;
    }
  }

  async checkLastPersistedState(serviceId, itemName, expectedState) {
    try {
      const raw     = await _parseResponse(
        this._persistence.getItemPersistenceData(itemName, serviceId));
      const entries = raw?.data;
      if (!Array.isArray(entries) || entries.length === 0) return false;
      return String(entries[entries.length - 1].state) === String(expectedState);
    } catch (e) {
      console.error(
        `Error reading last persisted state for '${itemName}': ${e.message}`);
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SitemapTester
// ─────────────────────────────────────────────────────────────────────────────

class SitemapTester {
  constructor(client) { this._sitemaps = new Sitemaps(client); }

  async doesSitemapExist(sitemapName) {
    try {
      const raw  = await _parseResponse(this._sitemaps.getSitemaps());
      const list = Array.isArray(raw) ? raw : [];
      return list.some(s => s.name === sitemapName);
    } catch (e) {
      console.error(`Error reading sitemaps: ${e.message}`);
      return false;
    }
  }

  async doesSitemapContainItem(sitemapName, itemName) {
    try {
      const raw = await _parseResponse(this._sitemaps.getSitemap(sitemapName));
      return this._searchForItem(raw, itemName);
    } catch (e) {
      console.error(`Error reading sitemap '${sitemapName}': ${e.message}`);
      return false;
    }
  }

  _searchForItem(node, itemName) {
    if (!node) return false;
    if (typeof node === "object") {
      if (node.item?.name === itemName) return true;
      return Object.values(node).some(v => this._searchForItem(v, itemName));
    }
    if (Array.isArray(node)) {
      return node.some(el => this._searchForItem(el, itemName));
    }
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Export (browser global + CommonJS + ESM)
// ─────────────────────────────────────────────────────────────────────────────

const openHABTestSuite = {
  ItemTester, ThingTester, RuleTester,
  ChannelTester, PersistenceTester, SitemapTester,
};

if (typeof window !== "undefined") window.openHABTestSuite = openHABTestSuite;
if (typeof module !== "undefined" && module.exports) module.exports = openHABTestSuite;
if (typeof exports !== "undefined") Object.assign(exports, openHABTestSuite);
