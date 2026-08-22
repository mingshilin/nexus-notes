import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const script = process.argv[2];
if (!script) {
  console.error("Usage: node scripts/run-workspace-scripts.mjs <script>");
  process.exit(2);
}

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const workspaces = Array.isArray(packageJson.workspaces) ? packageJson.workspaces : [];
const workspaceDirs = workspaces.flatMap((pattern) => {
  if (pattern !== "apps/*" && pattern !== "packages/*") return [];
  const parent = pattern.slice(0, -2);
  return readdirSync(resolve(root, parent), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(parent, entry.name).replaceAll("\\", "/"))
    .sort();
});

for (const workspace of workspaceDirs) {
  const workspacePackage = JSON.parse(readFileSync(resolve(root, workspace, "package.json"), "utf8"));
  if (!workspacePackage.scripts?.[script]) continue;

  console.log(`\n> ${workspacePackage.name} ${script}`);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : npm;
  const args = npmExecPath
    ? [npmExecPath, "run", script, "--workspace", workspacePackage.name]
    : ["run", script, "--workspace", workspacePackage.name];
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: !npmExecPath && process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
