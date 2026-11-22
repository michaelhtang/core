// Stored ledger audits (audit_runs, migration 008). ledger.audit() stays the one calculation; this keeps its last results so the
// console reads a row instead of re-deriving the whole ledger on every refresh.
const THROTTLE_MS = 30_000;   // a manual run is refused (the stored result is returned) when one ran in the last 30 s, per process
const NIGHTLY_HOUR = 2;       // local (Edmonton) hour after which the day's audit may run

export function createAuditRuns({ db, ledger, clock }) {
  let lastRun = -Infinity;
  const latest = () => {
    const r = db.prepare('SELECT at, result_json FROM audit_runs ORDER BY id DESC LIMIT 1').get();
    return r && { at: r.at, ...JSON.parse(r.result_json) };
  };
  function record() {
    const result = ledger.audit();
    const at = clock.now();
    db.prepare('INSERT INTO audit_runs (at, ok, result_json) VALUES (?, ?, ?)').run(at, result.ok ? 1 : 0, JSON.stringify(result));
    return { at, ...result };
  }
  return {
    latest: () => latest() ?? record(),
    run() {
      if (clock.now() - lastRun < THROTTLE_MS) return latest();
      lastRun = clock.now();
      return record();
    },
    // The timer body: once per local day, after 02:00. The stored `at` is the memory, so a restart never repeats it.
    nightly() {
      if (clock.hour() < NIGHTLY_HOUR) return null;
      const last = latest();
      return last && clock.dayOf(last.at) === clock.today() ? null : record();
    },
  };
}
