import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  runAiAssistantScenario,
  startBrowserSession,
} from "../../scripts/smoke-beta-browser.mjs";

const profile = process.env.NEXUS_NOTES_BETA_USER_DATA_DIR;
const url = process.env.NEXUS_NOTES_BETA_URL ?? "https://nexus-notes-public-beta-preview.shilinming9.workers.dev/";

function emit(status, reason, evidence = {}) {
  console.log(JSON.stringify({ status, scenario: "ai-assistant", reason, url, ...evidence }));
}

if (!profile) {
  emit("BLOCKED", "AUTHENTICATED_PROFILE_UNSET", { requiredEnv: ["NEXUS_NOTES_BETA_USER_DATA_DIR"] });
  process.exitCode = 2;
} else if (!existsSync(resolve(profile)) || !statSync(resolve(profile)).isDirectory()) {
  emit("BLOCKED", "AUTHENTICATED_PROFILE_INVALID", { profile: "external" });
  process.exitCode = 2;
} else {
  let session;
  try {
    session = await startBrowserSession(url, {
      userDataDir: profile,
      headed: process.env.NEXUS_NOTES_BROWSER_HEADED === "1",
    });
    const evidence = await runAiAssistantScenario(session.cdp);
    if (session.diagnostics.state.consoleErrors > 0 || session.diagnostics.state.exceptionCount > 0) {
      emit("FAIL", "BROWSER_RUNTIME_DIAGNOSTICS", { diagnostics: session.diagnostics.state });
      process.exitCode = 1;
    } else {
      emit("PASS", "AI_ACTION_FLOW_COMPLETED", { profile: "external", evidence });
    }
  } catch (error) {
    if (error?.gateBlocked) {
      emit("BLOCKED", error.code ?? "AI_FLOW_FIXTURE_UNAVAILABLE", { profile: "external" });
      process.exitCode = 2;
    } else {
      emit("FAIL", "AI_BROWSER_FLOW_FAILED");
      process.exitCode = 1;
    }
  } finally {
    await session?.close();
  }
}
