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

@allowed(['staging', 'production'])
param appEnvironment string = 'staging'
param azureOpenAiEndpoint string
param azureOpenAiDeployment string
param azureOpenAiModel string = 'gpt-4o-mini'
param azureOpenAiApiVersion string = '2024-10-21'
@description('Enable bounded evidence planning and per-module generation for Azure learning requests.')
param aiStagedLearning bool = true
@description('Optional evaluated instructional deployment on the same Azure OpenAI endpoint. Set together with its model name.')
param azureOpenAiInstructionalDeployment string = ''
param azureOpenAiInstructionalModel string = ''
param azureEmbeddingEndpoint string
param azureEmbeddingDeployment string
@allowed(['text-embedding-3-small', 'text-embedding-3-large'])
param azureEmbeddingModel string = 'text-embedding-3-small'
@description('Optional reviewed versioned source-unit rates; absent rates remain explicitly unpriced.')
param sourceUsageRatesJson string = '[]'
param aiCostRatesJson string = '[]'
param communicationServiceName string
@description('Resource ID of the reviewed ACS email-send role; use an existing least-privilege custom role, not Owner/Contributor.')
param communicationEmailSenderRoleDefinitionId string
param emailVerificationEndpoint string
param emailVerificationSender string
param invitationActiveKeyId string
@minValue(1)
@maxValue(50000)
@description('Reviewed worst-case per-generation reservation, including repeated input/context for the outline and up to two module calls plus their shared output budget. 100 cents is a planning placeholder, not measured pricing.')
param aiMaxRunCostCents int = 100
@allowed([true])
@description('Explicit operator attestation that configured reservation prices cover worst-case enabled workloads.')
param costReservationsReviewed bool

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
param reconstructionModes string = 'multi-view,video'

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

resource communication 'Microsoft.Communication/communicationServices@2023-03-31' existing = {
  name: communicationServiceName
}
resource apiCommunicationRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(communication.id, apiIdentity.id, 'api-verification-email')
  scope: communication
  properties: {
    roleDefinitionId: communicationEmailSenderRoleDefinitionId
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
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

var apiSecretNames = ['postgres-runtime-password', 'azure-openai-key', 'azure-embedding-api-key', 'operational-key-secret', 'email-verification-secret', 'webhook-keys-json', 'invitation-token-keys-json']
resource apiSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = [for name in apiSecretNames: {
  parent: keyVault
  name: name
}]
resource apiKeyVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (name, i) in apiSecretNames: {
  name: guid(keyVault.id, apiIdentity.id, name, 'api-secret-reader')
  scope: apiSecrets[i]
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: apiIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}]

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
    apiCommunicationRole
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
        { name: 'azure-openai-key', keyVaultUrl: '${keyVaultUri}/secrets/azure-openai-key', identity: apiIdentity.id }
        { name: 'azure-embedding-api-key', keyVaultUrl: '${keyVaultUri}/secrets/azure-embedding-api-key', identity: apiIdentity.id }
        { name: 'operational-key-secret', keyVaultUrl: '${keyVaultUri}/secrets/operational-key-secret', identity: apiIdentity.id }
        { name: 'email-verification-secret', keyVaultUrl: '${keyVaultUri}/secrets/email-verification-secret', identity: apiIdentity.id }
        { name: 'webhook-keys-json', keyVaultUrl: '${keyVaultUri}/secrets/webhook-keys-json', identity: apiIdentity.id }
        { name: 'invitation-token-keys-json', keyVaultUrl: '${keyVaultUri}/secrets/invitation-token-keys-json', identity: apiIdentity.id }
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
            { name: 'APP_ENV', value: appEnvironment }
            { name: 'AUDIT_LOGGING_ENABLED', value: 'true' }
            { name: 'AI_PROVIDER_MODE', value: 'azure-openai' }
            { name: 'RETRIEVAL_MODE', value: 'hybrid' }
            { name: 'AZURE_EMBEDDING_ENDPOINT', value: azureEmbeddingEndpoint }
            { name: 'AZURE_EMBEDDING_DEPLOYMENT', value: azureEmbeddingDeployment }
            { name: 'AZURE_EMBEDDING_MODEL', value: azureEmbeddingModel }
            { name: 'AZURE_EMBEDDING_API_KEY', secretRef: 'azure-embedding-api-key' }
            { name: 'SOURCE_USAGE_RATES_JSON', value: sourceUsageRatesJson }
            { name: 'AI_COST_RATES_JSON', value: aiCostRatesJson }
            { name: 'AZURE_OPENAI_ENDPOINT', value: azureOpenAiEndpoint }
            { name: 'AZURE_OPENAI_DEPLOYMENT', value: azureOpenAiDeployment }
            { name: 'AZURE_OPENAI_MODEL', value: azureOpenAiModel }
            { name: 'AZURE_OPENAI_API_VERSION', value: azureOpenAiApiVersion }
            { name: 'AI_STAGED_LEARNING', value: string(aiStagedLearning) }
            { name: 'AZURE_OPENAI_INSTRUCTIONAL_DEPLOYMENT', value: azureOpenAiInstructionalDeployment }
            { name: 'AZURE_OPENAI_INSTRUCTIONAL_MODEL', value: azureOpenAiInstructionalModel }
            { name: 'AZURE_OPENAI_API_KEY', secretRef: 'azure-openai-key' }
            { name: 'AI_MAX_OUTPUT_TOKENS', value: '4000' }
            { name: 'AI_MAX_RUN_COST_CENTS', value: string(aiMaxRunCostCents) }
            { name: 'COST_RESERVATIONS_REVIEWED', value: string(costReservationsReviewed) }
            { name: 'WEBHOOK_KEYS_JSON', secretRef: 'webhook-keys-json' }
            { name: 'INVITATION_TOKEN_KEYS_JSON', secretRef: 'invitation-token-keys-json' }
            { name: 'INVITATION_ACTIVE_KEY_ID', value: invitationActiveKeyId }
            { name: 'OPERATIONAL_KEY_SECRET', secretRef: 'operational-key-secret' }
            { name: 'EMAIL_VERIFICATION_ENABLED', value: 'true' }
            { name: 'EMAIL_VERIFICATION_SECRET', secretRef: 'email-verification-secret' }
            { name: 'EMAIL_VERIFICATION_ENDPOINT', value: emailVerificationEndpoint }
            { name: 'EMAIL_VERIFICATION_SENDER', value: emailVerificationSender }
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
                path: '/readyz'
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
