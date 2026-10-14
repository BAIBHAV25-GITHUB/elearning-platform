-- Run ONCE, manually, as a superuser (e.g. from the "postgres" database):
--   psql -U postgres -f 00_create_db.sql
-- Then load the rest INTO the new database (see README.md for the order).
--
-- Intentionally separate from schema.sql: the old schema.sql dropped the whole
-- database every time it ran. To wipe and rebuild during development use:
--   DROP DATABASE IF EXISTS elearning_db;   -- only when you really mean it

CREATE DATABASE elearning_db;
