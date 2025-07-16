# Fylgja Development Environment Setup Script (PowerShell)
# This script sets up the complete development environment for Fylgja

param(
    [switch]$Force,
    [switch]$SkipFirebase
)

# Enable strict mode
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "🚀 Setting up Fylgja Development Environment..." -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green

# Function to print colored output
function Write-Status {
    param([string]$Message)
    Write-Host "✓ $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠ $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "✗ $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "ℹ $Message" -ForegroundColor Blue
}

# Check if running on supported OS
function Test-OS {
    Write-Info "Checking operating system..."
    if ($IsWindows -or $env:OS -eq "Windows_NT") {
        Write-Status "Windows detected"
        return "windows"
    } elseif ($IsLinux) {
        Write-Status "Linux detected"
        return "linux"
    } elseif ($IsMacOS) {
        Write-Status "macOS detected"
        return "macos"
    } else {
        Write-Error "Unsupported operating system"
        exit 1
    }
}

# Check if Node.js is installed
function Test-Node {
    Write-Info "Checking Node.js installation..."
    try {
        $nodeVersion = node --version
        Write-Status "Node.js $nodeVersion is installed"
        
        # Check if version is 18 or higher
        $nodeMajor = [int]($nodeVersion -replace 'v', '' -split '\.')[0]
        if ($nodeMajor -lt 18) {
            Write-Warning "Node.js version 18+ is recommended. Current: $nodeVersion"
        }
        return $true
    } catch {
        Write-Error "Node.js is not installed. Please install Node.js 18+ first."
        Write-Info "Visit: https://nodejs.org/"
        return $false
    }
}

# Check if npm is installed
function Test-Npm {
    Write-Info "Checking npm installation..."
    try {
        $npmVersion = npm --version
        Write-Status "npm $npmVersion is installed"
        return $true
    } catch {
        Write-Error "npm is not installed. Please install npm first."
        return $false
    }
}

# Install Firebase CLI
function Install-FirebaseCLI {
    Write-Info "Checking Firebase CLI installation..."
    try {
        $firebaseVersion = firebase --version
        Write-Status "Firebase CLI is already installed: $firebaseVersion"
    } catch {
        Write-Info "Installing Firebase CLI..."
        npm install -g firebase-tools
        Write-Status "Firebase CLI installed successfully"
    }
}

# Install project dependencies
function Install-Dependencies {
    Write-Info "Installing project dependencies..."
    
    # Install root dependencies
    if (Test-Path "package.json") {
        Write-Info "Installing root dependencies..."
        npm install
        Write-Status "Root dependencies installed"
    }
    
    # Install function dependencies
    if (Test-Path "functions/package.json") {
        Write-Info "Installing Cloud Functions dependencies..."
        Push-Location functions
        try {
            npm install
            Write-Status "Cloud Functions dependencies installed"
        } finally {
            Pop-Location
        }
    }
    
    # Install web app dependencies (when created)
    if (Test-Path "web/package.json") {
        Write-Info "Installing web app dependencies..."
        Push-Location web
        try {
            npm install
            Write-Status "Web app dependencies installed"
        } finally {
            Pop-Location
        }
    }
}

# Set up environment variables
function Set-Environment {
    Write-Info "Setting up environment variables..."
    
    if (Test-Path ".env.local") {
        Write-Status "Environment file .env.local already exists"
        
        # Load environment variables from .env.local
        Get-Content ".env.local" | ForEach-Object {
            if ($_ -match "^export\s+([^=]+)=(.*)$") {
                $name = $matches[1]
                $value = $matches[2] -replace '"', ''
                [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
            }
        }
        
        Write-Status "Environment variables loaded"
    } else {
        Write-Warning ".env.local file not found"
        Write-Info "Please create .env.local with your configuration"
        
        # Create template
        $envTemplate = @"
# Fylgja Environment Configuration Template
# Copy this to .env.local and fill in your values

# Firebase Configuration
export FIREBASE_PROJECT_ID="your-project-id"
export FIREBASE_PRIVATE_KEY_ID="your-private-key-id"
export FIREBASE_PRIVATE_KEY="your-private-key"
export FIREBASE_CLIENT_EMAIL="your-client-email"
export FIREBASE_CLIENT_ID="your-client-id"

# Google AI Configuration
export GOOGLE_GEMINI_APIKEY="your-gemini-api-key"

# Twilio Configuration (for Phase 2)
export TWILIO_ACCOUNT_SID="your-twilio-account-sid"
export TWILIO_AUTH_TOKEN="your-twilio-auth-token"
export TWILIO_WHATSAPP_NUMBER="whatsapp:+your-number"

# Development Environment
export NODE_ENV="development"
export PORT="5000"
"@
        
        $envTemplate | Out-File -FilePath ".env.template" -Encoding UTF8
        Write-Status "Environment template created: .env.template"
    }
}

# Set up Firebase project
function Set-Firebase {
    if ($SkipFirebase) {
        Write-Info "Skipping Firebase setup (--SkipFirebase flag provided)"
        return
    }

    Write-Info "Setting up Firebase project..."
    
    # Check if already logged in
    try {
        firebase projects:list | Out-Null
        Write-Status "Already logged into Firebase"
    } catch {
        Write-Info "Please log into Firebase..."
        firebase login
    }
    
    # Initialize Firebase if not already done
    if (!(Test-Path "firebase.json")) {
        Write-Info "Initializing Firebase project..."
        firebase init
    } else {
        Write-Status "Firebase project already initialized"
    }
    
    # Set up Firebase emulators
    Write-Info "Setting up Firebase emulators..."
    if (!(Test-Path "firebase.json") -or !((Get-Content "firebase.json" -Raw) -match "emulators")) {
        Write-Info "Configuring Firebase emulators..."
        # This will be handled by the existing firebase.json
    }
    
    Write-Status "Firebase setup complete"
}

# Set up Git hooks
function Set-GitHooks {
    Write-Info "Setting up Git hooks..."
    
    # Create hooks directory
    if (!(Test-Path ".git/hooks")) {
        New-Item -Path ".git/hooks" -ItemType Directory -Force | Out-Null
    }
    
    # Create pre-commit hook
    $preCommitHook = @"
#!/bin/bash
# Pre-commit hook for Fylgja

echo "Running pre-commit checks..."

# Run linting
echo "Running ESLint..."
npm run lint
if [ `$? -ne 0 ]; then
    echo "ESLint failed. Please fix the issues before committing."
    exit 1
fi

# Run tests
echo "Running tests..."
npm test
if [ `$? -ne 0 ]; then
    echo "Tests failed. Please fix the issues before committing."
    exit 1
fi

echo "Pre-commit checks passed!"
"@
    
    $preCommitHook | Out-File -FilePath ".git/hooks/pre-commit" -Encoding UTF8
    
    # Make executable (if on Unix-like systems)
    if ($IsLinux -or $IsMacOS) {
        chmod +x .git/hooks/pre-commit
    }
    
    Write-Status "Git hooks configured"
}

# Create development scripts
function New-DevScripts {
    Write-Info "Creating development scripts..."
    
    # Create scripts directory
    if (!(Test-Path "scripts")) {
        New-Item -Path "scripts" -ItemType Directory -Force | Out-Null
    }
    
    # Development start script (PowerShell)
    $devScript = @"
# Development start script for Fylgja

Write-Host "🚀 Starting Fylgja development environment..." -ForegroundColor Green

# Load environment variables
if (Test-Path ".env.local") {
    Get-Content ".env.local" | ForEach-Object {
        if (`$_ -match "^export\s+([^=]+)=(.*)$") {
            `$name = `$matches[1]
            `$value = `$matches[2] -replace '"', ''
            [System.Environment]::SetEnvironmentVariable(`$name, `$value, "Process")
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
    while (`$true) {
        Start-Sleep -Seconds 1
    }
} finally {
    Write-Host "Stopping services..." -ForegroundColor Yellow
    Get-Job | Stop-Job
    Get-Job | Remove-Job
}
"@
    
    $devScript | Out-File -FilePath "scripts/dev.ps1" -Encoding UTF8
    
    # Testing script (PowerShell)
    $testScript = @"
# Testing script for Fylgja

Write-Host "🧪 Running Fylgja tests..." -ForegroundColor Green

# Load environment variables
if (Test-Path ".env.local") {
    Get-Content ".env.local" | ForEach-Object {
        if (`$_ -match "^export\s+([^=]+)=(.*)$") {
            `$name = `$matches[1]
            `$value = `$matches[2] -replace '"', ''
            [System.Environment]::SetEnvironmentVariable(`$name, `$value, "Process")
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
"@
    
    $testScript | Out-File -FilePath "scripts/test.ps1" -Encoding UTF8
    
    # Deployment script (PowerShell)
    $deployScript = @"
# Deployment script for Fylgja

Write-Host "🚀 Deploying Fylgja..." -ForegroundColor Green

# Load environment variables
if (Test-Path ".env.local") {
    Get-Content ".env.local" | ForEach-Object {
        if (`$_ -match "^export\s+([^=]+)=(.*)$") {
            `$name = `$matches[1]
            `$value = `$matches[2] -replace '"', ''
            [System.Environment]::SetEnvironmentVariable(`$name, `$value, "Process")
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
"@
    
    $deployScript | Out-File -FilePath "scripts/deploy.ps1" -Encoding UTF8
    
    # Also create bash versions for cross-platform compatibility
    $devScriptBash = @"
#!/bin/bash
# Development start script

echo "🚀 Starting Fylgja development environment..."

# Load environment variables
if [ -f ".env.local" ]; then
    set -a
    source .env.local
    set +a
    echo "✓ Environment variables loaded"
else
    echo "⚠ Warning: .env.local not found"
fi

# Start Firebase emulators in background
echo "🔥 Starting Firebase emulators..."
firebase emulators:start --only firestore,functions,auth &
FIREBASE_PID=`$!

# Wait for emulators to start
sleep 5

# Start web development server (when available)
if [ -f "web/package.json" ]; then
    echo "🌐 Starting web development server..."
    cd web && npm start &
    WEB_PID=`$!
    cd ..
fi

echo "✅ Development environment started!"
echo "📊 Firebase Emulator UI: http://localhost:4000"
echo "🌐 Web App: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for interrupt
trap 'echo "Stopping services..."; kill `$FIREBASE_PID 2>/dev/null; kill `$WEB_PID 2>/dev/null; exit' INT
wait
"@
    
    $devScriptBash | Out-File -FilePath "scripts/dev.sh" -Encoding UTF8
    
    Write-Status "Development scripts created"
}

# Verify installation
function Test-Installation {
    Write-Info "Verifying installation..."
    
    $errors = 0
    
    try {
        node --version | Out-Null
    } catch {
        Write-Error "Node.js not found"
        $errors++
    }
    
    try {
        npm --version | Out-Null
    } catch {
        Write-Error "npm not found"
        $errors++
    }
    
    try {
        firebase --version | Out-Null
    } catch {
        Write-Error "Firebase CLI not found"
        $errors++
    }
    
    if (!(Test-Path "functions/package.json")) {
        Write-Error "Cloud Functions package.json not found"
        $errors++
    }
    
    if ($errors -eq 0) {
        Write-Status "All verification checks passed!"
        return $true
    } else {
        Write-Error "$errors verification checks failed"
        return $false
    }
}

# Main setup function
function Start-Setup {
    Write-Host ""
    Write-Host "🎯 Fylgja Development Environment Setup" -ForegroundColor Green
    Write-Host "======================================" -ForegroundColor Green
    Write-Host ""
    
    $os = Test-OS
    
    if (!(Test-Node)) { exit 1 }
    if (!(Test-Npm)) { exit 1 }
    
    Install-FirebaseCLI
    Install-Dependencies
    Set-Environment
    Set-Firebase
    Set-GitHooks
    New-DevScripts
    
    Write-Host ""
    Write-Host "🎉 Setup completed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Configure your .env.local file with your credentials" -ForegroundColor White
    Write-Host "2. Run '.\scripts\dev.ps1' to start the development environment" -ForegroundColor White
    Write-Host "3. Run '.\scripts\test.ps1' to run tests" -ForegroundColor White
    Write-Host "4. Run '.\scripts\deploy.ps1' to deploy to Firebase" -ForegroundColor White
    Write-Host ""
    Write-Host "📚 Documentation: .\docs\development.md" -ForegroundColor Cyan
    Write-Host "🐛 Issues: https://github.com/bianca-git/fylgja/issues" -ForegroundColor Cyan
    Write-Host ""
    
    if (Test-Installation) {
        Write-Status "Environment setup completed successfully! 🎉"
        exit 0
    } else {
        Write-Error "Setup completed with errors. Please check the output above."
        exit 1
    }
}

# Run main function
Start-Setup
