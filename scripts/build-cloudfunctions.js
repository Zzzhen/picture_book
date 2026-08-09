const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.join(root, "cloudfunctions");
const outputRoot = path.join(root, "dist", "cloudfunctions");
const sharedRoot = path.join(sourceRoot, "_shared");
const services = ["userService", "bookService", "libraryService", "bookshelfService", "eventService", "adminService", "shareService", "maintenanceService"];

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

for (const service of services) {
  const source = path.join(sourceRoot, service);
  const destination = path.join(outputRoot, service);
  fs.mkdirSync(destination, { recursive: true });
  // Copy only deployable source and manifests. Dependencies are installed by
  // the cloud runtime from package-lock.json, so local node_modules never
  // enter the deploy artifact.
  for (const file of ["index.js", "package.json", "package-lock.json"]) {
    const entry = path.join(source, file);
    if (fs.existsSync(entry)) fs.copyFileSync(entry, path.join(destination, file));
  }
  fs.cpSync(sharedRoot, path.join(destination, "_shared"), { recursive: true });
  const entry = path.join(destination, "index.js");
  const rewritten = fs.readFileSync(entry, "utf8").replaceAll("../_shared/", "./_shared/");
  fs.writeFileSync(entry, rewritten, "utf8");
}

console.log(`Built ${services.length} independently deployable cloud functions in dist/cloudfunctions.`);
