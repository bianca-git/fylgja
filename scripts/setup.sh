#!/bin/bash

# Fylgja Development Environment Setup Script
# This script sets up the complete development environment for Fylgja

set -e  # Exit on any error

echo "🚀 Setting up Fylgja Development Environment..."
echo "================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Check if running on supported OS
check_os() {
    print_info "Checking operating system..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        OS="linux"
        print_status "Linux detected"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        print_status "macOS detected"
    else
        print_error "Unsupported operating system: $OSTYPE"
        exit 1
    fi
}

# Check if Node.js is installed
check_node() {
    print_info "Checking Node.js installation..."
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        print_status "Node.js $NODE_VERSION is installed"
        
        # Check if version is 18 or higher
        NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
        if [ "$NODE_MAJOR" -lt 18 ]; then
            print_warning "Node.js version 18+ is recommended. Current: $NODE_VERSION"
        fi
    else
        print_error "Node.js is not installed. Please install Node.js 18+ first."
        print_info "Visit: https://nodejs.org/"
        exit 1
    fi
}

# Check if npm is installed
check_npm() {
    print_info "Checking npm installation..."
    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm --version)
        print_status "npm $NPM_VERSION is installed"
    else
        print_error "npm is not installed. Please install npm first."
        exit 1
    fi
}

# Install Firebase CLI
install_firebase_cli() {
    print_info "Checking Firebase CLI installation..."
    if command -v firebase &> /dev/null; then
        FIREBASE_VERSION=$(firebase --version)
        print_status "Firebase CLI is already installed: $FIREBASE_VERSION"
    else
        print_info "Installing Firebase CLI..."
        npm install -g firebase-tools
        print_status "Firebase CLI installed successfully"
    fi
}

# Install project dependencies
install_dependencies() {
    print_info "Installing project dependencies..."
    
    # Install root dependencies
    if [ -f "package.json" ]; then
        print_info "Installing root dependencies..."
        npm install
        print_status "Root dependencies installed"
    fi
    
    # Install function dependencies
    if [ -f "functions/package.json" ]; then
        print_info "Installing Cloud Functions dependencies..."
        cd functions
        npm install
        cd ..
        print_status "Cloud Functions dependencies installed"
    fi
    
    # Install web app dependencies (when created)
    if [ -f "web/package.json" ]; then
        print_info "Installing web app dependencies..."
        cd web
        npm install
        cd ..
        print_status "Web app dependencies installed"
    fi
}

# Set up environment variables
setup_environment() {
    print_info "Setting up environment variables..."
    
    if [ -f ".env.local" ]; then
        print_status "Environment file .env.local already exists"
        
        # Source the environment file
        set -a  # automatically export all variables
        source .env.local
        set +a
        
        print_status "Environment variables loaded"
    else
        print_warning ".env.local file not found"
        print_info "Please create .env.local with your configuration"
        
        # Create template
        cat > .env.template << EOF
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
EOF
        print_status "Environment template created: .env.template"
    fi
}

# Set up Firebase project
setup_firebase() {
    print_info "Setting up Firebase project..."
    
    # Check if already logged in
    if firebase projects:list &> /dev/null; then
        print_status "Already logged into Firebase"
    else
        print_info "Please log into Firebase..."
        firebase login
    fi
    
    # Initialize Firebase if not already done
    if [ ! -f "firebase.json" ]; then
        print_info "Initializing Firebase project..."
        firebase init
    else
        print_status "Firebase project already initialized"
    fi
    
    # Set up Firebase emulators
    print_info "Setting up Firebase emulators..."
    if [ ! -f "firebase.json" ] || ! grep -q "emulators" firebase.json; then
        print_info "Configuring Firebase emulators..."
        # This will be handled by the existing firebase.json
    fi
    
    print_status "Firebase setup complete"
}

# Set up Git hooks
setup_git_hooks() {
    print_info "Setting up Git hooks..."
    
    # Create pre-commit hook
    mkdir -p .git/hooks
    
    cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
# Pre-commit hook for Fylgja

echo "Running pre-commit checks..."

# Run linting
echo "Running ESLint..."
npm run lint
if [ $? -ne 0 ]; then
    echo "ESLint failed. Please fix the issues before committing."
    exit 1
fi

# Run tests
echo "Running tests..."
npm test
if [ $? -ne 0 ]; then
    echo "Tests failed. Please fix the issues before committing."
    exit 1
fi

echo "Pre-commit checks passed!"
EOF
    
    chmod +x .git/hooks/pre-commit
    print_status "Git hooks configured"
}

# Create development scripts
create_dev_scripts() {
    print_info "Creating development scripts..."
    
    # Create scripts directory
    mkdir -p scripts
    
    # Development start script
    cat > scripts/dev.sh << 'EOF'
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
FIREBASE_PID=$!

# Wait for emulators to start
sleep 5

# Start web development server (when available)
if [ -f "web/package.json" ]; then
    echo "🌐 Starting web development server..."
    cd web && npm start &
    WEB_PID=$!
    cd ..
fi

echo "✅ Development environment started!"
echo "📊 Firebase Emulator UI: http://localhost:4000"
echo "🌐 Web App: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for interrupt
trap 'echo "Stopping services..."; kill $FIREBASE_PID 2>/dev/null; kill $WEB_PID 2>/dev/null; exit' INT
wait
EOF
    
    chmod +x scripts/dev.sh
    
    # Testing script
    cat > scripts/test.sh << 'EOF'
#!/bin/bash
# Testing script

echo "🧪 Running Fylgja tests..."

# Load environment variables
if [ -f ".env.local" ]; then
    set -a
    source .env.local
    set +a
fi

# Run function tests
if [ -f "functions/package.json" ]; then
    echo "Testing Cloud Functions..."
    cd functions
    npm test
    cd ..
fi

# Run web app tests (when available)
if [ -f "web/package.json" ]; then
    echo "Testing web app..."
    cd web
    npm test
    cd ..
fi

echo "✅ All tests completed!"
EOF
    
    chmod +x scripts/test.sh
    
    # Deployment script
    cat > scripts/deploy.sh << 'EOF'
#!/bin/bash
# Deployment script

echo "🚀 Deploying Fylgja..."

# Load environment variables
if [ -f ".env.local" ]; then
    set -a
    source .env.local
    set +a
fi

# Build and deploy functions
echo "📦 Building and deploying Cloud Functions..."
cd functions
npm run build
cd ..
firebase deploy --only functions

# Deploy Firestore rules and indexes
echo "🔒 Deploying Firestore rules and indexes..."
firebase deploy --only firestore:rules,firestore:indexes

# Deploy web app (when available)
if [ -f "web/package.json" ]; then
    echo "🌐 Building and deploying web app..."
    cd web
    npm run build
    cd ..
    firebase deploy --only hosting
fi

echo "✅ Deployment completed!"
EOF
    
    chmod +x scripts/deploy.sh
    
    print_status "Development scripts created"
}

# Verify installation
verify_installation() {
    print_info "Verifying installation..."
    
    # Check if all required tools are available
    local errors=0
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js not found"
        errors=$((errors + 1))
    fi
    
    if ! command -v npm &> /dev/null; then
        print_error "npm not found"
        errors=$((errors + 1))
    fi
    
    if ! command -v firebase &> /dev/null; then
        print_error "Firebase CLI not found"
        errors=$((errors + 1))
    fi
    
    if [ ! -f "functions/package.json" ]; then
        print_error "Cloud Functions package.json not found"
        errors=$((errors + 1))
    fi
    
    if [ $errors -eq 0 ]; then
        print_status "All verification checks passed!"
        return 0
    else
        print_error "$errors verification checks failed"
        return 1
    fi
}

# Main setup function
main() {
    echo ""
    echo "🎯 Fylgja Development Environment Setup"
    echo "======================================"
    echo ""
    
    check_os
    check_node
    check_npm
    install_firebase_cli
    install_dependencies
    setup_environment
    setup_firebase
    setup_git_hooks
    create_dev_scripts
    
    echo ""
    echo "🎉 Setup completed successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Configure your .env.local file with your credentials"
    echo "2. Run './scripts/dev.sh' to start the development environment"
    echo "3. Run './scripts/test.sh' to run tests"
    echo "4. Run './scripts/deploy.sh' to deploy to Firebase"
    echo ""
    echo "📚 Documentation: ./docs/development.md"
    echo "🐛 Issues: https://github.com/bianca-git/fylgja/issues"
    echo ""
    
    if verify_installation; then
        print_status "Environment setup completed successfully! 🎉"
        exit 0
    else
        print_error "Setup completed with errors. Please check the output above."
        exit 1
    fi
}

# Run main function
main "$@"

