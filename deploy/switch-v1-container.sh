#!/usr/bin/env bash
set -Eeuo pipefail

CONTAINER_NAME=""
IMAGE=""
ENV_FILE=""
SHARED_DATA_ROOT=""
SHARED_ARTIFACT_ROOT=""
HOST_PORT="3210"
CONTAINER_USER="1000:1000"
WAIT_TIMEOUT_SECONDS="120"
STOP_TIMEOUT_SECONDS="30"
LOCK_FILE=""
previous_name=""
switch_active="0"
previous_ready="0"

usage() {
  cat <<'EOF'
Usage: switch-v1-container.sh \
  --container <name> \
  --image <image:tag> \
  --env-file <path> \
  --data-root <path> \
  --artifact-root <path> \
  [--host-port <port>] \
  [--wait-timeout <seconds>] \
  [--stop-timeout <seconds>] \
  [--lock-file <path>]
EOF
}

emit() {
  local ok="$1"
  local status="$2"
  local previous="${3:-}"
  printf '{"ok":%s,"status":"%s"' "$ok" "$status"
  if [ -n "$previous" ]; then
    printf ',"previousContainer":"%s"' "$previous"
  fi
  printf '}\n'
}

fail() {
  emit false "$1"
  exit "${2:-2}"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --container|--image|--env-file|--data-root|--artifact-root|--host-port|--wait-timeout|--stop-timeout|--lock-file)
      [ "$#" -ge 2 ] && [ -n "${2:-}" ] || fail missing_argument_value
      ;;
  esac
  case "$1" in
    --container) CONTAINER_NAME="${2:-}"; shift 2 ;;
    --image) IMAGE="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --data-root) SHARED_DATA_ROOT="${2:-}"; shift 2 ;;
    --artifact-root) SHARED_ARTIFACT_ROOT="${2:-}"; shift 2 ;;
    --host-port) HOST_PORT="${2:-}"; shift 2 ;;
    --wait-timeout) WAIT_TIMEOUT_SECONDS="${2:-}"; shift 2 ;;
    --stop-timeout) STOP_TIMEOUT_SECONDS="${2:-}"; shift 2 ;;
    --lock-file) LOCK_FILE="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) fail invalid_argument ;;
  esac
done

for value in "$CONTAINER_NAME" "$IMAGE" "$ENV_FILE" "$SHARED_DATA_ROOT" "$SHARED_ARTIFACT_ROOT"; do
  [ -n "$value" ] || fail missing_required_argument
done
[[ "$CONTAINER_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || fail invalid_container_name
[[ "$HOST_PORT" =~ ^[0-9]+$ ]] || fail invalid_host_port
[[ "$WAIT_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail invalid_wait_timeout
[[ "$STOP_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail invalid_stop_timeout
[ -f "$ENV_FILE" ] || fail env_file_missing
[ -d "$SHARED_DATA_ROOT" ] || fail shared_data_root_missing
[ -d "$SHARED_ARTIFACT_ROOT" ] || fail shared_artifact_root_missing

for command in docker curl flock date sed; do
  command -v "$command" >/dev/null 2>&1 || fail dependency_missing
done

LOCK_FILE="${LOCK_FILE:-/tmp/${CONTAINER_NAME}.release-switch.lock}"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  fail release_switch_locked 73
fi

docker image inspect "$IMAGE" >/dev/null 2>&1 || fail candidate_image_missing
docker inspect "$CONTAINER_NAME" >/dev/null 2>&1 || fail current_container_missing

runtime_args=(
  --restart unless-stopped
  --user "$CONTAINER_USER"
  --cap-drop ALL
  --security-opt no-new-privileges:true
  --env-file "$ENV_FILE"
  -e NODE_ENV=production
  -e HOSTNAME=0.0.0.0
  -e PORT=3210
  -e DATABASE_URL=file:/srv/shanhai/data/production.db
  -e ARTIFACT_STORAGE_ROOT=/srv/shanhai/artifacts
  -e SHANHAI_APP_INSTANCE_COUNT=1
  -e SHANHAI_AUTH_MODE=password
  -e NEXT_PUBLIC_SHANHAI_AUTH_MODE=password
  -e SHANHAI_TRUST_PROXY=1
  -e SHANHAI_PUBLIC_REGISTRATION_ENABLED=0
  -e NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED=0
  -e SHANHAI_DB_INIT_SKIP_DOTENV=1
  -e SHANHAI_PRODUCTION_PREFLIGHT_SKIP_DOTENV=1
  -e PPT_ASSET_IMAGE_PROVIDER=curl
  --health-cmd "node -e \"fetch('http://127.0.0.1:3210/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))\""
  --health-interval 15s
  --health-timeout 5s
  --health-start-period 30s
  --health-retries 8
  -p "127.0.0.1:${HOST_PORT}:3210"
  -v "${SHARED_DATA_ROOT}:/srv/shanhai/data"
  -v "${SHARED_ARTIFACT_ROOT}:/srv/shanhai/artifacts"
)

wait_healthy() {
  local name="$1"
  local deadline=$((SECONDS + WAIT_TIMEOUT_SECONDS))
  local docker_health=""
  local http_status=""
  local container_state=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    container_state=$(docker inspect "$name" --format '{{.State.Status}}' 2>/dev/null || true)
    case "$container_state" in
      exited|dead) return 1 ;;
    esac
    docker_health=$(docker inspect "$name" --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || true)
    http_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --max-time 5 "http://127.0.0.1:${HOST_PORT}/api/health" 2>/dev/null || true)
    if [ "$docker_health" = "healthy" ] && [ "$http_status" = "200" ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

current_image=$(docker inspect "$CONTAINER_NAME" --format '{{.Config.Image}}')
if [ "$current_image" = "$IMAGE" ] && wait_healthy "$CONTAINER_NAME"; then
  emit true already_current
  exit 0
fi

preflight_name="${CONTAINER_NAME}-preflight-$$"
if ! docker run --rm \
  --name "$preflight_name" \
  --user "$CONTAINER_USER" \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --env-file "$ENV_FILE" \
  -e DATABASE_URL=file:/srv/shanhai/data/production.db \
  -e ARTIFACT_STORAGE_ROOT=/srv/shanhai/artifacts \
  -e SHANHAI_APP_INSTANCE_COUNT=1 \
  -e SHANHAI_AUTH_MODE=password \
  -e NEXT_PUBLIC_SHANHAI_AUTH_MODE=password \
  -e SHANHAI_TRUST_PROXY=1 \
  -e SHANHAI_PUBLIC_REGISTRATION_ENABLED=0 \
  -e NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED=0 \
  -e SHANHAI_PRODUCTION_PREFLIGHT_SKIP_DOTENV=1 \
  -v "${SHARED_DATA_ROOT}:/srv/shanhai/data" \
  -v "${SHARED_ARTIFACT_ROOT}:/srv/shanhai/artifacts" \
  "$IMAGE" node scripts/production-preflight.mjs >/dev/null 2>&1; then
  fail candidate_preflight_failed
fi

image_label=$(printf '%s' "$current_image" | sed 's/[^A-Za-z0-9_.-]/-/g')
previous_name="${CONTAINER_NAME}-previous-${image_label}-$(date +%Y%m%d-%H%M%S)"
if docker inspect "$previous_name" >/dev/null 2>&1; then
  fail previous_container_conflict
fi

rollback() {
  local reason="$1"
  trap - ERR INT TERM
  set +e
  emit false rollback_started "$previous_name"
  if [ "$previous_ready" != "1" ]; then
    if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1 \
      && docker start "$CONTAINER_NAME" >/dev/null 2>&1 \
      && wait_healthy "$CONTAINER_NAME"; then
      emit false rollback_succeeded "$CONTAINER_NAME"
      return 0
    fi
    emit false rollback_failed "$CONTAINER_NAME"
    return 1
  fi
  if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1
  fi
  if ! docker rename "$previous_name" "$CONTAINER_NAME" >/dev/null 2>&1; then
    emit false rollback_failed "$previous_name"
    return 1
  fi
  if ! docker start "$CONTAINER_NAME" >/dev/null 2>&1 || ! wait_healthy "$CONTAINER_NAME"; then
    emit false rollback_failed "$previous_name"
    return 1
  fi
  emit false rollback_succeeded "$CONTAINER_NAME"
  return 0
}

handle_unexpected_error() {
  if [ "$switch_active" = "1" ]; then
    rollback unexpected_error || true
  fi
  exit 1
}

switch_active="1"
trap handle_unexpected_error ERR INT TERM
if ! docker stop --time "$STOP_TIMEOUT_SECONDS" "$CONTAINER_NAME" >/dev/null; then
  rollback stop_failed || true
  exit 1
fi
if ! docker rename "$CONTAINER_NAME" "$previous_name"; then
  rollback rename_failed || true
  exit 1
fi
previous_ready="1"

if ! docker create --name "$CONTAINER_NAME" "${runtime_args[@]}" "$IMAGE" >/dev/null; then
  rollback create_failed || true
  exit 1
fi
if ! docker start "$CONTAINER_NAME" >/dev/null; then
  rollback start_failed || true
  exit 1
fi
if ! wait_healthy "$CONTAINER_NAME"; then
  rollback health_timeout || true
  exit 1
fi

switch_active="0"
trap - ERR INT TERM
emit true switched "$previous_name"
