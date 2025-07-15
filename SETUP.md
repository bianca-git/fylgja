# Developer Setup Guide

## Quick Start

### 1. Environment Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/bianca-git/fylgja.git
   cd fylgja
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   # Copy the sample environment file
   cp .env.sample .env
   
   # Edit .env with your Firebase credentials
   # (Never commit this file to version control)
   ```

### 2. Firebase Configuration

1. **Get Firebase Service Account Key**
   - Go to [Firebase Console](https://console.firebase.google.com/)
   - Select your project (`fylgja-app`)
   - Go to Project Settings → Service accounts
   - Click "Generate new private key"
   - Download the JSON file

2. **Configure .env file**
   ```bash
   # Fill in your Firebase credentials in .env
   FIREBASE_TYPE=service_account
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_PRIVATE_KEY_ID=your-private-key-id
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
   FIREBASE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
   FIREBASE_CLIENT_ID=your-client-id
   FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
   FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
   FIREBASE_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
   FIREBASE_CLIENT_X509_CERT_URL=https://www.googleapis.com/robot/v1/metadata/x509/your-service-account%40your-project.iam.gserviceaccount.com
   FIREBASE_UNIVERSE_DOMAIN=googleapis.com
   ```

### 3. Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Deploy to Firebase
npm run deploy

# Run tests
npm test
```

### 4. Security Checklist

- [ ] `.env` file is in `.gitignore`
- [ ] Never commit service account credentials
- [ ] Use `.env.sample` as template only
- [ ] Set up GitHub secrets for CI/CD
- [ ] Review [Security Documentation](SECURITY.md)

## Production Deployment

For production deployments, all Firebase credentials should be stored as GitHub repository secrets. See [SECURITY.md](SECURITY.md) for detailed setup instructions.

## Need Help?

- 📖 [Security Documentation](SECURITY.md)
- 📚 [Project Documentation](docs/)
- 🔧 [Firebase Documentation](https://firebase.google.com/docs)
- 🚀 [GitHub Actions Documentation](https://docs.github.com/en/actions)
