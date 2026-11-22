// Login throttling. In memory (resets on restart). Policy:
//  - An attempt is recorded BEFORE the slow PIN check (reserve), so a burst of parallel guesses can't all be judged against an
//    empty count; a successful login gives its slot back (release). Only failures stay counted.
//  - Per IP, everyone: 600 failed tries / 15 min. This is only the ceiling against one address trying everything: a full class (30
//    students, a few typos each) sharing the school's NAT address uses a few dozen, so honest traffic never gets near it. An IPv6
//    address is counted by its /64 (the block one subscriber owns, so rotating addresses inside it buys nothing).
//  - Per (student, IP): 5 tries / minute. This is the fairness check: it is checked BEFORE a try is recorded anywhere, so one
//    student spraying wrong PINs at one classmate is stopped here and is not counted against the shared IP bucket again; the
//    other students on that address are not affected. Someone at another IP can't touch you either.
//  - Per student, any IP: 30 failed tries / hour. A 6-digit PIN would take years to brute-force; the teacher sees offenders in
//    "Login trouble" and can Unlock (which clears all of a student's counters).
//  - Teacher accounts are NOT subject to the student limits and are never locked for good. They have their own per-username budget:
//    20 wrong tries per 15 minutes from ANY address (IPv6 rotation defeats the IP limit), then 429 until the oldest ages out, at most
//    15 minutes (so the world teacher can always wait it out). That caps a guesser at 80 tries an hour against a 12+ character
//    passphrase, far below anything useful. A successful login or passphrase change gives its slot back. A teacher name also has the
//    5-a-minute per-(name, IP) bucket, so the first 429 comes at the same try as for a student or an unknown name.
//    Because a refused (429) try is not recorded, a stranger could keep that budget full for ever with one wrong guess each time
//    a slot frees. So the real teacher's browsers are exempt: a successful teacher login leaves a "trusted device" cookie
//    (lib/players.js trusted_devices), and a login that presents it skips the IP ceiling and the budget. It still has its own
//    small buckets (5 tries a minute per address, and 20 wrong per 15 minutes per username so that a COPIED cookie is not a free
//    guessing licence), which strangers cannot fill because they never count towards them. A thief who fills the second one can lock
//    the teacher's trusted browsers out only until the teacher changes the passphrase (that forgets every trusted device).
//  - Every failed login (teacher, student or a name that does not exist) waits the same progressive delay, keyed by the username
//    (failed(): 250 ms per recent failure, up to 2 s). Before, only teacher names were slowed, so response time told a guesser which
//    usernames were teachers'.
//  - A teacher changing their passphrase has a session: its guesses at the current passphrase are capped per session (10 an
//    hour), and a session without a trusted-device cookie also shares the teacher budget above.
//  - First-run setup has its own bucket: 5 wrong tokens a minute per address, never an account lock (no teacher exists yet).
//  - The console can list addresses that hit the IP ceiling and clear them (blockedAddresses, clearAddress).
import net from 'node:net';
import { HttpError } from './errors.js';
import { createClock } from './clock.js';

export const DEFAULT_LIMITS = {
  ip: 600, ipWindowMs: 15 * 60000,
  user: 5, userWindowMs: 60000,
  userHourly: 30, userHourlyWindowMs: 3600e3,
  teacher: 20, teacherWindowMs: 15 * 60000,
  trustedPair: 5, trustedUser: 20, session: 10, setup: 5,
  failDelayStepMs: 250, failDelayMaxMs: 2000,
};

// The key an address is counted under: IPv4 as is, IPv4-mapped IPv6 as its IPv4, any other IPv6 as its /64. Anything else (the
// bank module's `p<id>` keys) is returned untouched.
export function ipKey(ip) {
  ip = String(ip).replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!net.isIPv6(ip)) return ip;
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().padStart(4, '0')).join(':')}::/64`;
}

// now: the clock, injectable so tests can drive time instead of sleeping.
export function createThrottle({ now = createClock().now, ...overrides } = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const hits = new Map(); // key -> [timestamps]
  const windowFor = (key) => (key.startsWith('uip:') ? limits.userWindowMs : key.startsWith('user:') ? limits.userHourlyWindowMs : key.startsWith('tuser:') || key.startsWith('tdevuser:') ? limits.teacherWindowMs : key.startsWith('tdev:') || key.startsWith('setup:') ? limits.userWindowMs : key.startsWith('ses:') ? limits.userHourlyWindowMs : limits.ipWindowMs);

  function recent(key, windowMs = windowFor(key)) {
    const list = (hits.get(key) || []).filter((t) => now() - t < windowMs);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  }
  const wait = (list, windowMs) => Math.max(1, Math.ceil((list[0] + windowMs - now()) / 1000));
  const lower = (username) => username.toLowerCase();
  // The one definition of "locked": the hourly cap is full (until a teacher unlocks), or the per-minute cap is full from any IP (lifts by itself).
  // list: this student's failures this hour (already read by the caller).
  const isLocked = (name, list) => list.length >= limits.userHourly
    || [...hits.keys()].some((key) => key.startsWith(`uip:${name}|`) && recent(key).length >= limits.user);

  return {
    limits,

    // Throws 429 if any limit is full; otherwise records the attempt and returns release() for a successful login.
    // teacher: no student buckets, the teacher budget instead. trusted: a teacher login from a trusted device (own small bucket only).
    // session: guesses made through a logged-in session (keyed by the caller, e.g. the session hash), nothing else. setup: first-run setup.
    reserve(ip, username, { teacher = false, trusted = false, session = false, setup = false } = {}) {
      const name = lower(username);
      const addr = ipKey(ip);
      let checks;
      if (session) checks = [[`ses:${name}`, limits.session, limits.userHourlyWindowMs, 'session']];
      else if (setup) checks = [[`setup:${addr}`, limits.setup, limits.userWindowMs, 'setup']];
      else if (trusted) checks = [[`tdev:${name}|${addr}`, limits.trustedPair, limits.userWindowMs, 'user'], [`tdevuser:${name}`, limits.trustedUser, limits.teacherWindowMs, 'trusted']];
      else {
        checks = [[`ip:${addr}`, limits.ip, limits.ipWindowMs, 'ip']];
        if (!teacher) checks.push([`uip:${name}|${addr}`, limits.user, limits.userWindowMs, 'user'], [`user:${name}`, limits.userHourly, limits.userHourlyWindowMs, 'hourly']);
        else if (name) checks.push([`uip:${name}|${addr}`, limits.user, limits.userWindowMs, 'user'], [`tuser:${name}`, limits.teacher, limits.teacherWindowMs, 'teacher']);   // (bank-basic passes '' to mean "only the ip-style key")
      }
      for (const [key, max, windowMs, kind] of checks) {
        const list = recent(key, windowMs);
        if (list.length < max) continue;
        if (kind === 'hourly') throw new HttpError(429, 'Too many wrong tries on this account. Ask your teacher to unlock it.');
        if (kind === 'session') throw new HttpError(429, 'Too many wrong passphrases from this session. Log in again later.');
        if (kind === 'setup') throw new HttpError(429, 'Too many wrong setup tokens. Wait a minute and try again.');
        if (kind === 'trusted') {
          const m = Math.ceil(wait(list, windowMs) / 60);
          throw new HttpError(429, `Too many wrong passphrases for this account. Wait ${m} minute${m === 1 ? '' : 's'}.`);
        }
        if (kind === 'teacher') {
          const m = Math.ceil(wait(list, windowMs) / 60);
          throw new HttpError(429, `Too many wrong passphrases for this account from other devices. Sign in from a device you've used before, or wait ${m} minute${m === 1 ? '' : 's'}.`);
        }
        const s = wait(list, windowMs);
        throw new HttpError(429, `Too many tries. Wait ${s} second${s === 1 ? '' : 's'}, then try again.`);
      }
      const at = now();
      for (const [key] of checks) hits.set(key, [...(hits.get(key) || []), at]);
      return () => {
        for (const [key] of checks) {
          const list = hits.get(key);
          const i = list ? list.indexOf(at) : -1;
          if (i >= 0) list.splice(i, 1);
        }
      };
    },

    // Any failed login or passphrase check: how long to stall it (grows with this name's recent failures, capped), the same schedule
    // whoever the name belongs to (or nobody); succeeded() forgets them.
    failed(username) {
      const key = `fail:${lower(username)}`;
      hits.set(key, [...recent(key), now()]);
      return Math.min(limits.failDelayMaxMs, limits.failDelayStepMs * hits.get(key).length);
    },
    succeeded: (username) => hits.delete(`fail:${lower(username)}`),
    // A passphrase change revokes every trusted device, so whatever a thief spent on the trusted budget no longer matters.
    passphraseChanged: (username) => hits.delete(`tdevuser:${lower(username)}`),

    // { failures (this hour), last (ms), locked } for a student.
    status(username) {
      const name = lower(username);
      const list = recent(`user:${name}`);
      return { failures: list.length, last: list.length ? list[list.length - 1] : null, locked: isLocked(name, list) };
    },

    // Usernames with at least minFailures failed tries this hour, newest first.
    trouble(minFailures = 3) {
      const out = [];
      for (const key of [...hits.keys()]) {
        if (!key.startsWith('user:')) continue;
        const list = recent(key);
        if (list.length >= minFailures) out.push({ username: key.slice(5), failures: list.length, last: list[list.length - 1], locked: isLocked(key.slice(5), list) });
      }
      return out.sort((a, b) => b.last - a.last);
    },

    // Teacher Unlock or PIN reset: forget every counter for this student.
    clear(username) {
      const name = lower(username);
      for (const key of [...hits.keys()]) if (key === `user:${name}` || key.startsWith(`uip:${name}|`)) hits.delete(key);
    },

    // Addresses that are at the IP ceiling right now: [{ ip (the key), count, frees (ms: when the first slot opens) }].
    blockedAddresses() {
      const out = [];
      for (const key of [...hits.keys()]) {
        if (!key.startsWith('ip:')) continue;
        const list = recent(key);
        if (list.length >= limits.ip) out.push({ ip: key.slice(3), count: list.length, frees: list[list.length - limits.ip] + limits.ipWindowMs });
      }
      return out.sort((a, b) => b.count - a.count);
    },
    // Teacher "Unblock": forget an address's failures. True if there was anything to forget.
    clearAddress: (addr) => hits.delete(`ip:${ipKey(addr)}`),

    sweep() { for (const key of [...hits.keys()]) recent(key); },
  };
}
