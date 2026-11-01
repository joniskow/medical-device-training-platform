targetScope = 'resourceGroup'

param location string = 'centralus'
param workerContainerAppName string = 'mdt-personal-worker'
param managedEnvironmentName string = 'mdt-personal-aca-private'
param workerIdentityName string = 'mdt-personal-worker-id'
param keyVaultName string = 'mdtpersonalkv01'
param containerRegistryName string = 'mdtpersonalacr01'
param image string
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

resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: workerContainerAppName
  location: location
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
        {
          name: 'postgres-runtime-password'
          keyVaultUrl: '${keyVaultUri}/secrets/postgres-runtime-password'
          identity: workerIdentity.id
        }
        {
          name: 'postgres-admin-password'
          keyVaultUrl: '${keyVaultUri}/secrets/postgres-admin-password'
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
            { name: 'AZURE_CLIENT_ID', value: workerIdentity.properties.clientId }
            { name: 'ASSET_PROCESSOR_MODULE', value: './pilot-asset-processor.js' }
            { name: 'WORKER_ID', value: workerId }
            { name: 'RUN_DATABASE_MIGRATIONS', value: 'true' }
            { name: 'POSTGRES_HOST', value: postgresHost }
            { name: 'POSTGRES_DATABASE', value: 'medical_device' }
            { name: 'POSTGRES_RUNTIME_LOGIN', value: 'medical_device_runtime' }
            { name: 'POSTGRES_ADMIN_LOGIN', value: 'mdtadmin' }
            { name: 'POSTGRES_OUTBOX_LOGIN', value: 'medical_device_outbox_publisher' }
            { name: 'POSTGRES_RUNTIME_PASSWORD', secretRef: 'postgres-runtime-password' }
            { name: 'POSTGRES_ADMIN_PASSWORD', secretRef: 'postgres-admin-password' }
            { name: 'POSTGRES_OUTBOX_PASSWORD', secretRef: 'postgres-outbox-password' }
            { name: 'SERVICE_BUS_NAMESPACE', value: serviceBusNamespace }
            { name: 'SERVICE_BUS_QUEUE_NAME', value: serviceBusQueueName }
            { name: 'SERVICE_BUS_SIGNING_SECRET', secretRef: 'service-bus-signing-secret' }
            { name: 'STORAGE_ACCOUNT_URL', value: storageAccountUrl }
            { name: 'STORAGE_CONTAINER_NAME', value: storageContainerName }
            { name: 'SEED_PILOT_MEMBERSHIP', value: string(seedPilotMembership) }
            { name: 'PILOT_SUBJECT', value: pilotSubject }
            { name: 'PILOT_ORGANIZATION_ID', value: pilotOrganizationId }
            { name: 'RECONSTRUCTION_PYTHON', value: '/opt/reconstruction-runtime/bin/python' }
            { name: 'PHOTOGRAMMETRY_PYTHON', value: '/opt/reconstruction-runtime/bin/python' }
            { name: 'RECONSTRUCTION_SCRIPTS_DIR', value: '/opt/reconstruction-scripts' }
            { name: 'PHOTOGRAMMETRY_OPENMVS_DIR', value: '/opt/openmvs' }
            { name: 'RECONSTRUCTION_WORK_DIR', value: '/tmp/reconstruction' }
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
