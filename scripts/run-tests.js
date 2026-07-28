const path = require("node:path");

[
  "scaffold.test.js",
  "ui-structure.test.js",
  "frontend-behavior.test.js",
  "backend-core.test.js",
  "service-contracts.test.js",
  "integration-guards.test.js",
  "ops-artifacts.test.js"
].forEach((file) => require(path.join(__dirname, "..", "tests", file)));
