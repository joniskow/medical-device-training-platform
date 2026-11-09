$ErrorActionPreference='Stop'
$script:AdminArmToken=az account get-access-token --resource https://management.azure.com/ --query accessToken -o tsv
if($LASTEXITCODE -ne 0 -or !$script:AdminArmToken){throw 'AZURE_AUTHENTICATION_REQUIRED'}
function Invoke-AdminArm([string]$Method,[string]$Path,$Body=$null){
 # Preserve TLS hostname/certificate validation despite intermittent local DNS failures.
 # This public ARM address was resolved during this deployment session.
 $config="url = `"https://management.azure.com$Path`"`nheader = `"Authorization: Bearer $script:AdminArmToken`"`nresolve = `"management.azure.com:443:4.150.240.10`"`nconnect-timeout = 10`nmax-time = 45`nrequest = `"$Method`""
 $bodyPath=$null
 try{
  if($null -ne $Body){
   $bodyPath=Join-Path ([IO.Path]::GetTempPath()) ('mdt-arm-'+[guid]::NewGuid().ToString()+'.json')
   [IO.File]::WriteAllText($bodyPath,($Body|ConvertTo-Json -Depth 60 -Compress),[Text.UTF8Encoding]::new($false))
   $config+="`nheader = `"Content-Type: application/json`"`ndata-binary = `"@"+$bodyPath.Replace('\','/')+'"'
  }elseif($Method -eq 'POST'){$config+="`nheader = `"Content-Length: 0`""}
  $result=$config | curl.exe --config - --silent --show-error --fail-with-body
  if($LASTEXITCODE -ne 0){
   $code='UNKNOWN'; try{$parsed=$result|ConvertFrom-Json; if($parsed.error.code -match '^[A-Za-z0-9_.-]+$'){$code=$parsed.error.code}}catch{}
   throw "AZURE_ADMIN_ARM_FAILED:$Method`:$code"
  }
  if($result){return ($result|ConvertFrom-Json)}
 }finally{if($bodyPath){Remove-Item -LiteralPath $bodyPath -Force}}
}
function Get-AdminJobLogs([string]$Job,[string]$Execution){
 $resource='/subscriptions/e30f800a-473e-4040-9622-6ea38413c991/resourceGroups/rg-medical-device-personal/providers/Microsoft.App/jobs/'+$Job
 $replicas=Invoke-AdminArm GET ($resource+'/executions/'+$Execution+'/replicas?api-version=2023-11-02-preview')
 if(!$replicas.value.Count){throw 'JOB_REPLICA_NOT_AVAILABLE'}
 $token=Invoke-AdminArm POST ($resource+'/getAuthToken?api-version=2023-11-02-preview')
 $url=$replicas.value[0].properties.containers[0].logStreamEndpoint+'?follow=false&output=text&tailLines=30'
 $config="url = `"$url`"`nheader = `"Authorization: Bearer $($token.properties.token)`"`nconnect-timeout = 10`nmax-time = 30"
 $result=$config | curl.exe -4 --config - --silent --show-error --fail
 if($LASTEXITCODE -ne 0){throw 'JOB_LOGS_UNAVAILABLE'}
 return $result
}
