#!/usr/bin/env bash
# End-to-end test: builds this library, deploys a real Lambda function that uses
# MetricsSetups.lightstepNativeOtlpButItSendsMetricsUponRecordingForLambda() into a real
# LocalStack Lambda execution container, invokes it, and asserts a fake OTLP collector
# (running as its own container on the same docker network) actually received the metric.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
FUNCTION_NAME="goodmetrics-lambda-e2e-test"

export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export AWS_DEFAULT_REGION=us-east-1
AWS_ENDPOINT="http://localhost:4566"

cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- run.sh failed (exit $status); dumping container logs ---"
    docker compose -f "$COMPOSE_FILE" logs --tail=200 || true
  fi
  echo "--- tearing down docker compose stack ---"
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans || true
}
trap cleanup EXIT

echo "--- building goodmetrics-nodejs ---"
cd "$REPO_ROOT"
npm run build

echo "--- packing goodmetrics-nodejs as a real tarball (not a symlink) ---"
rm -f "$SCRIPT_DIR"/goodmetrics-nodejs-*.tgz
PACK_NAME="$(npm pack --silent --pack-destination "$SCRIPT_DIR")"

echo "--- preparing lambda handler bundle ---"
HANDLER_DIR="$SCRIPT_DIR/handler"
rm -rf "$HANDLER_DIR/node_modules" "$SCRIPT_DIR/handler.zip"
(cd "$HANDLER_DIR" && npm install --no-save --no-package-lock --omit=dev --registry https://registry.npmjs.org/ "../$PACK_NAME")
(cd "$HANDLER_DIR" && zip -r -q "$SCRIPT_DIR/handler.zip" . -x 'node_modules/.package-lock.json')

echo "--- starting localstack + fake collector ---"
docker compose -f "$COMPOSE_FILE" up -d --build --wait

# Match the Lambda's architecture to the host so Docker doesn't have to emulate a foreign
# architecture (which manifests as segfaults in the Node runtime, not a clean error) - this
# matters on Apple Silicon hosts, where `aws lambda create-function`'s x86_64 default would
# otherwise be emulated. On x86_64 CI runners this just resolves to x86_64 as it would anyway.
case "$(uname -m)" in
  arm64|aarch64) LAMBDA_ARCH="arm64" ;;
  *) LAMBDA_ARCH="x86_64" ;;
esac

echo "--- deploying lambda function (architecture: $LAMBDA_ARCH) ---"
aws --endpoint-url="$AWS_ENDPOINT" lambda create-function \
  --function-name "$FUNCTION_NAME" \
  --runtime nodejs20.x \
  --architectures "$LAMBDA_ARCH" \
  --handler handler.handler \
  --zip-file "fileb://$SCRIPT_DIR/handler.zip" \
  --role arn:aws:iam::000000000000:role/lambda-role \
  --environment "Variables={COLLECTOR_HOST=collector,COLLECTOR_PORT=4317}" \
  --timeout 30 >/dev/null

aws --endpoint-url="$AWS_ENDPOINT" lambda wait function-active-v2 \
  --function-name "$FUNCTION_NAME"

echo "--- invoking lambda function ---"
INVOKE_OUT="$(mktemp)"
aws --endpoint-url="$AWS_ENDPOINT" lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload '{}' \
  "$INVOKE_OUT" >/dev/null
echo "invoke response:"
cat "$INVOKE_OUT"
echo

if grep -q '"FunctionError"' "$INVOKE_OUT" 2>/dev/null; then
  echo "lambda invocation reported a FunctionError"
  exit 1
fi

echo "--- polling fake collector for the emitted metric ---"
FOUND=""
for _ in $(seq 1 30); do
  RECEIVED="$(curl -sf http://localhost:8080/received || echo '[]')"
  if echo "$RECEIVED" | grep -q 'lambda_e2e_test_metric_invocations'; then
    FOUND=1
    break
  fi
  sleep 1
done

if [ -z "$FOUND" ]; then
  echo "collector never received lambda_e2e_test_metric_invocations. Last response:"
  echo "$RECEIVED"
  exit 1
fi

echo "success: collector received the metric emitted from a real LocalStack Lambda invocation"
echo "$RECEIVED"
