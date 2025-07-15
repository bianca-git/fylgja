/**
 * Firebase Cloud Functions Entry Point for Fylgja
 * Exports all Cloud Functions for the Fylgja AI companion
 */

// Core API Functions
export { processRequest } from './api/core-api';
export { authenticationHandler } from './api/auth-api';
export { userProfileHandler } from './api/user-api';

// Webhook Functions
export { whatsappWebhook } from './webhooks/whatsapp-webhook';
export { googleHomeWebhook } from './webhooks/google-home-webhook';

// Scheduler Functions
export {
  dailyCheckInScheduler,
  reminderScheduler,
  weeklySummaryScheduler,
  monthlySummaryScheduler,
  maintenanceScheduler,
  proactiveEngagementScheduler,
  schedulerHealthCheck,
  manualTaskTrigger
} from './scheduler/cloud-scheduler-functions';

// Utility Functions
export { performanceMetricsHandler } from './monitoring/metrics-api';
export { healthCheckHandler } from './monitoring/health-api';

// Development and Testing Functions
export { testDataGenerator } from './testing/test-data-generator';
export { integrationTestRunner } from './testing/integration-test-runner';

