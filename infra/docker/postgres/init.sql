-- Enable pgvector for face embedding similarity search.
-- This runs automatically on first container start (empty data volume).
-- If you ever need to re-run this on an existing volume, exec into the
-- container and run: psql -U photodost -d photodost -f /docker-entrypoint-initdb.d/00-init.sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Useful extensions we might want later. Uncomment as needed.
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE EXTENSION IF NOT EXISTS unaccent;
