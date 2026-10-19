-- ============================================================
-- JMP Concrete and Dispatch LLC — persistencia permanente del
-- bot de WhatsApp (backend en Render).
--
-- Ejecutar UNA SOLA VEZ en el SQL Editor del proyecto Supabase
-- existente («vidaplus-daily-report», hlirpqoipffmgrswjwjh).
--
-- Es una tabla PROPIA y separada de JMP: guarda el estado
-- completo del bot (conversaciones, mensajes, seguimientos,
-- campañas, sesiones y respuestas editables) en una sola fila
-- JSONB. NO se mezcla con ninguna tabla de la clínica.
-- ============================================================

create table if not exists public.jmp_state (
  name       text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.jmp_state enable row level security;

-- La anon key (la misma que usa el Daily Report en su navegador)
-- puede leer y escribir SOLO esta tabla de JMP. Si en Render se
-- configura la service role key, esa salta RLS automáticamente y
-- esta política no le estorba.
drop policy if exists "jmp_state_anon_all" on public.jmp_state;
create policy "jmp_state_anon_all" on public.jmp_state
  for all to anon
  using (true)
  with check (true);

-- Fila única del estado del bot (el backend la llena al arrancar).
insert into public.jmp_state (name, data)
values ('bot_db', '{}'::jsonb)
on conflict (name) do nothing;
