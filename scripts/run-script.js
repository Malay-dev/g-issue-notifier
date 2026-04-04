#!/usr/bin/env node
const { spawnSync } = require("child_process");
const script = process.argv[2];
const choices = {
  "publish-secrets": {
    ps1: "scripts/publish-secrets.ps1",
    sh: "scripts/publish-secrets.sh",
  },
  "register-webhook": {
    ps1: "scripts/register-webhook.ps1",
    sh: "scripts/register-webhook.sh",
  },
  "verify-webhook": {
    ps1: "scripts/verify-webhook.ps1",
    sh: "scripts/verify-webhook.sh",
  },
};

if (!script || !choices[script]) {
  console.error(
    "Usage: node scripts/run-script.js <publish-secrets|register-webhook|verify-webhook>",
  );
  process.exit(1);
}

const isWindows = process.platform === "win32";
const target = isWindows ? choices[script].ps1 : choices[script].sh;
const cmd = isWindows ? "powershell" : "bash";
const args = isWindows
  ? [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      target,
    ]
  : [target];

const result = spawnSync(cmd, args, { stdio: "inherit" });
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status || 0);
