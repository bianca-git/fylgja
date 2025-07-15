# Fylgja Project Structure

This document outlines the complete project structure for the Fylgja AI companion.

## Directory Structure

```
fylgja/
├── functions/                    # Firebase Cloud Functions
│   ├── src/
│   │   ├── core/                # Core AI processing logic
│   │   │   ├── processing.js    # Main processing function
│   │   │   ├── prompts.js       # Prompt library and management
│   │   │   └── responses.js     # Response generation system
│   │   ├── integrations/        # Third-party service integrations
│   │   │   ├── twilio.js        # WhatsApp messaging via Twilio
│   │   │   ├── gemini.js        # Google AI integration
│   │   │   └── google-actions.js # Google Home integration
│   │   ├── utils/               # Utility functions
│   │   │   ├── database.js      # Database operations
│   │   │   ├── auth.js          # Authentication helpers
│   │   │   └── validation.js    # Input validation
│   │   ├── webhooks/            # Webhook handlers
│   │   │   ├── whatsapp.js      # WhatsApp webhook
│   │   │   └── google-home.js   # Google Actions webhook
│   │   └── index.js             # Function exports
│   ├── package.json
│   └── .eslintrc.js
├── web/                         # React web portal
│   ├── public/
│   │   ├── index.html
│   │   └── manifest.json
│   ├── src/
│   │   ├── components/          # React components
│   │   │   ├── auth/            # Authentication components
│   │   │   ├── chat/            # Chat interface
│   │   │   ├── dashboard/       # Dashboard components
│   │   │   └── legacy/          # Legacy feature components
│   │   ├── contexts/            # React contexts
│   │   │   ├── AuthContext.js   # Authentication context
│   │   │   └── AppContext.js    # Application context
│   │   ├── hooks/               # Custom React hooks
│   │   ├── utils/               # Utility functions
│   │   ├── styles/              # CSS and styling
│   │   ├── App.js               # Main App component
│   │   └── index.js             # Entry point
│   ├── package.json
│   └── .env.example
├── config/                      # Configuration files
│   ├── firebase.json            # Firebase configuration
│   ├── firestore.rules          # Firestore security rules
│   ├── firestore.indexes.json   # Firestore indexes
│   └── environments/            # Environment-specific configs
│       ├── development.json
│       ├── staging.json
│       └── production.json
├── docs/                        # Documentation
│   ├── api/                     # API documentation
│   ├── deployment/              # Deployment guides
│   ├── development/             # Development guides
│   └── user/                    # User documentation
├── scripts/                     # Deployment and utility scripts
│   ├── deploy.sh                # Deployment script
│   ├── setup.sh                 # Initial setup script
│   └── backup.sh                # Backup script
├── tests/                       # Test files
│   ├── unit/                    # Unit tests
│   ├── integration/             # Integration tests
│   └── e2e/                     # End-to-end tests
├── .github/                     # GitHub workflows and templates
│   ├── workflows/               # GitHub Actions
│   ├── ISSUE_TEMPLATE/          # Issue templates
│   └── PULL_REQUEST_TEMPLATE.md
├── README.md                    # Project overview
├── LICENSE                      # License file
├── .gitignore                   # Git ignore rules
└── package.json                 # Root package.json
```

## Key Components

### Firebase Functions (`/functions`)
- **Core Processing**: AI-powered message processing and response generation
- **Integrations**: WhatsApp, Google Home, and other third-party services
- **Webhooks**: Incoming message handlers from various platforms
- **Utilities**: Database operations, authentication, and validation

### Web Portal (`/web`)
- **React Application**: Modern, responsive web interface
- **Authentication**: Secure user login and registration
- **Chat Interface**: Real-time conversation with Fylgja
- **Dashboard**: User insights, task management, and analytics
- **Legacy Features**: Secure legacy data management

### Configuration (`/config`)
- **Firebase Setup**: Project configuration and deployment settings
- **Security Rules**: Firestore security and access control
- **Environment Management**: Development, staging, and production configs

### Documentation (`/docs`)
- **API Documentation**: Complete API reference and examples
- **Development Guides**: Setup and contribution guidelines
- **User Documentation**: Feature guides and troubleshooting

## Development Workflow

1. **Local Development**: Use Firebase emulators for local testing
2. **Code Generation**: Manus AI generates implementations
3. **Human Review**: Code review and validation
4. **Testing**: Automated and manual testing procedures
5. **Deployment**: Staged deployment to development, staging, and production

## Next Steps

1. Set up the directory structure
2. Initialize Firebase configuration
3. Create initial component templates
4. Set up development environment
5. Begin Phase 1 implementation

