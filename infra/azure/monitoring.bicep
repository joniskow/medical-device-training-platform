targetScope = 'resourceGroup'

param location string = resourceGroup().location
param environmentName string
param logAnalyticsWorkspaceName string
param serviceBusNamespaceName string
param postgresServerName string
param managedEnvironmentName string
param containerRegistryName string
@description('Tested worker image digest with Node available; probe has no application/DB secrets.')
param probeImage string
param apiReadinessUrl string
@minValue(1)
@maxValue(50000)
@description('Capacity-reviewed connection count threshold; this is not automatically the PostgreSQL max_connections value.')
param postgresConnectionAlertThreshold int
param responderEmail string
@description('ISO date on which the monthly budget starts (first of month), e.g. 2026-11-01.')
param budgetStartDate string
param runbookUrl string

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = { name: logAnalyticsWorkspaceName }
resource serviceBus 'Microsoft.ServiceBus/namespaces@2024-01-01' existing = { name: serviceBusNamespaceName }
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {name:postgresServerName}
module apiProbe 'api-availability-job.bicep' = {
  name:'mdt-${environmentName}-api-probe'
  params:{location:location,environmentName:environmentName,managedEnvironmentName:managedEnvironmentName,containerRegistryName:containerRegistryName,probeImage:probeImage,apiReadinessUrl:apiReadinessUrl}
}
resource brokerMetrics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name:'mdt-${environmentName}-metrics'
  scope:serviceBus
  properties:{workspaceId:workspace.id,metrics:[{category:'AllMetrics',enabled:true}]}
}
resource databaseMetrics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name:'mdt-${environmentName}-metrics'
  scope:postgres
  properties:{workspaceId:workspace.id,metrics:[{category:'AllMetrics',enabled:true}]}
}
resource responders 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'mdt-${environmentName}-responders'
  location: 'global'
  properties: {
    groupShortName: 'mdt-ops'
    enabled: true
    emailReceivers: [{ name: 'named-operator', emailAddress: responderEmail, useCommonAlertSchema: true }]
  }
}

var logs = 'ContainerAppConsoleLogs_CL | extend signal=parse_json(Log_s)'
var alerts = [
  { name: 'api-errors', predicate: 'signal.event == "api_request" and toint(signal.status) >= 500', threshold: 4, severity: 1 }
  { name: 'readiness-failed', predicate: 'signal.event == "readiness_failed"', threshold: 2, severity: 1 }
  { name: 'admission-unavailable', predicate: 'signal.event == "api_admission_denied" and signal.code == "ADMISSION_UNAVAILABLE"', threshold: 2, severity: 1 }
  { name: 'abuse-spike', predicate: 'signal.event == "api_admission_denied" and signal.code == "RATE_LIMITED"', threshold: 29, severity: 2 }
  { name: 'job-failure', predicate: 'signal.event == "job_failed"', threshold: 2, severity: 2 }
  { name: 'budget-threshold', predicate: 'signal.event == "budget_threshold"', threshold: 0, severity: 2 }
  { name: 'database-pool-wait', predicate: '(signal.event == "db_pool_snapshot" and toint(signal.waiting)>0) or (signal.event == "api_request" and toint(signal.dbWaiting)>0)', threshold: 1, severity: 1 }
  { name: 'queue-age', predicate: 'signal.event == "broker_age_snapshot" and signal.hasEligibleActiveMessage==true and tolong(signal.oldestObservedActiveAgeSeconds)>600', threshold: 1, severity: 1 }
  { name: 'provider-failure-or-quota', predicate: '(signal.event == "source_usage" and tostring(signal.operation) startswith "provider." and signal.phase == "FAILED") or (signal.event == "ai_run_metrics" and signal.status in ("REJECTED","FAILED")) or (signal.event=="job_admission_denied" and signal.code=="ADMISSION_BUDGET")', threshold: 2, severity: 2 }
  { name: 'authorization-denial-spike', predicate: 'signal.event == "api_request" and toint(signal.status) in (401,403)', threshold: 29, severity: 2 }
  { name: 'credential-issuance-failure', predicate: 'signal.event == "domain_processing_result" and signal.domain=="credential" and signal.failed==true', threshold: 0, severity: 1 }
  { name: 'credential-integrity', predicate: 'signal.event == "credential_integrity_violation"', threshold: 0, severity: 1 }
  { name: 'publication-failure-symptom', predicate: 'signal.event == "api_request" and signal.routeGroup=="publication" and toint(signal.status)>=500', threshold: 0, severity: 1 }
  { name: 'webhook-email-failure', predicate: 'signal.event == "domain_processing_result" and signal.domain in ("email","webhook") and signal.failed==true', threshold: 2, severity: 2 }
  { name: 'telemetry-sampler-failure', predicate: 'signal.event == "operational_snapshot_failed"', threshold: 2, severity: 2 }
  { name: 'api-availability', predicate: 'signal.event == "api_probe" and signal.ready==false', threshold: 0, severity: 1 }
]

resource logAlerts 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [for alert in alerts: {
  name: 'mdt-${environmentName}-${alert.name}'
  location: location
  properties: {
    displayName: 'MDT ${environmentName}: ${alert.name}'
    description: 'Pilot operational threshold. Respond using ${runbookUrl}; validate thresholds against the measured service envelope.'
    enabled: true
    severity: alert.severity
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    scopes: [workspace.id]
    criteria: {
      allOf: [{ query: '${logs} | where ${alert.predicate}', timeAggregation: 'Count', operator: 'GreaterThan', threshold: alert.threshold, failingPeriods: {numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1} }]
    }
    actions: { actionGroups: [responders.id] }
    autoMitigate: true
  }
}]

resource samplerHeartbeat 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name:'mdt-${environmentName}-sampler-heartbeat'
  location:location
  properties:{
    displayName:'MDT ${environmentName}: missing worker telemetry heartbeat'
    description:'No queue samples in ten minutes; this can mean worker outage or telemetry transport failure. ${runbookUrl}'
    enabled:true
    severity:1
    evaluationFrequency:'PT1M'
    windowSize:'PT10M'
    scopes:[workspace.id]
    criteria:{allOf:[{query:'${logs} | where signal.event == "broker_age_snapshot" | summarize samples=count() | where samples==0',timeAggregation:'Count',operator:'GreaterThan',threshold:0,failingPeriods:{numberOfEvaluationPeriods:1,minFailingPeriodsToAlert:1}}]}
    actions:{actionGroups:[responders.id]}
    autoMitigate:true
  }
}

resource probeHeartbeat 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name:'mdt-${environmentName}-api-probe-heartbeat'
  location:location
  properties:{
    displayName:'MDT ${environmentName}: missing API probe heartbeat'
    description:'No scheduled readiness probe observations in fifteen minutes; inspect the probe job and log transport. ${runbookUrl}'
    enabled:true
    severity:1
    evaluationFrequency:'PT1M'
    windowSize:'PT15M'
    scopes:[workspace.id]
    criteria:{allOf:[{query:'${logs} | where signal.event == "api_probe" | summarize samples=count() | where samples==0',timeAggregation:'Count',operator:'GreaterThan',threshold:0,failingPeriods:{numberOfEvaluationPeriods:1,minFailingPeriodsToAlert:1}}]}
    actions:{actionGroups:[responders.id]}
    autoMitigate:true
  }
}

var databaseAlerts = [
  {name:'database-connection-failures',metric:'connections_failed',aggregation:'Total',threshold:5,severity:1}
  {name:'database-connection-capacity',metric:'active_connections',aggregation:'Maximum',threshold:postgresConnectionAlertThreshold,severity:2}
  {name:'database-storage-pressure',metric:'storage_percent',aggregation:'Maximum',threshold:80,severity:2}
]
resource nativeDatabaseAlerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [for alert in databaseAlerts:{
  name:'mdt-${environmentName}-${alert.name}'
  location:'global'
  properties:{
    description:'Capacity/availability symptom; failed connections do not by themselves prove exhaustion. ${runbookUrl}'
    enabled:true
    severity:alert.severity
    scopes:[postgres.id]
    evaluationFrequency:'PT1M'
    windowSize:'PT5M'
    criteria:{
      'odata.type':'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf:[{name:alert.name,criterionType:'StaticThresholdCriterion',metricNamespace:'Microsoft.DBforPostgreSQL/flexibleServers',metricName:alert.metric,timeAggregation:alert.aggregation,operator:'GreaterThan',threshold:alert.threshold}]
    }
    actions:[{actionGroupId:responders.id}]
  }
}]

resource deadLetters 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: 'mdt-${environmentName}-deadletters'
  location: 'global'
  properties: {
    description: 'Dead-lettered work needs operator inspection and safe replay: ${runbookUrl}'
    enabled: true
    severity: 2
    scopes: [serviceBus.id]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [{ name: 'deadletters', criterionType: 'StaticThresholdCriterion', metricNamespace: 'Microsoft.ServiceBus/namespaces', metricName: 'DeadletteredMessages', timeAggregation: 'Maximum', operator: 'GreaterThan', threshold: 0 }]
    }
    actions: [{actionGroupId: responders.id}]
  }
}

// Azure budget is notification only. PostgreSQL reservations enforce application admission.
resource costBudget 'Microsoft.Consumption/budgets@2023-11-01' = {
  name: 'mdt-${environmentName}-pilot'
  properties: {
    category: 'Cost'
    amount: 500
    timeGrain: 'Monthly'
    timePeriod: {startDate: '${budgetStartDate}T00:00:00Z'}
    notifications: {
      actual80: {enabled:true, operator:'GreaterThanOrEqualTo', threshold:80, contactEmails:[responderEmail], thresholdType:'Actual'}
      forecast100: {enabled:true, operator:'GreaterThanOrEqualTo', threshold:100, contactEmails:[responderEmail], thresholdType:'Forecasted'}
    }
  }
}

var definitions = loadJsonContent('operational-panels.json').workbooks
resource workbooks 'Microsoft.Insights/workbooks@2023-06-01' = [for definition in definitions:{
  name: guid(resourceGroup().id,environmentName,definition.id)
  location: location
  kind: 'shared'
  properties: {
    displayName: 'MDT ${environmentName} ${definition.title}'
    category: 'workbook'
    sourceId: workspace.id
    serializedData: string({
      version: 'Notebook/1.0'
      items:map(definition.panels,panel=>{type:3,name:panel.id,content:{version:'KqlItem/1.0',title:panel.title,query:replace(replace(panel.query,'__POSTGRES_ID__',postgres.id),'__SERVICE_BUS_ID__',serviceBus.id),size:0,queryType:0,resourceType:'microsoft.operationalinsights/workspaces',crossComponentResources:[workspace.id],visualization:'table',timeContext:{durationMs:86400000}}})
    })
  }
}]

output actionGroupId string = responders.id
output workbookIds array = [for (definition,i) in definitions:workbooks[i].id]
