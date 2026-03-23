# Move energia-app from OneDrive to C:\Users\daav8\projects
# Run this script AFTER closing Cursor and any terminals using this project.
# Right-click -> Run with PowerShell, or: powershell -ExecutionPolicy Bypass -File move-project.ps1

$source = "C:\Users\daav8\OneDrive\projects\energia-app"
$destParent = "C:\Users\daav8\projects"
$dest = "$destParent\energia-app"

Write-Host "Moving project from OneDrive to $dest..." -ForegroundColor Cyan

# Create destination parent if needed
if (!(Test-Path $destParent)) {
    New-Item -ItemType Directory -Path $destParent -Force | Out-Null
}

# Remove existing destination (from partial previous copy) if it exists
if (Test-Path $dest) {
    Write-Host "Removing existing destination folder..." -ForegroundColor Yellow
    Remove-Item -Path $dest -Recurse -Force -ErrorAction SilentlyContinue
}

# Move the folder
try {
    Move-Item -Path $source -Destination $dest -Force
    Write-Host "Done! Project is now at: $dest" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Open Cursor"
    Write-Host "2. File -> Open Folder -> $dest"
    Write-Host "3. Run: npm install"
    Write-Host "4. Run: npx prisma generate"
    Write-Host "5. Delete the old OneDrive folder if it was recreated: $source"
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "If you see 'in use', close Cursor and all terminals, then run this script again." -ForegroundColor Yellow
}
