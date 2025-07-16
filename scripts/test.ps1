# Testing script for Fylgja

Write-Host "🧪 Running Fylgja tests..." -ForegroundColor Green

# Load environment variables
if (Test-Path ".env.local") {
    Get-Content ".env.local" | ForEach-Object {
        if ($_ -match "^export\s+([^=]+)=(.*)$") {
            $name = $matches[1]
            $value = $matches[2] -replace '"', ''
            [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
}

# Run function tests
if (Test-Path "functions/package.json") {
    Write-Host "Testing Cloud Functions..." -ForegroundColor Blue
    Push-Location functions
    try {
        npm test
    } finally {
        Pop-Location
    }
}

# Run web app tests (when available)
if (Test-Path "web/package.json") {
    Write-Host "Testing web app..." -ForegroundColor Blue
    Push-Location web
    try {
        npm test
    } finally {
        Pop-Location
    }
}

Write-Host "✅ All tests completed!" -ForegroundColor Green
