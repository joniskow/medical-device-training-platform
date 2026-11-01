targetScope = 'resourceGroup'

@description('Short environment name used in resource tags and outputs.')
param environmentName string = 'personal'

@description('Azure region for the asset-pipeline resources.')
param location string = resourceGroup().location

@description('Existing private Blob Storage account used for source and derived assets.')
param storageAccountName string

@description('Existing Service Bus namespace used by the durable job/outbox pipeline.')
param serviceBusNamespaceName string

@description('Existing worker identity that consumes processing queues.')
param workerIdentityName string

@description('Existing API identity that submits processing jobs.')
param apiIdentityName string

@description('Private containers required by the asset and reconstruction pipeline.')
param containerNames array = [
  'source-assets'
  'reconstruction-artifacts'
  'video-plates'
  'renders'
  'published-assets'
  'quarantine'
]

@description('Queues used for asynchronous validation, reconstruction, rendering and publication work.')
param processingQueueNames array = [
  'asset-processing'
  'model-reconstruction'
  'model-render'
  'asset-validation'
  'video-plate-generation'
]

@minValue(1)
param coolAfterDays int = 30

@minValue(1)
param previousVersionCoolAfterDays int = 90

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource storageBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource assetContainers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [for containerName in containerNames: {
  parent: storageBlobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}]

resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          enabled: true
          name: 'cool-derived-and-published-assets'
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: [
                'blockBlob'
              ]
              prefixMatch: [
                'reconstruction-artifacts/'
                'video-plates/'
                'renders/'
                'published-assets/'
              ]
            }
            actions: {
              baseBlob: {
                tierToCool: {
                  daysAfterModificationGreaterThan: coolAfterDays
                }
              }
              version: {
                tierToCool: {
                  daysAfterCreationGreaterThan: previousVersionCoolAfterDays
                }
              }
            }
          }
        }
      ]
    }
  }
}

resource serviceBus 'Microsoft.ServiceBus/namespaces@2024-01-01' existing = {
  name: serviceBusNamespaceName
}

resource processingQueues 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' = [for queueName in processingQueueNames: {
  parent: serviceBus
  name: queueName
  properties: {
    lockDuration: 'PT5M'
    maxDeliveryCount: 10
    defaultMessageTimeToLive: 'P14D'
    deadLetteringOnMessageExpiration: true
    requiresDuplicateDetection: false
    enablePartitioning: false
  }
}]

resource workerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: workerIdentityName
}

resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: apiIdentityName
}

resource workerReceiver 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (queueName, index) in processingQueueNames: {
  name: guid(processingQueues[index].id, workerIdentity.id, 'asset-pipeline-worker-receiver')
  scope: processingQueues[index]
  properties: {
    principalId: workerIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4a9ae827-6dc8-4573-8ac7-8239d42aa03f')
  }
}]

resource apiSender 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (queueName, index) in processingQueueNames: {
  name: guid(processingQueues[index].id, apiIdentity.id, 'asset-pipeline-api-sender')
  scope: processingQueues[index]
  properties: {
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39')
  }
}]

output assetContainers array = containerNames
output processingQueues array = processingQueueNames
output environment string = environmentName
output region string = location
output storageAccountUrl string = 'https://${storageAccountName}.blob.${environment().suffixes.storage}'
