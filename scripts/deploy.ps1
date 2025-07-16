# Deployment script for Fylgja

Write-Host "🚀 Deploying Fylgja..." -ForegroundColor Green

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

# Build and deploy functions
Write-Host "📦 Building and deploying Cloud Functions..." -ForegroundColor Blue
Push-Location functions
try {
    npm run build
} finally {
    Pop-Location
}
firebase deploy --only functions

# Deploy Firestore rules and indexes
Write-Host "🔒 Deploying Firestore rules and indexes..." -ForegroundColor Blue
firebase deploy --only firestore:rules,firestore:indexes

# Deploy web app (when available)
if (Test-Path "web/package.json") {
    Write-Host "🌐 Building and deploying web app..." -ForegroundColor Blue
    Push-Location web
    try {
        npm run build
    } finally {
        Pop-Location
    }
    firebase deploy --only hosting
}

Write-Host "✅ Deployment completed!" -ForegroundColor Green
