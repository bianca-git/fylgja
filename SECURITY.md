# Firebase Security Setup with GitHub Secrets

## Overview

This document outlines the security best practices for managing Firebase service account credentials using GitHub repository secrets, ensuring sensitive information is properly protected in CI/CD pipelines.

## Security Architecture

### Local Development
- Use `.env` file for local development (never commit to repository)
- `.env.sample` provides template for required environment variables
- All sensitive credentials stored as environment variables with `FIREBASE_` prefix

### Production/CI/CD
- All Firebase credentials stored as GitHub repository secrets
- Secrets are injected into environment variables during GitHub Actions workflows
- No sensitive data exposed in repository code or logs

## GitHub Secrets Configuration

### Required Secrets

Set up the following secrets in your GitHub repository (`Settings > Secrets and variables > Actions`):

| Secret Name | Description | Example Format |
|-------------|-------------|----------------|
| `FIREBASE_TYPE` | Service account type | `service_account` |
| `FIREBASE_PROJECT_ID` | Firebase project identifier | `fylgja-app` |
| `FIREBASE_PRIVATE_KEY_ID` | Private key identifier | `b2c6f6e3f89932f616fc0fc5f6c91b9a188a69ab` |
| `FIREBASE_PRIVATE_KEY` | Private key (include full BEGIN/END blocks) | `-----BEGIN PRIVATE KEY-----\n...` |
| `FIREBASE_CLIENT_EMAIL` | Service account email | `firebase-adminsdk-fbsvc@project.iam.gserviceaccount.com` |
| `FIREBASE_CLIENT_ID` | Client identifier | `118321029912778509651` |
| `FIREBASE_AUTH_URI` | OAuth2 auth URI | `https://accounts.google.com/o/oauth2/auth` |
| `FIREBASE_TOKEN_URI` | OAuth2 token URI | `https://oauth2.googleapis.com/token` |
| `FIREBASE_AUTH_PROVIDER_X509_CERT_URL` | X.509 cert URL | `https://www.googleapis.com/oauth2/v1/certs` |
| `FIREBASE_CLIENT_X509_CERT_URL` | Client X.509 cert URL | `https://www.googleapis.com/robot/v1/metadata/x509/...` |
| `FIREBASE_UNIVERSE_DOMAIN` | Universe domain | `googleapis.com` |

### Setting Up Secrets

1. **Navigate to Repository Settings**
   ```
   GitHub Repository → Settings → Secrets and variables → Actions
   ```

2. **Add New Repository Secret**
   - Click "New repository secret"
   - Enter secret name (e.g., `FIREBASE_PRIVATE_KEY`)
   - Paste the corresponding value
   - Click "Add secret"

3. **Special Handling for Private Key**
   - Copy the entire private key including `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`
   - Ensure newlines are preserved (use `\n` for line breaks)
   - The key should be stored as a single-line string with escaped newlines

## GitHub Actions Workflow Configuration

### Example Workflow

```yaml
name: Deploy to Firebase
on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
    
    - name: Install dependencies
      run: npm install
    
    - name: Create Firebase config
      run: |
        echo "FIREBASE_TYPE=${{ secrets.FIREBASE_TYPE }}" >> .env
        echo "FIREBASE_PROJECT_ID=${{ secrets.FIREBASE_PROJECT_ID }}" >> .env
        echo "FIREBASE_PRIVATE_KEY_ID=${{ secrets.FIREBASE_PRIVATE_KEY_ID }}" >> .env
        echo "FIREBASE_PRIVATE_KEY=${{ secrets.FIREBASE_PRIVATE_KEY }}" >> .env
        echo "FIREBASE_CLIENT_EMAIL=${{ secrets.FIREBASE_CLIENT_EMAIL }}" >> .env
        echo "FIREBASE_CLIENT_ID=${{ secrets.FIREBASE_CLIENT_ID }}" >> .env
        echo "FIREBASE_AUTH_URI=${{ secrets.FIREBASE_AUTH_URI }}" >> .env
        echo "FIREBASE_TOKEN_URI=${{ secrets.FIREBASE_TOKEN_URI }}" >> .env
        echo "FIREBASE_AUTH_PROVIDER_X509_CERT_URL=${{ secrets.FIREBASE_AUTH_PROVIDER_X509_CERT_URL }}" >> .env
        echo "FIREBASE_CLIENT_X509_CERT_URL=${{ secrets.FIREBASE_CLIENT_X509_CERT_URL }}" >> .env
        echo "FIREBASE_UNIVERSE_DOMAIN=${{ secrets.FIREBASE_UNIVERSE_DOMAIN }}" >> .env
    
    - name: Deploy to Firebase
      run: |
        npm run build
        npm run deploy
```

## Security Best Practices

### 1. Repository Security
- ✅ Add `.env` to `.gitignore` to prevent accidental commits
- ✅ Use `.env.sample` as template without actual values
- ✅ Never commit service account JSON files or private keys
- ✅ Regularly rotate service account keys

### 2. Access Control
- ✅ Limit repository access to authorized team members only
- ✅ Use branch protection rules for main/production branches
- ✅ Require pull request reviews for sensitive changes
- ✅ Enable two-factor authentication for all contributors

### 3. Firebase Service Account Security
- ✅ Use principle of least privilege for service account permissions
- ✅ Create separate service accounts for different environments
- ✅ Regularly audit service account permissions
- ✅ Monitor service account usage in Firebase console

### 4. Environment Separation
- ✅ Use different Firebase projects for dev/staging/production
- ✅ Separate GitHub secrets for different environments
- ✅ Use environment-specific deployment workflows

## Monitoring and Auditing

### GitHub Actions Monitoring
- Monitor workflow runs for failures or suspicious activity
- Review deployment logs regularly
- Set up notifications for failed deployments

### Firebase Monitoring
- Monitor Firebase authentication logs
- Set up alerts for unusual API usage
- Regularly review Firebase security rules

## Troubleshooting

### Common Issues

1. **Private Key Format Error**
   - Ensure private key includes BEGIN/END markers
   - Check that newlines are properly escaped as `\n`
   - Verify no extra spaces or characters

2. **Permission Denied**
   - Verify service account has necessary Firebase permissions
   - Check that all required secrets are set in GitHub
   - Ensure secret names match exactly in workflow

3. **Environment Variables Not Loading**
   - Verify `.env` file is created in workflow
   - Check that secrets are properly referenced with `${{ secrets.SECRET_NAME }}`
   - Ensure application properly loads environment variables

## Emergency Procedures

### Compromised Credentials
1. Immediately revoke the compromised service account key in Firebase Console
2. Generate new service account key
3. Update GitHub secrets with new credentials
4. Rotate any other potentially affected credentials
5. Review access logs for unauthorized usage

### Secret Rotation Schedule
- Service account keys: Every 90 days
- Review and audit: Monthly
- Emergency rotation: Immediately upon suspected compromise

## Additional Resources

- [Firebase Security Documentation](https://firebase.google.com/docs/security)
- [GitHub Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Google Cloud IAM Best Practices](https://cloud.google.com/iam/docs/using-iam-securely)
