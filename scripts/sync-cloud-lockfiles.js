const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const functionsRoot = path.join(root, "cloudfunctions");
const names = fs.readdirSync(functionsRoot)
  .filter((name) => name !== "_shared" && fs.statSync(path.join(functionsRoot, name)).isDirectory());
const templatePath = path.join(functionsRoot, "adminService", "package-lock.json");

if (!fs.existsSync(templatePath)) {
  throw new Error("请先在 cloudfunctions/adminService 生成 package-lock.json");
}

const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
for (const name of names) {
  const directory = path.join(functionsRoot, name);
  const packageJson = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
  const lock = structuredClone(template);
  lock.name = packageJson.name;
  lock.version = packageJson.version;
  lock.packages[""] = {
    name: packageJson.name,
    version: packageJson.version,
    dependencies: packageJson.dependencies,
    engines: packageJson.engines
  };
  fs.writeFileSync(path.join(directory, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
}

console.log(`Synced ${names.length} cloud-function lockfiles.`);
