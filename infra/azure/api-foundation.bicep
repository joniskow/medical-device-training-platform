targetScope = 'resourceGroup'

@description('Azure region for the API container.')
param location string = 'centralus'

@description('API Container App name.')
param apiContainerAppName string = 'mdt-devcentral-api'

@description('Existing private Container Apps environment.')
param managedEnvironmentName string = 'mdt-devcentral-aca-private'

@description('User-assigned identity name for the API.')
param apiIdentityName string = 'mdt-devcentral-api-id'

@description('Existing Key Vault containing the runtime database password.')
param keyVaultName string = 'mdtdevcentralkv01'

@description('Existing Azure Container Registry name.')
param containerRegistryName string = 'mdtdevacr01'

@description('Existing private Blob Storage account used for source uploads.')
param storageAccountName string = 'mdtdevstorage01'

@description('Container image to deploy.')
param image string

@description('PostgreSQL private DNS hostname.')
param postgresHost string = 'mdt-devcentral-pg.postgres.database.azure.com'

@description('Microsoft Entra tenant ID.')
param entraTenantId string = '7d46aa07-85c8-4b7a-81d3-320765424537'

@description('API application audience accepted from Microsoft Entra tokens.')
param entraAudience string

@description('OpenID configuration URL for Microsoft Entra.')
param entraOpenIdConfigurationUrl string

@description('Optional issuer override. Leave empty to use the discovered issuer.')
param entraIssuer string = ''

@description('JWT claim containing the organization identifier.')
param entraOrganizationClaim string = 'organization_id'

@description('JWT claim containing application roles.')
param entraRolesClaim string = 'roles'

@description('Comma-separated browser origins allowed to call the API.')
param allowedOrigins string = ''

@description('Minimum number of API replicas. Zero is lowest cost and allows cold starts.')
param minReplicas int = 0

@description('Maximum number of API replicas for the pilot.')
param maxReplicas int = 1

@description('Reconstruction modes enabled for the deployed POC.')
param reconstructionModes string = 'multi-view'

@description('Enable the managed browser authentication flow.')
param browserAuthEnabled bool = false

@description('SPA client application ID used by the managed browser authentication flow.')
param browserAuthClientId string = ''

@description('Microsoft Entra authority URL used by the managed browser authentication flow.')
param browserAuthAuthority string = ''

@description('Explicit API scope requested by the browser client.')
param browserAuthApiScope string = ''

@description('Canonical HTTPS origin used for browser authentication redirects.')
param applicationOrigin string = ''

var keyVaultUri = 'https://${keyVaultName}${environment().suffixes.keyvaultDns}'

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: managedEnvironmentName
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: containerRegistryName
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource apiIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: apiIdentityName
  location: location
  tags: {
    project: 'medical-device-training'
    environment: 'personal'
    component: 'api'
  }
}

resource apiKeyVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, apiIdentity.id, 'api-key-vault-secrets-user')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource apiAcrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(containerRegistry.id, apiIdentity.id, 'api-acr-pull')
  scope: containerRegistry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource apiStorageBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, apiIdentity.id, 'api-storage-blob-data-contributor')
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource apiStorageBlobDelegatorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, apiIdentity.id, 'api-storage-blob-delegator')
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'db58b8e5-c6ad-4a2a-8342-4190687cbf4a')
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: apiContainerAppName
  location: location
  dependsOn: [
    apiKeyVaultRole
    apiAcrPullRole
    apiStorageBlobRole
    apiStorageBlobDelegatorRole
  ]
  tags: {
    project: 'medical-device-training'
    environment: 'dev'
    component: 'api'
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${apiIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: containerRegistry.properties.loginServer
          identity: apiIdentity.id
        }
      ]
      secrets: [
        {
          name: 'database-runtime-password'
          keyVaultUrl: '${keyVaultUri}/secrets/postgres-runtime-password'
          identity: apiIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: image
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'AZURE_CLIENT_ID', value: apiIdentity.properties.clientId }
            { name: 'PORT', value: '8080' }
            { name: 'POSTGRES_HOST', value: postgresHost }
            { name: 'POSTGRES_DATABASE', value: 'medical_device' }
            { name: 'POSTGRES_RUNTIME_LOGIN', value: 'medical_device_runtime' }
            { name: 'POSTGRES_RUNTIME_PASSWORD', secretRef: 'database-runtime-password' }
            { name: 'ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'ENTRA_AUDIENCE', value: entraAudience }
            { name: 'ENTRA_OPENID_CONFIGURATION_URL', value: entraOpenIdConfigurationUrl }
            { name: 'ENTRA_ISSUER', value: entraIssuer }
            { name: 'ENTRA_ORGANIZATION_CLAIM', value: entraOrganizationClaim }
            { name: 'ENTRA_ROLES_CLAIM', value: entraRolesClaim }
            { name: 'ALLOWED_ORIGINS', value: allowedOrigins }
            { name: 'BROWSER_AUTH_ENABLED', value: string(browserAuthEnabled) }
            { name: 'BROWSER_AUTH_CLIENT_ID', value: browserAuthClientId }
            { name: 'BROWSER_AUTH_AUTHORITY', value: browserAuthAuthority }
            { name: 'BROWSER_AUTH_API_SCOPE', value: browserAuthApiScope }
            { name: 'APPLICATION_ORIGIN', value: applicationOrigin }
            { name: 'WEB_ROOT', value: '/app/web' }
            { name: 'STORAGE_ACCOUNT_URL', value: 'https://${storageAccountName}.blob.${environment().suffixes.storage}' }
            { name: 'STORAGE_CONTAINER_NAME', value: 'source-assets' }
            { name: 'RECONSTRUCTION_MODES', value: reconstructionModes }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/healthz'
                port: 8080
              }
              initialDelaySeconds: 10
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/healthz'
                port: 8080
              }
              initialDelaySeconds: 5
              periodSeconds: 15
              timeoutSeconds: 5
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output apiContainerAppName string = api.name
output apiIdentityClientId string = apiIdentity.properties.clientId
output apiFqdn string = api.properties.configuration.ingress.fqdn
