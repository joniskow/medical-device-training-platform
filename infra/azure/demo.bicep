targetScope = 'resourceGroup'
param image string
param name string = 'mdt-personal-demo'
param operatorObjectId string
param operatorRoleAssignmentName string = ''
param tenantId string
param audience string
param browserClientId string
param browserAuthority string
param browserScope string
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = { name: 'mdt-personal-aca-private' }
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = { name: 'mdtpersonalstorage01' }
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = { name: 'mdtpersonalacr01' }
resource motion 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: 'mdtpersonalmotion01'
  location: 'eastus2'
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: { customSubDomainName: 'mdtpersonalmotion01', allowProjectManagement: true, publicNetworkAccess: 'Enabled' }
}
resource model 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: motion
  name: 'training-motion'
  sku: { name: 'GlobalStandard', capacity: 1 }
  properties: { model: { format: 'fal.ai', name: 'Fal-LTX-2.5-Fast', version: '2026-11-02' } }
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = { name: '${name}-id', location: 'centralus' }
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = { parent: storage, name: 'default' }
resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = { parent: blobs, name: 'demo-media', properties: { publicAccess: 'None' } }
var roles = [
  { scope: storage.id, role: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe' }
  { scope: registry.id, role: '7f951dda-4ed3-4680-a7ca-43fe172d538d' }
  { scope: motion.id, role: 'a97b65f3-24c7-4388-baec-2e87135dc908' }
]
resource storageRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(storage.id, identity.id, roles[0].role), scope: storage, properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles[0].role) } }
resource registryRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(registry.id, identity.id, roles[1].role), scope: registry, properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles[1].role) } }
resource motionRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: guid(motion.id, identity.id, roles[2].role), scope: motion, properties: { principalId: identity.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles[2].role) } }
resource operatorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = { name: empty(operatorRoleAssignmentName) ? guid(motion.id, operatorObjectId, roles[2].role) : operatorRoleAssignmentName, scope: motion, properties: { principalId: operatorObjectId, principalType: 'User', roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles[2].role) } }
var origin = 'https://${name}.${environment.properties.defaultDomain}'
resource demo 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: 'centralus'
  tags: { project: 'medical-device-training', component: 'hosted-demo' }
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: environment.id
    configuration: { activeRevisionsMode: 'Single', ingress: { external: true, targetPort: 8080, transport: 'http', allowInsecure: false }, registries: [{ server: registry.properties.loginServer, identity: identity.id }] }
    template: {
      containers: [{
        name: 'demo'
        image: image
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'APPLICATION_ORIGIN', value: origin }
          { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
          { name: 'DEMO_STORAGE_URL', value: storage.properties.primaryEndpoints.blob }
          { name: 'AZURE_MOTION_ENDPOINT', value: 'https://mdtpersonalmotion01.services.ai.azure.com/' }
          { name: 'AZURE_MOTION_DEPLOYMENT', value: model.name }
          { name: 'DEMO_GENERATION_ALLOWED_SUBJECTS', value: operatorObjectId }
          { name: 'ENTRA_TENANT_ID', value: tenantId }
          { name: 'ENTRA_AUDIENCE', value: audience }
          { name: 'ENTRA_OPENID_CONFIGURATION_URL', value: '${browserAuthority}/v2.0/.well-known/openid-configuration' }
          { name: 'BROWSER_AUTH_CLIENT_ID', value: browserClientId }
          { name: 'BROWSER_AUTH_AUTHORITY', value: browserAuthority }
          { name: 'BROWSER_AUTH_API_SCOPE', value: browserScope }
        ]
        probes: [{ type: 'Readiness', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 10, failureThreshold: 6 }]
      }]
      scale: { minReplicas: 0, maxReplicas: 1, rules: [{ name: 'http', http: { metadata: { concurrentRequests: '10' } } }] }
    }
  }
  dependsOn: [storageRole, registryRole, motionRole, container]
}
output url string = '${origin}/demo?model=nxstage-review'
