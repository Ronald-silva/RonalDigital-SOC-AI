#!/usr/bin/env bash
# uso: scripts/perfil-enxuto.sh <org_id> <montagem|cliente>
set -euo pipefail
ORG="${1:?uso: perfil-enxuto.sh <org_id> <montagem|cliente>}"
PERFIL="${2:?montagem|cliente}"
DB="${DB_CONTAINER:-supabase_db_deskcomm-crm}"

BASE='"/app/inbox","/app/agenda","/app/kanban","/app/contacts","/app/ai/agents","/app/ai/followups","/app/ai/knowledge/sources","/app/ai/cases","/app/connections","/app/metrics","/app/settings/marca"'
SETUP=',"/app/settings/tenant/agenda","/app/settings/tenant/pipelines","/app/ai/credentials","/app/ai/inbox","/app/ai/cases/avisos","/app/settings/notifications"'

case "$PERFIL" in
  cliente)  DEST="$BASE" ;;
  montagem) DEST="$BASE$SETUP" ;;
  *) echo "perfil invalido: $PERFIL" >&2; exit 1 ;;
esac

docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v org="$ORG" -v dest="[$DEST]" <<'SQL'
update public.organizations
   set interface_settings = jsonb_build_object('preset','completa','destinos',:'dest'::jsonb)
 where id = :'org'
returning id, jsonb_array_length(interface_settings->'destinos') as total;
SQL
