# js-openhab-test-suite

Tests for openHAB items, things, rules, links, persistence and sitemaps – in the browser, without Node.js.

It mirrors [openhab-test-suite](https://github.com/Michdo93/openhab-test-suite) (Python): **same classes, same methods, same parameters.** It is built on [js-openhab-rest-client](https://github.com/Michdo93/js-openhab-rest-client) ≥ 2.0.0. Every check and test method resolves to `true` or `false` – for test pages, kiosk self-checks before a dashboard starts, or browser test tools such as Playwright.

## Installation

Load [js-openhab-rest-client](https://github.com/Michdo93/js-openhab-rest-client) (≥ 2.0.0) first, then the test suite – from jsDelivr or as local copies:

```html
<script src="https://cdn.jsdelivr.net/gh/Michdo93/js-openhab-rest-client@main/openhab.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/Michdo93/js-openhab-test-suite@main/openhab-test-suite.min.js"></script>
```

The testers are available globally (`ItemTester`, `ThingTester`, …) and under `window.openHABTestSuite`. There is no build step and no Node.js; for Node.js there is a separate library.

## Example

```html
<script src="openhab.min.js"></script>
<script src="openhab-test-suite.min.js"></script>
<pre id="result"></pre>
<script>
  (async () => {
    const client = new OpenHABClient(location.origin, null, null, localStorage.getItem("openhab-token"));
    const items = new ItemTester(client);
    const results = {
      "temperature is Number:Temperature": await items.checkItemIsType("Wohnzimmer_Temperatur", "Number:Temperature"),
      "light switches": await items.testSwitch("Wohnzimmer_Licht", "ON", "ON", 5),
      "sun thing online": await new ThingTester(client).isThingOnline("astro:sun:zuhause"),
      "good night rule": await new RuleTester(client).testRuleExecution("restbuch-1", "Haus_Status", "Nachtruhe"),
    };
    document.querySelector("#result").textContent =
      Object.entries(results).map(([name, ok]) => `${ok ? "PASS" : "FAIL"}  ${name}`).join("\n");
  })();
</script>
```

The `test…` methods of `ItemTester` open an event stream, send the command (an update for Contact and Location), wait up to `timeout` seconds for the expected state and restore the previous state afterwards. `expectedState` may also be an array of accepted states, e.g. `["23 °C", "23.0 °C"]`. Diagnostics go to `console.log` / `console.error`, as the Python version prints them.

## Reference

### ItemTester

| Method | Returns `true` if … |
|---|---|
| `doesItemExist(itemName)` | the item exists |
| `checkItemIsType(itemName, itemType)` | the item has the type – base type (`"Number"`) or with dimension (`"Number:Temperature"`) |
| `checkItemHasState(itemName, state)` | the item currently has the state |
| `isGroupItem(itemName)` | the item is a group |
| `getGroupMembers(groupName)` | *(returns the member list)* |
| `doesGroupContainMember(groupName, memberName)` | the group contains the member |
| `checkGroupMemberState(groupName, memberName, expectedState)` | the member has the state |
| `testSwitch / testDimmer / testColor / testRollershutter / testNumber / testString / testPlayer / testDateTime / testImage (itemName, command, expectedState = null, timeout = 10)` | the command leads to the expected state |
| `testContact(itemName, update = null, expectedState = null, timeout = 10)`, `testLocation(itemName, update, …)` | the update leads to the expected state |
| `ItemTester.isValidSwitchValue(v)` … `isValidImageValue(v)` | static validators (also as `_isValid…`, the Python names) |

### ThingTester

`getThingStatus(thingUID)` (returns the status or `"UNKNOWN"`), `isThingStatus(thingUID, status)`, `isThingOnline`, `isThingOffline`, `isThingPending`, `isThingUnknown`, `isThingUninitialized`, `isThingError`, `enableThing`, `disableThing`

### RuleTester

`runRule(ruleUID, contextData = null)`, `enableRule`, `disableRule`, `testRuleExecution(ruleUID, expectedItem, expectedValue, waitSeconds = 2)`, `isRuleActive`, `isRuleDisabled`, `isRuleRunning`, `isRuleIdle`, `getRuleStatus` (returns `{ status, statusDetail, editable, name, uid }` or `{}`)

### ChannelTester

`isItemLinkedToChannel(itemName, channelUID)`, `getLinksForItem(itemName)` (returns the links), `isItemLinkedToAnyChannel(itemName)`, `hasOrphanedLinks()`

### PersistenceTester

`isItemPersisted(serviceID, itemName)`, `hasDataInRange(serviceID, itemName, startTime, endTime)` (ISO strings or `Date`), `checkLastPersistedState(serviceID, itemName, expectedState)`

### SitemapTester

`doesSitemapExist(sitemapName)`, `doesSitemapContainItem(sitemapName, itemName)`

## Test UI

`index.html` is a test page for the browser: enter URL and token, pick a tester and run the methods interactively.

## Development

`openhab-test-suite.js` is the source. After changes, create the minified file (only Python is needed):

```bash
pip install rjsmin
bash tools/build.sh
```

## License

MIT – see [LICENSE](LICENSE).
