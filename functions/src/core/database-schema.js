/**
 * Fylgja Database Schema Design
 * Complete Firestore database structure for AI companion with adaptive learning
 */

// User Profile and Authentication
const userSchema = {
  // Document ID: Firebase Auth UID
  users: {
    // Basic profile information
    profile: {
      name: "string",           // User's display name
      email: "string",          // Email address from auth
      phone: "string",          // Phone number for WhatsApp integration
      timezone: "string",       // User's timezone (e.g., "America/New_York")
      avatar: "string",         // URL to profile image
      createdAt: "timestamp",   // Account creation date
      lastActive: "timestamp",  // Last interaction timestamp
      isActive: "boolean"       // Account status
    },

    // User preferences and settings
    preferences: {
      // Interaction preferences
      personalityStyle: "string",      // "reflective", "productive", "creative", "analytical", "balanced"
      checkInTime: "string",           // Preferred daily check-in time (HH:MM format)
      reminderFrequency: "number",     // Hours between proactive reminders
      communicationStyle: "string",   // "casual", "formal", "encouraging", "direct"
      
      // Platform preferences
      primaryPlatform: "string",       // "web", "whatsapp", "google_home"
      enableNotifications: "boolean",  // Allow proactive notifications
      enableVoice: "boolean",         // Enable voice interactions
      
      // Privacy settings
      dataRetention: "number",        // Days to retain interaction data (default: 365)
      shareInsights: "boolean",       // Allow anonymous usage insights
      legacyEnabled: "boolean",       // Enable legacy data feature
      
      // Adaptive learning settings
      learningEnabled: "boolean",     // Allow adaptive behavior learning
      adaptationSpeed: "string",      // "slow", "medium", "fast"
      contextDepth: "number"          // Days of context to consider (default: 7)
    },

    // Adaptive learning metadata (system managed)
    adaptiveProfile: {
      // Communication patterns
      preferredQuestionTypes: ["string"],    // Types of questions user responds well to
      responsePatterns: {
        averageLength: "number",             // Average response length
        sentimentTrend: "number",           // Overall sentiment trend (-1 to 1)
        engagementLevel: "number",          // Engagement score (0 to 1)
        topicPreferences: {                 // Topic frequency and engagement
          work: "number",
          personal: "number", 
          health: "number",
          relationships: "number",
          goals: "number"
        }
      },
      
      // Timing patterns
      optimalTimes: {
        checkIn: "string",                  // Best time for daily check-ins
        reminders: ["string"],              // Preferred reminder times
        responseTime: "number"              // Average response time in minutes
      },
      
      // Learning metadata
      lastAnalysis: "timestamp",            // Last adaptive analysis run
      confidenceScore: "number",           // Confidence in adaptive profile (0 to 1)
      dataPoints: "number"                 // Number of interactions analyzed
    }
  }
};

// Conversation Interactions and History
const interactionSchema = {
  // Subcollection: users/{userId}/interactions/{interactionId}
  interactions: {
    // Basic interaction data
    timestamp: "timestamp",              // When interaction occurred
    platform: "string",                 // "web", "whatsapp", "google_home"
    type: "string",                     // "checkin", "reminder", "response", "proactive"
    
    // Message content
    userMessage: "string",              // Original user input
    processedMessage: "string",         // Cleaned/processed version
    fylgjaResponse: "string",           // AI response sent to user
    
    // AI processing results
    aiProcessing: {
      taskData: {
        tasks: [{
          title: "string",
          status: "string",             // "pending", "completed", "cancelled"
          priority: "string",           // "low", "medium", "high"
          extractedAt: "timestamp"
        }],
        accomplishments: ["string"],    // Completed items mentioned
        plans: ["string"],             // Future plans mentioned
        confidence: "number"            // AI confidence in extraction (0 to 1)
      },
      
      sentimentData: {
        sentiment: "number",            // Overall sentiment (-1 to 1)
        mood: "string",                // "positive", "neutral", "negative"
        energy: "string",              // "high", "medium", "low" 
        stress: "number",              // Stress indicators (0 to 1)
        confidence: "number"           // AI confidence in analysis (0 to 1)
      },
      
      responseData: {
        category: "string",             // "encouragement", "support", "planning"
        template: "string",            // Template used for response
        personalization: "number",     // Personalization score (0 to 1)
        styleMatch: "number"           // How well response matched user style (0 to 1)
      }
    },
    
    // Context and metadata
    context: {
      conversationId: "string",       // Groups related interactions
      previousInteractions: "number", // Count of recent interactions
      timeOfDay: "string",           // "morning", "afternoon", "evening", "night"
      dayOfWeek: "string",           // "monday", "tuesday", etc.
      userState: "string"            // Inferred user state
    },
    
    // Performance metrics
    metrics: {
      processingTime: "number",       // Time to process in milliseconds
      responseTime: "number",         // Time to generate response
      userSatisfaction: "number",     // User feedback score (0 to 5)
      followUpGenerated: "boolean"    // Whether this led to follow-up
    }
  }
};

// Task Management and Tracking
const taskSchema = {
  // Subcollection: users/{userId}/tasks/{taskId}
  tasks: {
    // Task details
    title: "string",                  // Task description
    description: "string",            // Detailed description (optional)
    status: "string",                // "pending", "in_progress", "completed", "cancelled"
    priority: "string",              // "low", "medium", "high"
    
    // Timing
    createdAt: "timestamp",          // When task was created
    updatedAt: "timestamp",          // Last modification
    dueDate: "timestamp",            // Optional due date
    completedAt: "timestamp",        // When marked complete
    
    // Task metadata
    source: "string",                // "ai_extraction", "manual", "recurring"
    category: "string",              // "work", "personal", "health", "goals"
    estimatedDuration: "number",     // Estimated minutes to complete
    actualDuration: "number",        // Actual time spent (if tracked)
    
    // Relationships
    parentTask: "string",            // Reference to parent task (for subtasks)
    relatedTasks: ["string"],        // References to related tasks
    tags: ["string"],               // User-defined tags
    
    // Tracking
    reminderCount: "number",         // How many times reminded
    lastReminder: "timestamp",       // Last reminder sent
    completionScore: "number"        // AI confidence in completion (0 to 1)
  }
};

// Legacy Data with Zero-Knowledge Encryption
const legacySchema = {
  // Subcollection: users/{userId}/legacyData/{entryId}
  legacyData: {
    // Encrypted content (client-side encryption)
    encryptedContent: "string",      // Encrypted legacy message/memory
    encryptionMeta: {
      algorithm: "string",           // Encryption algorithm used
      keyDerivation: "string",       // Key derivation method
      salt: "string",               // Salt for key derivation
      iv: "string"                  // Initialization vector
    },
    
    // Entry metadata (unencrypted)
    title: "string",                // Entry title (encrypted separately)
    category: "string",             // "achievement", "memory", "lesson", "message"
    createdAt: "timestamp",         // When entry was created
    lastModified: "timestamp",      // Last modification
    
    // Release configuration
    releaseConfig: {
      recipients: [{
        name: "string",             // Recipient name (encrypted)
        email: "string",            // Recipient email (encrypted)
        relationship: "string"      // Relationship to user (encrypted)
      }],
      releaseConditions: {
        triggerType: "string",      // "manual", "automatic", "scheduled"
        verificationRequired: "boolean", // Require identity verification
        delayDays: "number",        // Days to wait before release
        backupContacts: ["string"]  // Backup verification contacts
      }
    },
    
    // Access control
    accessLog: [{
      timestamp: "timestamp",       // When accessed
      action: "string",            // "create", "read", "update", "delete"
      source: "string"             // Source of access
    }]
  }
};

// Scheduled Messages and Proactive Engagement
const scheduledSchema = {
  // Collection: scheduled_messages (system-level)
  scheduled_messages: {
    userId: "string",               // Reference to user
    messageType: "string",          // "checkin", "reminder", "followup"
    
    // Scheduling
    scheduleTime: "timestamp",      // When to send
    timezone: "string",            // User's timezone
    recurring: "boolean",          // Is this a recurring message
    recurringPattern: "string",    // Cron-like pattern for recurring
    
    // Message content
    message: "string",             // Message to send
    platform: "string",           // Target platform
    context: "object",             // Context for message generation
    
    // Status tracking
    status: "string",              // "pending", "sent", "failed", "cancelled"
    attempts: "number",            // Delivery attempts
    lastAttempt: "timestamp",      // Last delivery attempt
    deliveredAt: "timestamp",      // When successfully delivered
    
    // Metadata
    createdAt: "timestamp",        // When scheduled
    createdBy: "string"           // "system", "user", "ai"
  }
};

// System Analytics and Monitoring
const analyticsSchema = {
  // Collection: system_analytics (admin access only)
  system_analytics: {
    // Usage metrics
    date: "timestamp",             // Date of metrics
    activeUsers: "number",         // Daily active users
    totalInteractions: "number",   // Total interactions
    platformBreakdown: {
      web: "number",
      whatsapp: "number", 
      google_home: "number"
    },
    
    // Performance metrics
    averageResponseTime: "number", // Average AI response time
    errorRate: "number",          // Percentage of failed requests
    satisfactionScore: "number",  // Average user satisfaction
    
    // AI metrics
    taskExtractionAccuracy: "number",  // Task extraction accuracy
    sentimentAccuracy: "number",       // Sentiment analysis accuracy
    personalizationScore: "number"    // Average personalization score
  }
};

// Error Logging and Debugging
const errorSchema = {
  // Collection: error_logs (system access only)
  error_logs: {
    timestamp: "timestamp",        // When error occurred
    userId: "string",             // User affected (if applicable)
    errorType: "string",          // Type of error
    errorMessage: "string",       // Error description
    stackTrace: "string",         // Stack trace (if available)
    context: "object",            // Context when error occurred
    severity: "string",           // "low", "medium", "high", "critical"
    resolved: "boolean",          // Whether error has been resolved
    resolvedAt: "timestamp"       // When error was resolved
  }
};

// Webhook and Integration Logs
const webhookSchema = {
  // Collection: webhook_logs (system access only)
  webhook_logs: {
    timestamp: "timestamp",        // When webhook was received
    platform: "string",          // Source platform
    userId: "string",            // User ID (if identified)
    
    // Request data
    requestId: "string",         // Unique request identifier
    requestBody: "object",       // Webhook payload
    requestHeaders: "object",    // Request headers
    
    // Processing results
    processingTime: "number",    // Time to process in milliseconds
    success: "boolean",          // Whether processing succeeded
    responseCode: "number",      // HTTP response code
    errorMessage: "string",      // Error message (if failed)
    
    // Metadata
    ipAddress: "string",         // Source IP address
    userAgent: "string"          // User agent string
  }
};

module.exports = {
  userSchema,
  interactionSchema,
  taskSchema,
  legacySchema,
  scheduledSchema,
  analyticsSchema,
  errorSchema,
  webhookSchema
};

