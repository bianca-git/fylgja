# Fylgja Development Guide

Welcome to the Fylgja development environment! This guide will help you get started with developing, testing, and deploying the Fylgja AI companion.

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** - [Download here](https://nodejs.org/)
- **npm 8+** - Comes with Node.js
- **Git** - [Download here](https://git-scm.com/)
- **Firebase CLI** - Will be installed automatically

### Initial Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/bianca-git/fylgja.git
   cd fylgja
   ```

2. **Run the setup script:**
   ```bash
   ./setup.sh
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.template .env.local
   # Edit .env.local with your credentials
   ```

4. **Start development environment:**
   ```bash
   ./scripts/dev.sh
   ```

## 📁 Project Structure

```
fylgja/
├── functions/                 # Firebase Cloud Functions
│   ├── src/
│   │   ├── core/             # Core business logic
│   │   ├── services/         # Service classes
│   │   ├── utils/            # Utility functions
│   │   └── types/            # TypeScript type definitions
│   ├── __tests__/            # Test files
│   └── package.json
├── web/                      # React web application (Phase 1)
├── config/                   # Configuration files
│   ├── firestore.rules       # Firestore security rules
│   ├── firestore.indexes.json # Database indexes
│   └── environments/         # Environment configurations
├── scripts/                  # Development scripts
├── docs/                     # Documentation
├── .github/                  # GitHub workflows and templates
└── firebase.json             # Firebase configuration
```

## 🛠️ Development Workflow

### Daily Development

1. **Start the development environment:**
   ```bash
   ./scripts/dev.sh
   ```
   This starts:
   - Firebase emulators (Firestore, Functions, Auth)
   - Web development server (when available)
   - Hot reloading for all components

2. **Access development tools:**
   - **Firebase Emulator UI:** http://localhost:4000
   - **Web App:** http://localhost:3000 (when available)
   - **Functions:** http://localhost:5001

### Code Quality

We maintain high code quality standards with automated tools:

#### Linting
```bash
cd functions
npm run lint          # Check for issues
npm run lint:fix      # Auto-fix issues
```

#### Testing
```bash
./scripts/test.sh     # Run all tests
cd functions
npm test              # Run function tests only
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

#### Formatting
```bash
cd functions
npm run format        # Format code with Prettier
```

### Git Workflow

1. **Create a feature branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes and commit:**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```
   
   We use [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` - New features
   - `fix:` - Bug fixes
   - `docs:` - Documentation changes
   - `style:` - Code style changes
   - `refactor:` - Code refactoring
   - `test:` - Test additions/changes
   - `chore:` - Maintenance tasks

3. **Push and create a pull request:**
   ```bash
   git push origin feature/your-feature-name
   ```

### Pre-commit Hooks

Automatic checks run before each commit:
- ESLint validation
- TypeScript compilation
- Test execution
- Code formatting

## 🧪 Testing

### Test Structure

```
functions/__tests__/
├── setup.ts              # Test configuration
├── core/                 # Core logic tests
├── services/             # Service tests
└── integration/          # Integration tests
```

### Writing Tests

```typescript
import { createMockUser, createMockInteraction } from '../setup';
import { DatabaseService } from '../../src/services/database-service';

describe('DatabaseService', () => {
  let dbService: DatabaseService;

  beforeEach(() => {
    dbService = new DatabaseService();
  });

  it('should save user profile', async () => {
    const user = createMockUser();
    const result = await dbService.saveUserProfile(user.uid, user);
    expect(result).toBe(true);
  });
});
```

### Test Categories

1. **Unit Tests** - Individual function/class testing
2. **Integration Tests** - Component interaction testing
3. **Performance Tests** - Response time and load testing
4. **Security Tests** - Authentication and authorization testing

### Coverage Requirements

- **Minimum Coverage:** 80% for all metrics
- **Functions:** 80%
- **Lines:** 80%
- **Branches:** 80%
- **Statements:** 80%

## 🚀 Deployment

### Development Deployment

Automatic deployment to development environment on `main` branch:

```bash
git push origin main
```

### Manual Deployment

```bash
./scripts/deploy.sh
```

This deploys:
- Cloud Functions
- Firestore rules and indexes
- Web application (when available)

### Environment Management

- **Development:** Auto-deployed from `main` branch
- **Staging:** Manual deployment from `develop` branch
- **Production:** Manual deployment with approval

## 🔧 Configuration

### Environment Variables

Required environment variables in `.env.local`:

```bash
# Firebase Configuration
FIREBASE_PROJECT_ID="fylgja-app"
FIREBASE_PRIVATE_KEY_ID="your-key-id"
FIREBASE_PRIVATE_KEY="your-private-key"
FIREBASE_CLIENT_EMAIL="your-client-email"
FIREBASE_CLIENT_ID="your-client-id"

# Google AI Configuration
GOOGLE_GEMINI_APIKEY="your-gemini-api-key"

# Twilio Configuration (Phase 2)
TWILIO_ACCOUNT_SID="your-account-sid"
TWILIO_AUTH_TOKEN="your-auth-token"
TWILIO_WHATSAPP_NUMBER="whatsapp:+your-number"

# Development Settings
NODE_ENV="development"
PORT="5000"
```

### Firebase Configuration

Key configuration files:
- `firebase.json` - Firebase project configuration
- `config/firestore.rules` - Database security rules
- `config/firestore.indexes.json` - Database indexes

## 📊 Monitoring and Debugging

### Local Development

1. **Firebase Emulator UI:** http://localhost:4000
   - View Firestore data
   - Monitor function logs
   - Test authentication

2. **Function Logs:**
   ```bash
   firebase functions:log
   ```

3. **Performance Monitoring:**
   ```bash
   cd functions
   npm run test:performance
   ```

### Production Monitoring

- **Firebase Console:** https://console.firebase.google.com/
- **Error Tracking:** Automatic error logging to Firestore
- **Performance Metrics:** Built-in performance tracking

## 🔍 Troubleshooting

### Common Issues

1. **Firebase Emulator Won't Start:**
   ```bash
   firebase emulators:kill
   firebase emulators:start
   ```

2. **TypeScript Compilation Errors:**
   ```bash
   cd functions
   npm run build
   ```

3. **Test Failures:**
   ```bash
   cd functions
   npm run test:debug
   ```

4. **Environment Issues:**
   ```bash
   source .env.local
   echo $FIREBASE_PROJECT_ID  # Verify variables
   ```

### Getting Help

1. **Check the logs:**
   ```bash
   firebase functions:log --only yourFunctionName
   ```

2. **Run diagnostics:**
   ```bash
   firebase use --add  # Verify project setup
   firebase projects:list
   ```

3. **Create an issue:**
   - Use the GitHub issue templates
   - Include error logs and steps to reproduce
   - Tag with appropriate labels

## 📚 Additional Resources

- [Firebase Documentation](https://firebase.google.com/docs)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Jest Testing Framework](https://jestjs.io/docs/getting-started)
- [ESLint Rules](https://eslint.org/docs/rules/)
- [Prettier Configuration](https://prettier.io/docs/en/configuration.html)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

### Code Style Guidelines

- Use TypeScript for all new code
- Follow the existing code style (enforced by ESLint/Prettier)
- Write comprehensive tests
- Document complex functions with JSDoc
- Use meaningful variable and function names

### Pull Request Process

1. Ensure CI/CD pipeline passes
2. Request review from team members
3. Address feedback and update code
4. Squash commits before merging
5. Update documentation if needed

---

**Happy coding! 🎉**

For questions or support, please create an issue or contact the development team.

