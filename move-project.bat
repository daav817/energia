@echo off
cd /d C:\Users\daav8
echo Moving project from OneDrive to C:\Users\daav8\projects...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
"try { ^
  $source = 'C:\Users\daav8\OneDrive\projects\energia-app'; ^
  $dest = 'C:\Users\daav8\projects\energia-app'; ^
  if (!(Test-Path $source)) { Write-Host 'Source folder not found!' -ForegroundColor Red; exit 1 }; ^
  if (!(Test-Path 'C:\Users\daav8\projects')) { New-Item -ItemType Directory -Path 'C:\Users\daav8\projects' -Force }; ^
  if (Test-Path $dest) { Write-Host 'Removing existing destination...'; Remove-Item $dest -Recurse -Force }; ^
  Move-Item -Path $source -Destination $dest -Force; ^
  Write-Host ''; Write-Host 'Success! Project is now at:' $dest -ForegroundColor Green; ^
  Write-Host 'Open Cursor and use File, Open Folder to open the new location.' ^
} catch { ^
  Write-Host 'Error:' $_.Exception.Message -ForegroundColor Red ^
  Write-Host 'Make sure Cursor and all terminals are closed, then try again.' -ForegroundColor Yellow ^
}"

echo.
echo Press any key to close...
pause >nul
