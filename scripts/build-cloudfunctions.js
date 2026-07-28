const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.join(root, "cloudfunctions");
const outputRoot = path.join(root, "dist", "cloudfunctions");
const sharedRoot = path.join(sourceRoot, "_shared");
const services = ["userService", "bookService", "libraryService", "bookshelfService", "eventService", "adminService", "maintenanceService"];

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

for (const service of services) {
  const source = path.join(sourceRoot, service);
  const destination = path.join(outputRoot, service);
  fs.cpSync(source, destination, { recursive: true });
  fs.cpSync(sharedRoot, path.join(destination, "_shared"), { recursive: true });
  const entry = path.join(destination, "index.js");
  const rewritten = fs.readFileSync(entry, "utf8").replaceAll("../_shared/", "./_shared/");
  fs.writeFileSync(entry, rewritten, "utf8");
}

console.log(`Built ${services.length} independently deployable cloud functions in dist/cloudfunctions.`);
