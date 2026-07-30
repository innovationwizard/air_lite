-- uuidv7() — time-ordered UUID generator (RFC 9562 v7).
--
-- Rationale: _THE_RULES §CONVENTIONS mandates "Always use UUIDv7 for all
-- identifiers. Never default to v4." PostgreSQL 17 (this project's version, per
-- Odoo/Supabase) has no native uuidv7(); native gen_uuidv7() only lands in
-- PG18. This defines a correct, dependency-free v7 generator so new tables can
-- default their UUID primary keys to it.
--
-- Pre-existing tables keep their SERIAL / gen_random_uuid() keys untouched
-- (Rule 10 — do not modify beyond what's requested); this function governs new
-- tables only (reabastecimiento_inputs, comercial_forecast, transito_overrides,
-- sync_runs, sync_issues).
--
-- Layout (RFC 9562):
--   bytes 0..5  : 48-bit big-endian Unix timestamp in milliseconds
--   byte  6     : high nibble = version (0111 = 7), low nibble = random
--   byte  8     : top two bits = variant (10), rest random
--   remaining   : random (seeded from gen_random_uuid())
--
-- Idempotent (CREATE OR REPLACE). Applied to prod via the Supabase SQL editor;
-- this file is the source-of-truth record for fresh deploys.

CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid
LANGUAGE plpgsql
VOLATILE
PARALLEL SAFE
AS $$
DECLARE
  ts_ms      bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  uuid_bytes bytea  := uuid_send(gen_random_uuid());  -- 16 random bytes
BEGIN
  -- Overlay the 48-bit millisecond timestamp into the first 6 bytes.
  -- int8send() yields 8 big-endian bytes; take the low 6 (offset 3, 1-indexed).
  uuid_bytes := overlay(uuid_bytes PLACING substring(int8send(ts_ms) FROM 3) FROM 1 FOR 6);

  -- Version 7: set byte 6 high nibble to 0x7, keep the random low nibble.
  uuid_bytes := set_byte(uuid_bytes, 6, (get_byte(uuid_bytes, 6) & 15) | 112);  -- (& 0x0F) | 0x70

  -- Variant RFC 4122: set byte 8 top two bits to 10, keep the rest random.
  uuid_bytes := set_byte(uuid_bytes, 8, (get_byte(uuid_bytes, 8) & 63) | 128);  -- (& 0x3F) | 0x80

  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$;

COMMENT ON FUNCTION uuidv7() IS
  'RFC 9562 UUIDv7 (time-ordered). Use as DEFAULT for new-table UUID PKs per _THE_RULES.';
