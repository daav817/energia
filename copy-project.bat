@echo off
cd /d C:\Users\daav8
echo Copying project to C:\Users\daav8\projects (excluding node_modules, .next)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
"try { ^
  $src = 'C:\Users\daav8\OneDrive\projects\energia-app'; ^
  $dest = 'C:\Users\daav8\projects\energia-app'; ^
  if (!(Test-Path $src)) { Write-Host 'Source not found!' -ForegroundColor Red; exit 1 }; ^
  if (!(Test-Path 'C:\Users\daav8\projects')) { New-Item -ItemType Directory -Path 'C:\Users\daav8\projects' -Force }; ^
  if (Test-Path $dest) { Write-Host 'Removing existing copy...'; Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue }; ^
  robocopy $src $dest /E /XD node_modules .next .git /NFL /NDL /NJH /NJS /R:1 /W:2; ^
  if ($LASTEXITCODE -lt 8) { ^
    Write-Host ''; Write-Host 'Copy complete! Project is at:' $dest -ForegroundColor Green; ^
    Write-Host ''; Write-Host 'Next steps:'; ^
    Write-Host '1. Open Cursor, File, Open Folder, select' $dest; ^
    Write-Host '2. In terminal run: npm install'; ^
    Write-Host '3. Run: npx prisma generate'; ^
    Write-Host '4. Delete old folder when ready:' $src ^
  } else { ^
    Write-Host 'Robocopy had errors. Exit code:' $LASTEXITCODE -ForegroundColor Yellow ^
  } ^
} catch { ^
  Write-Host 'Error:' $_.Exception.Message -ForegroundColor Red ^
}"

echo.
echo Press any key to close...
pause >nul
