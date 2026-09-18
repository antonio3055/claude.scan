#!/usr/bin/env node
/**
 * Polls the scanner's local URL until it responds or the deadline passes.
 * Used by start.bat so it only opens the browser once the server is
 * actually ready -- never a fixed guess-and-hope delay.
 *
 * Exit 0: server responded. Exit 1: timed out.
 */
const url = "http://127.0.0.1:8080/";
const deadline = Date.now() + 45_000;

async function respondingNow() {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function main() {
  while (Date.now() < deadline) {
    if (await respondingNow()) {
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  process.exit(1);
}

main();
