targetScope = 'resourceGroup'

param location string = 'centralus'
param workerContainerAppName string = 'mdt-personal-worker'
param managedEnvironmentName string = 'mdt-personal-aca-private'
param workerIdentityName string = 'mdt-personal-worker-id'
param keyVaultName string = 'mdtpersonalkv01'
param containerRegistryName string = 'mdtpersonalacr01'
param image string
@description('Enable only with a tested worker-single-image image digest; preserves photo/video on the same durable queue.')
param singleImageEnabled bool = false
@allowed(['staging', 'production'])
param appEnvironment string = 'staging'
param clamavHost string
param openMontageProviderUrl string
param azureSpeechEndpoint string
param azureEmbeddingEndpoint string
param azureEmbeddingDeployment string
@allowed(['text-embedding-3-small', 'text-embedding-3-large'])
param azureEmbeddingModel string
@description('Reviewed source-usage rate entries; empty records measured units with unknown monetary cost.')
param sourceUsageRatesJson string = '[]'
param communicationServiceName string
param communicationEmailSenderRoleDefinitionId string
param acsEmailEndpoint string
param acsEmailSender string
param applicationOrigin string
param invitationActiveKeyId string
@minValue(1)
@maxValue(50000)
param assetMaxRunCostCents int = 100
@minValue(1)
@maxValue(50000)
param reconstructionMaxRunCostCents int = 1000
@minValue(1)
@maxValue(50000)
param videoMaxRunCostCents int = 1000
@minValue(1)
@maxValue(50000)
param lessonMaxRunCostCents int = 500
@allowed([true])
@description('Required reviewed worst-case cost attestation. Defaults are planning placeholders, not measurements.')
param costReservationsReviewed bool
param postgresHost string = 'mdt-personal-pg.postgres.database.azure.com'
param serviceBusNamespace string = 'mdt-personal-sb-01.servicebus.windows.net'
param storageAccountName string = 'mdtpersonalstorage01'
param serviceBusQueueName string = 'asset-processing'
param storageContainerName string = 'source-assets'
param workerId string = 'mdt-personal-worker'
@description('Whether this deployment should seed the pilot subject membership during bootstrap.')
param seedPilotMembership bool = false
@description('Microsoft Entra subject to seed when seedPilotMembership is enabled.')
param pilotSubject string = ''
@description('Organization identifier to seed when seedPilotMembership is enabled.')
param pilotOrganizationId string = ''

var keyVaultUri = 'https://${keyVaultName}${environment().suffixes.keyvaultDns}'
var storageAccountUrl = 'https://${storageAccountName}.blob.${environment().suffixes.storage}'

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: managedEnvironmentName
}

resource workerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: workerIdentityName
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: containerRegistryName
}

resource workerVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = { name: keyVaultName }
var workerExtraSecretNames = ['azure-speech-key', 'azure-embedding-api-key', 'webhook-keys-json', 'invitation-token-keys-json']
resource workerExtraSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = [for name in workerExtraSecretNames: { parent: workerVault, name: name }]
resource workerSpeechSecretReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (name,i) in workerExtraSecretNames: {
  name: guid(workerExtraSecrets[i].id, workerIdentity.id, 'worker-extra-secret-reader')
  scope: workerExtraSecrets[i]
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: workerIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}]
resource communication 'Microsoft.Communication/communicationServices@2023-03-31' existing = {name:communicationServiceName}
resource workerEmailSender 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name:guid(communication.id,workerIdentity.id,'worker-email-sender')
  scope:communication
  properties:{roleDefinitionId:communicationEmailSenderRoleDefinitionId,principalId:workerIdentity.properties.principalId,principalType:'ServicePrincipal'}
}

resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: workerContainerAppName
  location: location
  dependsOn: [workerSpeechSecretReader, workerEmailSender]
  tags: {
    project: 'medical-device-training'
    environment: 'personal'
    component: 'worker'
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${workerIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: containerRegistry.properties.loginServer
          identity: workerIdentity.id
        }
      ]
      secrets: [
        { name: 'azure-speech-key', keyVaultUrl: '${keyVaultUri}/secrets/azure-speech-key', identity: workerIdentity.id }
        { name: 'azure-embedding-api-key', keyVaultUrl: '${keyVaultUri}/secrets/azure-embedding-api-key', identity: workerIdentity.id }
        { name: 'webhook-keys-json', keyVaultUrl: '${keyVaultUri}/secrets/webhook-keys-json', identity: workerIdentity.id }
        { name: 'invitation-token-keys-json', keyVaultUrl: '${keyVaultUri}/secrets/invitation-token-keys-json', identity: workerIdentity.id }
        {
          name: 'postgres-runtime-password'
          keyVaultUrl: '${keyVaultUri}/secrets/postgres-runtime-password'
          identity: workerIdentity.id
        }
        {
          name: 'postgres-outbox-password'
          keyVaultUrl: '${keyVaultUri}/secrets/postgres-outbox-password'
          identity: workerIdentity.id
        }
        {
          name: 'service-bus-signing-secret'
          keyVaultUrl: '${keyVaultUri}/secrets/service-bus-signing-secret'
          identity: workerIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: image
          resources: {
            cpu: json('4.0')
            memory: '8Gi'
          }
          env: [
            { name: 'APP_ENV', value: appEnvironment }
            { name: 'AUDIT_LOGGING_ENABLED', value: 'true' }
            { name: 'ASSET_SCANNER_MODE', value: 'clamav' }
            { name: 'CLAMAV_HOST', value: clamavHost }
            { name: 'OPENMONTAGE_PROVIDER_MODE', value: 'http' }
            { name: 'OPENMONTAGE_PROVIDER_URL', value: openMontageProviderUrl }
            { name: 'AZURE_SPEECH_MODE', value: 'http' }
            { name: 'AZURE_SPEECH_ENDPOINT', value: azureSpeechEndpoint }
            { name: 'AZURE_SPEECH_API_KEY', secretRef: 'azure-speech-key' }
            { name: 'RETRIEVAL_MODE', value: 'hybrid' }
            { name: 'AZURE_EMBEDDING_ENDPOINT', value: azureEmbeddingEndpoint }
            { name: 'AZURE_EMBEDDING_DEPLOYMENT', value: azureEmbeddingDeployment }
            { name: 'AZURE_EMBEDDING_MODEL', value: azureEmbeddingModel }
            { name: 'AZURE_EMBEDDING_API_KEY', secretRef: 'azure-embedding-api-key' }
            { name: 'SOURCE_USAGE_RATES_JSON', value: sourceUsageRatesJson }
            { name: 'AI_MAX_OUTPUT_TOKENS', value: '4000' }
            { name: 'ASSET_MAX_RUN_COST_CENTS', value: string(assetMaxRunCostCents) }
            { name: 'RECONSTRUCTION_MAX_RUN_COST_CENTS', value: string(reconstructionMaxRunCostCents) }
            { name: 'VIDEO_MAX_RUN_COST_CENTS', value: string(videoMaxRunCostCents) }
            { name: 'LESSON_MAX_RUN_COST_CENTS', value: string(lessonMaxRunCostCents) }
            { name: 'COST_RESERVATIONS_REVIEWED', value: string(costReservationsReviewed) }
            { name: 'WEBHOOK_KEYS_JSON', secretRef: 'webhook-keys-json' }
            { name: 'INVITATION_TOKEN_KEYS_JSON', secretRef: 'invitation-token-keys-json' }
            { name: 'INVITATION_ACTIVE_KEY_ID', value: invitationActiveKeyId }
            { name: 'INVITATION_EMAIL_ENABLED', value: 'true' }
            { name: 'ACS_EMAIL_ENDPOINT', value: acsEmailEndpoint }
            { name: 'ACS_EMAIL_SENDER_ADDRESS', value: acsEmailSender }
            { name: 'APPLICATION_ORIGIN', value: applicationOrigin }
            { name: 'INVITATION_EMAIL_GLOBAL_PER_MINUTE', value: '30' }
            { name: 'INVITATION_EMAIL_ORGANIZATION_PER_MINUTE', value: '10' }
            { name: 'AZURE_CLIENT_ID', value: workerIdentity.properties.clientId }
            { name: 'ASSET_PROCESSOR_MODULE', value: './pilot-asset-processor.js' }
            { name: 'WORKER_ID', value: workerId }
            { name: 'RUN_DATABASE_MIGRATIONS', value: 'false' }
            { name: 'POSTGRES_HOST', value: postgresHost }
            { name: 'POSTGRES_DATABASE', value: 'medical_device' }
            { name: 'POSTGRES_RUNTIME_LOGIN', value: 'medical_device_runtime' }
            { name: 'POSTGRES_OUTBOX_LOGIN', value: 'medical_device_outbox_publisher' }
            { name: 'POSTGRES_RUNTIME_PASSWORD', secretRef: 'postgres-runtime-password' }
            { name: 'POSTGRES_OUTBOX_PASSWORD', secretRef: 'postgres-outbox-password' }
            { name: 'SERVICE_BUS_NAMESPACE', value: serviceBusNamespace }
            { name: 'SERVICE_BUS_QUEUE_NAME', value: serviceBusQueueName }
            { name: 'SERVICE_BUS_SIGNING_SECRET', secretRef: 'service-bus-signing-secret' }
            { name: 'STORAGE_ACCOUNT_URL', value: storageAccountUrl }
            { name: 'STORAGE_CONTAINER_NAME', value: storageContainerName }
            { name: 'SEED_PILOT_MEMBERSHIP', value: string(seedPilotMembership) }
            { name: 'PILOT_SUBJECT', value: pilotSubject }
            { name: 'PILOT_ORGANIZATION_ID', value: pilotOrganizationId }
            { name: 'RECONSTRUCTION_SINGLE_IMAGE_ENABLED', value: string(singleImageEnabled) }
            { name: 'RECONSTRUCTION_MODES', value: singleImageEnabled ? 'single-image,multi-view,video' : 'multi-view,video' }
            { name: 'RECONSTRUCTION_PYTHON', value: singleImageEnabled ? '/opt/single-image/runtime/bin/python' : '/opt/reconstruction-runtime/bin/python' }
            { name: 'RECONSTRUCTION_ASSETS_DIR', value: singleImageEnabled ? '/opt/single-image/assets' : '' }
            { name: 'RECONSTRUCTION_SINGLE_IMAGE_CODE_DIR', value: '/opt/TripoSR' }
            { name: 'RECONSTRUCTION_SINGLE_IMAGE_MANIFEST', value: '/opt/single-image/runtime-manifest.json' }
            { name: 'PHOTOGRAMMETRY_PYTHON', value: '/opt/reconstruction-runtime/bin/python' }
            { name: 'PHOTOGRAMMETRY_FFMPEG', value: '/usr/bin/ffmpeg' }
            { name: 'PHOTOGRAMMETRY_FFPROBE', value: '/usr/bin/ffprobe' }
            { name: 'RECONSTRUCTION_SCRIPTS_DIR', value: '/opt/reconstruction-scripts' }
            { name: 'PHOTOGRAMMETRY_OPENMVS_DIR', value: '/opt/openmvs' }
            { name: 'RECONSTRUCTION_WORK_DIR', value: '/tmp/reconstruction' }
            { name: 'BLENDER_EXECUTABLE', value: '/usr/bin/blender' }
            { name: 'BLENDER_SCRIPT', value: '/opt/reconstruction-scripts/blender_postprocess.py' }
            { name: 'WORKER_MAX_CONCURRENT_CALLS', value: '1' }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output workerContainerAppName string = worker.name
output workerIdentityPrincipalId string = workerIdentity.properties.principalId
