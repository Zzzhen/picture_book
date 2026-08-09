const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
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
    try { JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { failures.push(`${relative}: JSON ${error.message}`); }
  }
  if (file.endsWith(".js")) {
    try { new vm.Script(fs.readFileSync(file, "utf8"), { filename: relative }); } catch (error) { failures.push(`${relative}: JS ${error.message}`); }
  }
}

const app = JSON.parse(fs.readFileSync(path.join(root, "miniprogram/app.json"), "utf8"));
if (app.pages.length !== 16) failures.push(`app.json: expected 16 routes, got ${app.pages.length}`);
if (!app.pages.includes("pages/shared-shelf/index")) failures.push("app.json: shared shelf route missing");
if (!fs.existsSync(path.join(root, "cloudfunctions/shareService"))) failures.push("shareService cloud function missing");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Project syntax, JSON, route boundary and V1-Core checks passed.");
}
