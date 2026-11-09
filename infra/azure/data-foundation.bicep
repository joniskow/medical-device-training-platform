targetScope = 'resourceGroup'

@description('Short environment name used in resource names.')
param environmentName string = 'dev'

@description('Azure region for the data foundation.')
param location string = resourceGroup().location

@description('Existing Log Analytics workspace name.')
param logAnalyticsWorkspaceName string = 'mdt-dev-logs'

@description('Existing storage account name.')
param storageAccountName string = 'mdtdevstorage01'

@description('Existing worker managed identity name.')
param workerIdentityName string = 'mdt-dev-worker-id'

@description('PostgreSQL administrator login.')
param postgresAdminLogin string = 'mdtadmin'

@secure()
@description('PostgreSQL administrator password. Store only in Azure Key Vault; never commit it.')
param postgresAdminPassword string

@secure()
@description('Password for the non-owner PostgreSQL runtime role. Store only in Azure Key Vault; never commit it.')
param postgresRuntimePassword string

@secure()
@description('Password for the dedicated PostgreSQL outbox publisher role. Store only in Azure Key Vault; never commit it.')
param postgresOutboxPassword string

@secure()
@description('HMAC secret used to authenticate internal Service Bus job envelopes. Store only in Azure Key Vault; never commit it.')
param serviceBusSigningSecret string

@description('PostgreSQL database name.')
param postgresDatabaseName string = 'medical_device'

@minValue(7)
@maxValue(35)
param backupRetentionDays int = 35
@description('Must be selected at server creation in a supported region. A value in config alone does not prove regional recovery.')
@allowed(['Enabled', 'Disabled'])
param geoRedundantBackup string = 'Disabled'

var vnetName = 'mdt-${environmentName}-vnet'
var acaEnvironmentName = 'mdt-${environmentName}-aca-private'
var postgresServerName = 'mdt-${environmentName}-pg'
var keyVaultName = 'mdt${environmentName}kv01'
var blobPrivateDnsZoneName = 'privatelink.blob.${environment().suffixes.storage}'
var postgresPrivateDnsZoneName = 'mdt-${environmentName}.postgres.database.azure.com'
var keyVaultPrivateDnsZoneName = 'privatelink.vaultcore.azure.net'
var acaSubnetName = 'aca-infrastructure'
var postgresSubnetName = 'postgres'
var privateEndpointSubnetName = 'private-endpoints'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsWorkspaceName
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource workerIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: workerIdentityName
}

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: vnetName
  location: location
  tags: {
    project: 'medical-device-training'
    environment: environmentName
  }
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.50.0.0/16'
      ]
    }
    subnets: [
      {
        name: acaSubnetName
        properties: {
          addressPrefix: '10.50.0.0/23'
          delegations: [
            {
              name: 'aca-environment-delegation'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: postgresSubnetName
        properties: {
          addressPrefix: '10.50.2.0/28'
          delegations: [
            {
              name: 'postgres-flexible-server-delegation'
              properties: {
                serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
              }
            }
          ]
        }
      }
      {
        name: privateEndpointSubnetName
        properties: {
          addressPrefix: '10.50.2.32/27'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

resource blobPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: blobPrivateDnsZoneName
  location: 'global'
  tags: {
    project: 'medical-device-training'
    environment: environmentName
  }
}

resource blobDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: blobPrivateDnsZone
  name: vnetName
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource postgresPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: postgresPrivateDnsZoneName
  location: 'global'
  tags: {
    project: 'medical-device-training'
    environment: environmentName
  }
}

resource postgresDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: postgresPrivateDnsZone
  name: vnetName
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource keyVaultPrivateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: keyVaultPrivateDnsZoneName
  location: 'global'
  tags: {
    project: 'medical-device-training'
    environment: environmentName
  }
}

resource keyVaultDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: keyVaultPrivateDnsZone
  name: vnetName
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource storagePrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: 'mdt-${environmentName}-storage-pe'
  location: location
  tags: {
    project: 'medical-device-training'
    environment: environmentName
  }
  properties: {
    subnet: {
      id: resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, privateEndpointSubnetName)
    }
    privateLinkServiceConnections: [
      {
        name: 'blob'
        properties: {
          privateLinkServiceId: storage.id
          groupIds: [
            'blob'
          ]
        }
      }
    ]
  }
  dependsOn: [
    vnet
  ]
}

resource storagePrivateDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: storagePrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'blob'
        properties: {
          privateDnsZoneId: blobPrivateDnsZone.id
        }
      }
    ]
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: {
    project: 'medical-device-training'
    environment: environmentName
  }
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    publicNetworkAccess: 'Disabled'
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
  }
}

resource keyVaultPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: 'mdt-${environmentName}-kv-pe'
  location: location
  tags: {
    project: 'medical-device-training'
    environment: environmentName
  }
  properties: {
    subnet: {
      id: resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, privateEndpointSubnetName)
    }
    privateLinkServiceConnections: [
      {
        name: 'vault'
        properties: {
          privateLinkServiceId: keyVault.id
          groupIds: [
            'vault'
          ]
        }
      }
    ]
  }
  dependsOn: [
    vnet
  ]
}

resource keyVaultPrivateDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: keyVaultPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'vault'
        properties: {
          privateDnsZoneId: keyVaultPrivateDnsZone.id
        }
      }
    ]
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresServerName
  location: location
  tags: {
    project: 'medical-device-training'
    environment: environmentName
  }
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    version: '16'
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: geoRedundantBackup
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      delegatedSubnetResourceId: resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, postgresSubnetName)
      privateDnsZoneArmResourceId: postgresPrivateDnsZone.id
      publicNetworkAccess: 'Disabled'
    }
  }
  dependsOn: [
    vnet
  ]
}

resource postgresExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: {
    value: 'VECTOR'
    source: 'user-override'
  }
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: postgresDatabaseName
  properties: {}
}

resource postgresPasswordSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'postgres-admin-password'
  properties: {
    value: postgresAdminPassword
  }
}

resource postgresRuntimePasswordSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'postgres-runtime-password'
  properties: {
    value: postgresRuntimePassword
  }
}

resource postgresOutboxPasswordSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'postgres-outbox-password'
  properties: {
    value: postgresOutboxPassword
  }
}

resource serviceBusSigningSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'service-bus-signing-secret'
  properties: {
    value: serviceBusSigningSecret
  }
}

var workerSecretNames = ['postgres-runtime-password', 'postgres-outbox-password', 'service-bus-signing-secret']
resource workerRuntimeSecrets 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = [for name in workerSecretNames: {
  parent: keyVault
  name: name
}]
resource keyVaultSecretsUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for (name, i) in workerSecretNames: {
  name: guid(keyVault.id, workerIdentity.id, name, 'worker-secret-reader')
  scope: workerRuntimeSecrets[i]
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: workerIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}]

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: acaEnvironmentName
  location: location
  tags: {
    project: 'medical-device-training'
    environment: environmentName
  }
  properties: {
    vnetConfiguration: {
      infrastructureSubnetId: resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, acaSubnetName)
      internal: false
    }
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

output vnetName string = vnet.name
output storagePrivateEndpointName string = storagePrivateEndpoint.name
output postgresServerName string = postgres.name
output postgresDatabaseName string = postgresDatabase.name
output keyVaultName string = keyVault.name
output managedEnvironmentName string = managedEnvironment.name
