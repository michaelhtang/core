import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunTimes, daypart } from '../public/daylight.js';

// Published Edmonton sunrise/sunset (local clock): June 21 05:04 / 22:07 MDT (UTC−6); Dec 21 08:49 / 16:16 MST (UTC−7).
const near = (ms, utcIso, why) => assert.ok(Math.abs(ms - Date.parse(utcIso)) <= 6 * 60e3, `${why}: ${new Date(ms).toISOString()} vs ${utcIso}`);

test('Edmonton sunrise and sunset within 6 minutes of published times', () => {
  const june = sunTimes(Date.UTC(2026, 5, 21));
  near(june.sunrise, '2026-06-21T11:04:00Z', 'June sunrise');
  near(june.sunset, '2026-06-22T04:07:00Z', 'June sunset');
  const dec = sunTimes(Date.UTC(2026, 11, 21));
  near(dec.sunrise, '2026-12-21T15:49:00Z', 'December sunrise');
  near(dec.sunset, '2026-12-21T23:16:00Z', 'December sunset');
});

test('daypart: day between sunrise and sunset, night otherwise, across the UTC date line', () => {
  assert.equal(daypart(Date.parse('2026-06-21T18:00:00Z')), 'day');     // noon MDT
  assert.equal(daypart(Date.parse('2026-06-22T03:30:00Z')), 'day');     // 21:30 MDT, still light in June (UTC date already the 22nd)
  assert.equal(daypart(Date.parse('2026-06-22T05:00:00Z')), 'night');   // 23:00 MDT
  assert.equal(daypart(Date.parse('2026-12-21T16:30:00Z')), 'day');     // 09:30 MST
  assert.equal(daypart(Date.parse('2026-12-22T00:30:00Z')), 'night');   // 17:30 MST, dark in December
  assert.equal(daypart(Date.parse('2026-12-21T14:30:00Z')), 'night');   // 07:30 MST, before the sun is up
});
