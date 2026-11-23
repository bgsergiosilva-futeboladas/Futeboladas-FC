-- Futeboladas FC — agendamento das notificações (correr uma vez no SQL Editor)
-- Chama a função "notificar" a cada 30 minutos; ela própria só envia às 08:30 de segunda, às 18h e às 21h de Lisboa.
-- Substitui O_TEU_CRON_SECRET pelo mesmo valor que puseste no segredo CRON_SECRET.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'futeboladas-notificar';
select cron.schedule('futeboladas-notificar', '0,30 * * * *', $$
  select net.http_post(
    url := 'https://hbjlygnunutttgvkjqcw.supabase.co/functions/v1/notificar',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'O_TEU_CRON_SECRET'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
$$);

-- Ver se está agendado:      select jobid, jobname, schedule from cron.job;
-- Ver as últimas execuções:  select * from cron.job_run_details order by start_time desc limit 5;
-- Ver o que foi enviado:     select * from public.notif_log order by enviado desc limit 20;
