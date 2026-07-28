const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const expected = {
  userService: ["bootstrap", "getProfile", "completeOnboarding", "updateProfile", "cancelAccount", "restartDeletedAccount"],
  bookService: ["lookupByIsbn", "getLookupStatus", "searchCachedBooks", "getEditionDetail", "createManualBook", "updateManualSubmission", "resubmitManualBook"],
  libraryService: ["listBooks", "addBook", "getUserBook", "updateBook", "removeBook", "batchUpdate"],
  bookshelfService: ["listShelves", "createShelf", "updateShelf", "deleteShelf", "reorderShelves", "listShelfBooks", "addBooks", "removeBooks", "reorderBooks"],
  eventService: ["trackBatch"],
  adminService: ["dashboard", "listUsers", "setUserStatus", "listPendingBooks", "reviewManualBook", "updateEdition", "retryCoverTransfer"]
};

test("cloud service action contracts exactly match product section 15", () => {
  const contracts = require(path.join(root, "cloudfunctions/_shared/contracts"));
  for (const [service, actions] of Object.entries(expected)) {
    assert.deepEqual(Object.keys(contracts[service]).sort(), actions.sort(), service);
  }
  assert.deepEqual(Object.keys(contracts.maintenanceService), []);
});

test("all cloud functions are independently packageable entry points", () => {
  const services = Object.keys(expected).concat("maintenanceService");
  for (const service of services) {
    const directory = path.join(root, "cloudfunctions", service);
    const pkg = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    assert.equal(pkg.main, "index.js");
    assert.equal(pkg.dependencies["wx-server-sdk"], "4.0.2");
    assert.equal(pkg.engines.node, ">=18");
    assert.equal(fs.existsSync(path.join(directory, "package-lock.json")), true);
    const source = fs.readFileSync(path.join(directory, "index.js"), "utf8");
    assert.match(source, /exports\.main\s*=/, service);
  }
});

test("write actions are explicitly marked for idempotency", () => {
  const contracts = require(path.join(root, "cloudfunctions/_shared/contracts"));
  const writes = [
    ["userService", "completeOnboarding"],
    ["userService", "updateProfile"],
    ["userService", "cancelAccount"],
    ["bookService", "createManualBook"],
    ["libraryService", "addBook"],
    ["libraryService", "updateBook"],
    ["bookshelfService", "createShelf"],
    ["eventService", "trackBatch"],
    ["adminService", "reviewManualBook"]
  ];
  for (const [service, action] of writes) {
    assert.equal(contracts[service][action].write, true, `${service}.${action}`);
  }
});
