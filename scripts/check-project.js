const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const miniprogramRoot = path.join(root, "miniprogram");
const ignored = new Set(["node_modules", "dist", ".git"]);
const failures = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

for (const file of walk(root)) {
  const relative = path.relative(root, file);
  if (file.endsWith(".json")) {
    try {
      const config = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const componentPath of Object.values(config.usingComponents || {})) {
        if (typeof componentPath !== "string" || componentPath.includes("://")) continue;
        if (!componentPath.startsWith("/components/")) {
          failures.push(`${relative}: component path must be root absolute: ${componentPath}`);
          continue;
        }
        const componentEntry = path.join(miniprogramRoot, `${componentPath.slice(1)}.json`);
        if (!fs.existsSync(componentEntry)) failures.push(`${relative}: component not found: ${componentPath}`);
      }
    } catch (error) {
      failures.push(`${relative}: JSON ${error.message}`);
    }
  }
  if (file.endsWith(".js")) {
    try { new vm.Script(fs.readFileSync(file, "utf8"), { filename: relative }); } catch (error) { failures.push(`${relative}: JS ${error.message}`); }
  }
}

const app = JSON.parse(fs.readFileSync(path.join(root, "miniprogram/app.json"), "utf8"));
if (app.pages.length !== 17) failures.push(`app.json: expected 17 routes, got ${app.pages.length}`);
if (!app.pages.includes("pages/daily-pick/index")) failures.push("app.json: daily pick route missing");
if (!app.pages.includes("pages/shared-shelf/index")) failures.push("app.json: shared shelf route missing");
if (app.lazyCodeLoading !== "requiredComponents") failures.push("app.json: component lazy loading must use requiredComponents");
if (!fs.existsSync(path.join(root, "cloudfunctions/shareService"))) failures.push("shareService cloud function missing");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Project syntax, JSON, route boundary and V1-Core checks passed.");
}
