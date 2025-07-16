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
