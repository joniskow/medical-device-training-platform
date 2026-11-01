targetScope = 'resourceGroup'

@description('Existing ACS resource in this resource group.')
param communicationServiceName string
@description('Location of the existing ACS resource (often global); must match the source.')
param communicationServiceLocation string
@description('New dedicated namespace; do not reuse the asset-processing namespace.')
param reportNamespaceName string
param workerPrincipalId string
param location string = resourceGroup().location
param queueName string = 'email-delivery-reports'
@description('Approved ISO-8601 queue retention, for example P7D. No retention default is assumed.')
param messageTimeToLive string
@minValue(1)
@maxValue(1440)
param eventTimeToLiveMinutes int
@description('Existing private storage account/container for Event Grid delivery failures.')
param deadLetterStorageAccountName string
param deadLetterContainerName string

resource communication 'Microsoft.Communication/communicationServices@2023-03-31' existing = {
  name: communicationServiceName
}
resource reportBus 'Microsoft.ServiceBus/namespaces@2024-01-01' = {
  name: reportNamespaceName
  location: location
  sku: { name: 'Standard', tier: 'Standard' }
  properties: {
    disableLocalAuth: true
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}
resource queue 'Microsoft.ServiceBus/namespaces/queues@2024-01-01' = {
  parent: reportBus
  name: queueName
  properties: {
    lockDuration: 'PT1M'
    maxDeliveryCount: 5
    defaultMessageTimeToLive: messageTimeToLive
    deadLetteringOnMessageExpiration: true
    requiresDuplicateDetection: false
  }
}
resource systemTopic 'Microsoft.EventGrid/systemTopics@2022-06-15' = {
  name: '${communicationServiceName}-email-reports'
  location: communicationServiceLocation
  identity: { type: 'SystemAssigned' }
  properties: {
    source: communication.id
    topicType: 'Microsoft.Communication.CommunicationServices'
  }
}
resource deadLetterStorage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: deadLetterStorageAccountName
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  parent: deadLetterStorage
  name: 'default'
}
resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' existing = {
  parent: blobs
  name: deadLetterContainerName
}
resource eventSender 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(queue.id, systemTopic.id, 'email-report-sender')
  scope: queue
  properties: {
    principalId: systemTopic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39')
  }
}
resource workerReceiver 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(queue.id, workerPrincipalId, 'email-report-receiver')
  scope: queue
  properties: {
    principalId: workerPrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0')
  }
}
resource deadLetterWriter 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(container.id, systemTopic.id, 'email-report-deadletter')
  scope: container
  properties: {
    principalId: systemTopic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
  }
}
resource subscription 'Microsoft.EventGrid/systemTopics/eventSubscriptions@2022-06-15' = {
  parent: systemTopic
  name: 'email-delivery-reports'
  dependsOn: [ eventSender, deadLetterWriter ]
  properties: {
    eventDeliverySchema: 'EventGridSchema'
    filter: { includedEventTypes: [ 'Microsoft.Communication.EmailDeliveryReportReceived' ] }
    retryPolicy: { maxDeliveryAttempts: 30, eventTimeToLiveInMinutes: eventTimeToLiveMinutes }
    deliveryWithResourceIdentity: {
      identity: { type: 'SystemAssigned' }
      destination: { endpointType: 'ServiceBusQueue', properties: { resourceId: queue.id } }
    }
    deadLetterWithResourceIdentity: {
      identity: { type: 'SystemAssigned' }
      deadLetterDestination: {
        endpointType: 'StorageBlob'
        properties: { resourceId: deadLetterStorage.id, blobContainerName: deadLetterContainerName }
      }
    }
  }
}
output namespace string = '${reportBus.name}.servicebus.windows.net'
output reportsQueue string = queue.name
output expectedTopic string = communication.id
