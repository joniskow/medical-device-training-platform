param(
  [Parameter(Mandatory=$true)][ValidateSet('Inventory','PauseQueue','ResumeQueue','Rollback','RestorePostgres','StageSecret')][string]$Action,
  [Parameter(Mandatory=$true)][string]$ResourceGroup,
  [string]$ConfirmResourceGroup,
  [switch]$Execute,
  [string]$ContainerApp,
  [string]$ImageDigest,
  [string]$ServiceBusNamespace,
  [string]$QueueName='asset-processing',
  [string]$PostgresSource,
  [string]$PostgresTarget,
  [string]$RestoreTimeUtc,
  [string]$KeyVault,
  [string]$SecretName,
  [string]$SecretFile
)
$ErrorActionPreference='Stop'
if($ResourceGroup -notmatch '^[-a-zA-Z0-9_.()]{1,90}$'){throw 'RESOURCE_GROUP_INVALID'}
$commandArgs=@()
switch($Action){
  'Inventory' {$commandArgs=@('resource','list','--resource-group',$ResourceGroup,'--query','[].{name:name,type:type,location:location}','--output','json')}
  'PauseQueue' {$commandArgs=@('servicebus','queue','update','--resource-group',$ResourceGroup,'--namespace-name',$ServiceBusNamespace,'--name',$QueueName,'--status','ReceiveDisabled')}
  'ResumeQueue' {$commandArgs=@('servicebus','queue','update','--resource-group',$ResourceGroup,'--namespace-name',$ServiceBusNamespace,'--name',$QueueName,'--status','Active')}
  'Rollback' {
    if(!$ContainerApp -or $ImageDigest -notmatch '^[-a-zA-Z0-9./:]+@sha256:[a-f0-9]{64}$'){throw 'ROLLBACK_REQUIRES_REVIEWED_IMAGE_DIGEST'}
    $commandArgs=@('containerapp','update','--resource-group',$ResourceGroup,'--name',$ContainerApp,'--image',$ImageDigest)
  }
  'RestorePostgres' {
    if(!$PostgresSource -or !$PostgresTarget -or $PostgresTarget -eq $PostgresSource -or !$PostgresTarget.EndsWith('-recovery')){throw 'RESTORE_REQUIRES_DISTINCT_ISOLATED_RECOVERY_TARGET'}
    $restoreInstant=[DateTimeOffset]::Parse($RestoreTimeUtc)
    if($restoreInstant.Offset -ne [TimeSpan]::Zero -or $restoreInstant -gt [DateTimeOffset]::UtcNow){throw 'RESTORE_TIME_MUST_BE_PAST_UTC'}
    $commandArgs=@('postgres','flexible-server','restore','--resource-group',$ResourceGroup,'--name',$PostgresTarget,'--source-server',$PostgresSource,'--restore-time',$restoreInstant.ToString('yyyy-MM-ddTHH:mm:ssZ'))
  }
  'StageSecret' {
    if(!$KeyVault -or $SecretName -notmatch '^[-a-zA-Z0-9]{1,127}$' -or !(Test-Path -LiteralPath $SecretFile -PathType Leaf)){throw 'ROTATION_REQUIRES_EXISTING_SECRET_FILE_AND_TARGET'}
    $commandArgs=@('keyvault','secret','set','--vault-name',$KeyVault,'--name',$SecretName,'--file',(Resolve-Path -LiteralPath $SecretFile).Path,'--encoding','utf-8','--query','id','--output','tsv')
  }
}
if($commandArgs -contains ''){throw 'ACTION_PARAMETER_MISSING'}
if(!$Execute){[pscustomobject]@{Mode='Plan';Action=$Action;ResourceGroup=$ResourceGroup;Arguments=$commandArgs}|ConvertTo-Json -Depth 4;exit 0}
if($ConfirmResourceGroup -ne $ResourceGroup){throw 'EXACT_RESOURCE_GROUP_CONFIRMATION_REQUIRED'}
# Azure CLI receives an argument array. Values are never assembled into executable code.
& az @commandArgs --only-show-errors
if($LASTEXITCODE -ne 0){throw 'AZURE_OPERATION_FAILED'}
Write-Output ('OPERATION_COMPLETE:'+ $Action)
