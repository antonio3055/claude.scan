/** Shared pass/fail reporter so every suite prints the same, countable format. */
export function createReporter(suite) {
  let passed = 0;
  let failed = 0;

  return {
    async check(name, run) {
      const index = String(passed + failed + 1).padStart(2, '0');
      try {
        await run();
        passed += 1;
        console.log(`PASS ${index} ${name}`);
      } catch (error) {
        failed += 1;
        console.error(`FAIL ${index} ${name}`);
        console.error(`     ${error?.message || error}`);
      }
    },

    done() {
      console.log(`\n${suite}: ${passed} passed, ${failed} failed.`);
      if (failed) process.exitCode = 1;
      return { passed, failed };
    }
  };
}
