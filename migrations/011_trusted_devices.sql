-- Teacher "trusted device" cookies (lib/throttle.js: a login that presents one skips the teacher failure budget and the IP ceiling,
-- so a stranger spraying wrong passphrases cannot keep the real teacher out). Only the sha256 of the random token is stored.
-- Revoked on a passphrase change; expire 180 days after last use (last_used is refreshed by each trusted login).
CREATE TABLE trusted_devices (
  token_hash TEXT PRIMARY KEY,
  player_id  INTEGER NOT NULL REFERENCES players(id),
  created    INTEGER NOT NULL,
  last_used  INTEGER NOT NULL
);
CREATE INDEX trusted_devices_player ON trusted_devices (player_id);
