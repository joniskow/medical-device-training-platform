#!/usr/bin/env bash
set -euo pipefail

# Creates the personal-tenant pilot foundation. Secrets are generated in memory
# and passed directly to the deployment; they are not written to this project.

SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-e30f800a-473e-4040-9622-6ea38413c991}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-medical-device-personal}"
LOCATION="${LOCATION:-centralus}"
ENVIRONMENT_NAME="${ENVIRONMENT_NAME:-personal}"
STORAGE_ACCOUNT="${STORAGE_ACCOUNT:-mdtpersonalstorage01}"
CONTAINER_REGISTRY="${CONTAINER_REGISTRY:-mdtpersonalacr01}"
SERVICE_BUS_NAMESPACE="${SERVICE_BUS_NAMESPACE:-mdt-personal-sb-01}"
QUEUE_NAME="${QUEUE_NAME:-asset-processing}"

az account set --subscription "$SUBSCRIPTION_ID"

for namespace in \
  Microsoft.ContainerRegistry \
  Microsoft.Storage \
  Microsoft.ServiceBus \
  Microsoft.Network \
  Microsoft.OperationalInsights \
  Microsoft.ManagedIdentity \
  Microsoft.App \
  Microsoft.KeyVault \
  Microsoft.DBforPostgreSQL; do
  az provider register --namespace "$namespace" --wait --output none
done

az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --tags project=medical-device-training environment=personal owner=joniskow@gmail.com \
  --output none

if ! az acr show --resource-group "$RESOURCE_GROUP" --name "$CONTAINER_REGISTRY" --output none 2>/dev/null; then
  az acr create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$CONTAINER_REGISTRY" \
    --sku Standard \
    --admin-enabled false \
    --output none
fi

if ! az storage account show --resource-group "$RESOURCE_GROUP" --name "$STORAGE_ACCOUNT" --output none 2>/dev/null; then
  az storage account create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$STORAGE_ACCOUNT" \
    --location "$LOCATION" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --access-tier Hot \
    --min-tls-version TLS1_2 \
    --https-only true \
    --allow-blob-public-access false \
    --output none
fi

STORAGE_PUBLIC_ACCESS="$(az storage account show --resource-group "$RESOURCE_GROUP" --name "$STORAGE_ACCOUNT" --query 'publicNetworkAccess' --output tsv)"
if [[ "$STORAGE_PUBLIC_ACCESS" != "Disabled" ]]; then
  STORAGE_KEY="$(az storage account keys list --resource-group "$RESOURCE_GROUP" --account-name "$STORAGE_ACCOUNT" --query '[0].value' --output tsv)"
  if ! az storage container show \
    --account-name "$STORAGE_ACCOUNT" \
    --account-key "$STORAGE_KEY" \
    --name assets \
    --output none 2>/dev/null; then
    az storage container create \
      --account-name "$STORAGE_ACCOUNT" \
      --account-key "$STORAGE_KEY" \
      --name assets \
      --public-access off \
      --output none
  fi
  unset STORAGE_KEY
fi

if ! az servicebus namespace show --resource-group "$RESOURCE_GROUP" --name "$SERVICE_BUS_NAMESPACE" --output none 2>/dev/null; then
  az servicebus namespace create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$SERVICE_BUS_NAMESPACE" \
    --location "$LOCATION" \
    --sku Basic \
    --disable-local-auth true \
    --output none
fi
if ! az servicebus queue show --resource-group "$RESOURCE_GROUP" --namespace-name "$SERVICE_BUS_NAMESPACE" --name "$QUEUE_NAME" --output none 2>/dev/null; then
  az servicebus queue create \
    --max-size 1024 \
    --resource-group "$RESOURCE_GROUP" \
    --namespace-name "$SERVICE_BUS_NAMESPACE" \
    --name "$QUEUE_NAME" \
    --output none
fi

az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --name "worker-foundation-personal" \
  --template-file /workspace/infra/azure/worker-foundation.bicep \
  --parameters environmentName="$ENVIRONMENT_NAME" location="$LOCATION" serviceBusNamespaceName="$SERVICE_BUS_NAMESPACE" storageAccountName="$STORAGE_ACCOUNT" queueName="$QUEUE_NAME" \
  --output none

POSTGRES_ADMIN_PASSWORD="$(openssl rand -hex 24)"
POSTGRES_RUNTIME_PASSWORD="$(openssl rand -hex 24)"
POSTGRES_OUTBOX_PASSWORD="$(openssl rand -hex 24)"
SERVICE_BUS_SIGNING_SECRET="$(openssl rand -hex 32)"

az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --name "data-foundation-personal" \
  --template-file /workspace/infra/azure/data-foundation.bicep \
  --parameters environmentName="$ENVIRONMENT_NAME" location="$LOCATION" \
    logAnalyticsWorkspaceName="mdt-${ENVIRONMENT_NAME}-logs" \
    storageAccountName="$STORAGE_ACCOUNT" \
    workerIdentityName="mdt-${ENVIRONMENT_NAME}-worker-id" \
    postgresAdminPassword="$POSTGRES_ADMIN_PASSWORD" \
    postgresRuntimePassword="$POSTGRES_RUNTIME_PASSWORD" \
    postgresOutboxPassword="$POSTGRES_OUTBOX_PASSWORD" \
    serviceBusSigningSecret="$SERVICE_BUS_SIGNING_SECRET" \
  --output none

az storage account update \
  --resource-group "$RESOURCE_GROUP" \
  --name "$STORAGE_ACCOUNT" \
  --public-network-access Disabled \
  --output none

az acr build \
  --registry "$CONTAINER_REGISTRY" \
  --image api:personal-20261022-foundation \
  --file /workspace/Dockerfile.api \
  /workspace \
  --output none

az acr build \
  --registry "$CONTAINER_REGISTRY" \
  --image worker:personal-20261022-foundation \
  --file /workspace/Dockerfile.worker \
  /workspace \
  --output none

printf 'FOUNDATION_READY resourceGroup=%s location=%s registry=%s storage=%s serviceBus=%s\n' \
  "$RESOURCE_GROUP" "$LOCATION" "$CONTAINER_REGISTRY" "$STORAGE_ACCOUNT" "$SERVICE_BUS_NAMESPACE"
