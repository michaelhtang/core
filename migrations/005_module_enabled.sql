-- Which classes a module's onEnable hook has already run for (lib/modules.js). One row per (module, class), written in the
-- same transaction as the hook, so a failed hook is retried at the next boot.
CREATE TABLE module_enabled (
  module_id TEXT    NOT NULL,
  class_id  INTEGER NOT NULL REFERENCES classes(id),
  at        INTEGER NOT NULL,
  PRIMARY KEY (module_id, class_id)
);
