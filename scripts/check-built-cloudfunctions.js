const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "dist", "cloudfunctions");
const services = [
  "userService",
  "bookService",
  "libraryService",
  "bookshelfService",
  "eventService",
  "adminService",
  "maintenanceService"
];
const failures = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

for (const service of services) {
  const directory = path.join(root, service);
  if (!fs.existsSync(directory)) {
    failures.push(`${service}: build directory missing`);
    continue;
  }
  const entry = fs.readFileSync(path.join(directory, "index.js"), "utf8");
  if (entry.includes("../_shared/")) failures.push(`${service}: shared imports were not rewritten`);
  if (!fs.existsSync(path.join(directory, "_shared", "cloud.js"))) failures.push(`${service}: shared runtime missing`);
  const lock = JSON.parse(fs.readFileSync(path.join(directory, "package-lock.json"), "utf8"));
  if (lock.packages[""].dependencies["wx-server-sdk"] !== "4.0.2") failures.push(`${service}: lockfile SDK mismatch`);
}

for (const file of walk(root)) {
  const relative = path.relative(root, file);
  try {
    if (file.endsWith(".js")) new vm.Script(fs.readFileSync(file, "utf8"), { filename: relative });
    if (file.endsWith(".json")) JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    failures.push(`${relative}: ${error.message}`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${services.length} built cloud functions and their independent lockfiles.`);
}
