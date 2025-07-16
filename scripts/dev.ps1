# Development start script for Fylgja

Write-Host "🚀 Starting Fylgja development environment..." -ForegroundColor Green

# Load environment variables
if (Test-Path ".env.local") {
    Get-Content ".env.local" | ForEach-Object {
        if ($_ -match "^export\s+([^=]+)=(.*)$") {
            $name = $matches[1]
            $value = $matches[2] -replace '"', ''
            [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
    Write-Host "✓ Environment variables loaded" -ForegroundColor Green
} else {
    Write-Host "⚠ Warning: .env.local not found" -ForegroundColor Yellow
}

# Start Firebase emulators in background
Write-Host "🔥 Starting Firebase emulators..." -ForegroundColor Blue
Start-Job -Name "FirebaseEmulators" -ScriptBlock {
    firebase emulators:start --only firestore,functions,auth
}

# Wait for emulators to start
Start-Sleep -Seconds 5

# Start web development server (when available)
if (Test-Path "web/package.json") {
    Write-Host "🌐 Starting web development server..." -ForegroundColor Blue
    Start-Job -Name "WebDev" -ScriptBlock {
        Set-Location web
        npm start
    }
}

Write-Host "✅ Development environment started!" -ForegroundColor Green
Write-Host "📊 Firebase Emulator UI: http://localhost:4000" -ForegroundColor Cyan
Write-Host "🌐 Web App: http://localhost:3000" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C to stop all services" -ForegroundColor Yellow

# Wait for interrupt
try {
    while ($true) {
        Start-Sleep -Seconds 1
    }
} finally {
    Write-Host "Stopping services..." -ForegroundColor Yellow
    Get-Job | Stop-Job
    Get-Job | Remove-Job
}
