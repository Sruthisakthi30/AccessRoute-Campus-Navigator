$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$dbPath = Join-Path $tempRoot ("accessroute-smoke-" + [guid]::NewGuid().ToString('N'))
$mongo = $null; $location = $null; $routes = $null
$oldEnv = @{}
foreach ($name in @('MONGODB_URI','DB_NAME','PORT','CLIENT_ORIGIN','LOCATION_SERVICE_URL')) { $oldEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
function Assert($condition, $message) { if (-not $condition) { throw $message }; Write-Host "PASS  $message" -ForegroundColor Green }
function Wait-Http($uri, $seconds = 35) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) { try { return Invoke-RestMethod -Uri $uri -TimeoutSec 2 } catch { Start-Sleep -Milliseconds 500 } }
  throw "Timed out waiting for $uri"
}
try {
  if (Get-NetTCPConnection -LocalPort 27117,14001,18000 -State Listen -ErrorAction SilentlyContinue) { throw 'Smoke-test ports 27117, 14001, or 18000 are already in use.' }
  New-Item -ItemType Directory -Path $dbPath | Out-Null
  $mongo = Start-Process -FilePath (Get-Command mongod).Source -ArgumentList @('--dbpath', $dbPath, '--port', '27117', '--bind_ip', '127.0.0.1') -WindowStyle Hidden -PassThru
  $env:MONGODB_URI = 'mongodb://127.0.0.1:27117'; $env:DB_NAME = 'accessroute_smoke'; $env:PORT = '14001'; $env:CLIENT_ORIGIN = 'http://localhost:5173'
  $location = Start-Process -FilePath (Get-Command node).Source -ArgumentList @('src/server.js') -WorkingDirectory (Join-Path $root 'services/location') -WindowStyle Hidden -PassThru
  $env:LOCATION_SERVICE_URL = 'http://127.0.0.1:14001'; $env:PORT = '18000'
  $routes = Start-Process -FilePath (Get-Command python).Source -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port','18000') -WorkingDirectory (Join-Path $root 'services/routes') -WindowStyle Hidden -PassThru

  $health = Wait-Http 'http://127.0.0.1:14001/api/health'
  Assert ($health.status -eq 'ok') 'Location service connects to MongoDB'
  $routeHealth = Wait-Http 'http://127.0.0.1:18000/health'
  Assert ($routeHealth.locationService -eq 'connected') 'Route service reaches location service over REST'
  $initial = Invoke-RestMethod 'http://127.0.0.1:14001/api/locations'
  Assert ($initial.Count -ge 8) 'Campus seed locations are available'

  $email = "accessroute-smoke-$([guid]::NewGuid().ToString('N'))@example.edu"
  $credentials = @{ name='Smoke Test Student'; studentId='ST-TEST'; email=$email; password='TestPassword-482!' } | ConvertTo-Json
  $registered = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:14001/api/auth/register' -ContentType 'application/json' -Body $credentials
  Assert ($registered.user.role -eq 'student' -and $registered.user.email -eq $email) 'Register a student account and return a session token'
  $signedIn = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:14001/api/auth/login' -ContentType 'application/json' -Body (@{email=$email;password='TestPassword-482!'} | ConvertTo-Json)
  Assert ($signedIn.user.id -eq $registered.user.id) 'Sign in with the registered student credentials'
  $session = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:14001/api/auth/me' -Headers @{Authorization="Bearer $($signedIn.token)"}
  Assert ($session.user.email -eq $email) 'Validate the signed-in student session'
  $badLogin = 0
  try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:14001/api/auth/login' -ContentType 'application/json' -Body (@{email=$email;password='IncorrectPassword'} | ConvertTo-Json) | Out-Null }
  catch { $badLogin = [int]$_.Exception.Response.StatusCode }
  Assert ($badLogin -eq 401) 'Reject an incorrect student password'

  $newLocation = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:14001/api/locations' -ContentType 'application/json' -Body (@{name='Smoke Test Destination';type='landmark';description='Temporary integration test';x=57;y=83;accessible=$true} | ConvertTo-Json)
  $id = $newLocation.id
  Assert ($id -match '^[a-f0-9]{24}$') 'Create location returns a MongoDB ID'
  $readLocation = Invoke-RestMethod "http://127.0.0.1:14001/api/locations/$id"
  Assert ($readLocation.name -eq 'Smoke Test Destination') 'Read location by MongoDB ID'
  $updated = Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:14001/api/locations/$id" -ContentType 'application/json' -Body (@{name='Smoke Test Destination Updated';type='landmark';description='Updated';x=58;y=82;accessible=$true} | ConvertTo-Json)
  Assert ($updated.name -eq 'Smoke Test Destination Updated') 'Update location by MongoDB ID'

  $path = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:14001/api/paths' -ContentType 'application/json' -Body (@{from='north-gate';to=$id;distance=240;surface='paved';stairs=$false;ramp=$true;elevator=$false;blocked=$false;label='Smoke Test Connector'} | ConvertTo-Json)
  $pathId = $path.id
  $routed = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:18000/api/routes' -ContentType 'application/json' -Body (@{from='north-gate';to=$id;preferences=@{avoidStairs=$true;preferRamps=$true;preferElevators=$true}} | ConvertTo-Json -Depth 4)
  Assert ($routed.waypoints[-1].id -eq $id -and $routed.distanceMeters -eq 240) 'Route service calculates a path using live location-service data'

  $blocked = Invoke-RestMethod -Method Put -Uri "http://127.0.0.1:14001/api/paths/$pathId" -ContentType 'application/json' -Body (@{from='north-gate';to=$id;distance=240;surface='paved';stairs=$false;ramp=$true;elevator=$false;blocked=$true;label='Smoke Test Connector'} | ConvertTo-Json)
  Assert ($blocked.blocked) 'Update pathway closure state'
  $noRouteStatus = 0
  try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:18000/api/routes' -ContentType 'application/json' -Body (@{from='north-gate';to=$id;preferences=@{avoidStairs=$true}} | ConvertTo-Json -Depth 4) | Out-Null }
  catch { $noRouteStatus = [int]$_.Exception.Response.StatusCode }
  Assert ($noRouteStatus -eq 404) 'Blocked pathway is excluded and no-route response is returned'

  Invoke-RestMethod -Method Delete -Uri "http://127.0.0.1:14001/api/paths/$pathId" | Out-Null
  Invoke-RestMethod -Method Delete -Uri "http://127.0.0.1:14001/api/locations/$id" | Out-Null
  Assert ($true) 'Delete temporary pathway and location'
  Write-Host 'AccessRoute API smoke checks passed.' -ForegroundColor Cyan
}
finally {
  foreach ($process in @($routes,$location,$mongo)) { if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } }
  foreach ($name in $oldEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $oldEnv[$name], 'Process') }
  $resolvedTemp = [System.IO.Path]::GetFullPath($tempRoot).TrimEnd('\') + '\'
  $resolvedDb = [System.IO.Path]::GetFullPath($dbPath)
  if ($resolvedDb.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedDb)) { Remove-Item -LiteralPath $resolvedDb -Recurse -Force }
}
