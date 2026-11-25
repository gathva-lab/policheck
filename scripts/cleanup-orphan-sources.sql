-- =============================================================================
-- ADVERTENCIA: NO EJECUTAR SIN REVISIÓN HUMANA.
--
-- Borra fuentes huérfanas de la demo antigua: fuentes no verificadas creadas
-- antes de 2026-11-01 que no tienen ningún registro asociado en ai_reports.
-- Este script NO se ejecuta automáticamente; la limpieza de datos en
-- producción la decide y la ejecuta el responsable del proyecto.
--
-- Recomendación: ejecutar primero el SELECT de comprobación para revisar las
-- filas afectadas antes del DELETE.
-- =============================================================================

-- Comprobación previa (opcional):
-- SELECT id, url, status, created_at
-- FROM public.sources
-- WHERE status = 'no_verificada'
--   AND created_at < '2026-11-01'
--   AND id NOT IN (SELECT source_id FROM public.ai_reports WHERE source_id IS NOT NULL);

-- Borrado de fuentes huérfanas de la demo antigua.
DELETE FROM public.sources
WHERE status = 'no_verificada'
  AND created_at < '2026-11-01'
  AND id NOT IN (SELECT source_id FROM public.ai_reports WHERE source_id IS NOT NULL);
