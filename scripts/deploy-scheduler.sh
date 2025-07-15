#!/bin/bash

# Deploy Cloud Scheduler Configuration for Fylgja
# This script creates and configures all Cloud Scheduler jobs

set -e

# Configuration
PROJECT_ID="fylgja-app"
REGION="us-central1"
CONFIG_FILE="config/cloud-scheduler-config.yaml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if gcloud is installed
    if ! command -v gcloud &> /dev/null; then
        log_error "gcloud CLI is not installed. Please install it first."
        exit 1
    fi
    
    # Check if authenticated
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
        log_error "Not authenticated with gcloud. Please run 'gcloud auth login'"
        exit 1
    fi
    
    # Check if project is set
    CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null)
    if [ "$CURRENT_PROJECT" != "$PROJECT_ID" ]; then
        log_warning "Current project is $CURRENT_PROJECT, switching to $PROJECT_ID"
        gcloud config set project $PROJECT_ID
    fi
    
    # Check if Cloud Scheduler API is enabled
    if ! gcloud services list --enabled --filter="name:cloudscheduler.googleapis.com" --format="value(name)" | grep -q cloudscheduler; then
        log_info "Enabling Cloud Scheduler API..."
        gcloud services enable cloudscheduler.googleapis.com
    fi
    
    # Check if Pub/Sub API is enabled
    if ! gcloud services list --enabled --filter="name:pubsub.googleapis.com" --format="value(name)" | grep -q pubsub; then
        log_info "Enabling Pub/Sub API..."
        gcloud services enable pubsub.googleapis.com
    fi
    
    log_success "Prerequisites check completed"
}

# Create Pub/Sub topics
create_pubsub_topics() {
    log_info "Creating Pub/Sub topics..."
    
    local topics=(
        "fylgja-daily-checkins"
        "fylgja-reminders"
        "fylgja-weekly-summaries"
        "fylgja-monthly-summaries"
        "fylgja-maintenance"
        "fylgja-proactive-engagement"
        "fylgja-scheduler-dead-letter"
        "fylgja-scheduler-alerts"
    )
    
    for topic in "${topics[@]}"; do
        if gcloud pubsub topics describe $topic &>/dev/null; then
            log_info "Topic $topic already exists"
        else
            log_info "Creating topic: $topic"
            gcloud pubsub topics create $topic
            log_success "Created topic: $topic"
        fi
    done
}

# Create Cloud Scheduler jobs
create_scheduler_job() {
    local job_name=$1
    local description=$2
    local schedule=$3
    local timezone=$4
    local topic=$5
    local payload=$6
    
    log_info "Creating scheduler job: $job_name"
    
    # Check if job already exists
    if gcloud scheduler jobs describe $job_name --location=$REGION &>/dev/null; then
        log_warning "Job $job_name already exists, updating..."
        gcloud scheduler jobs update pubsub $job_name \
            --location=$REGION \
            --schedule="$schedule" \
            --time-zone="$timezone" \
            --topic=$topic \
            --message-body="$payload" \
            --description="$description"
    else
        gcloud scheduler jobs create pubsub $job_name \
            --location=$REGION \
            --schedule="$schedule" \
            --time-zone="$timezone" \
            --topic=$topic \
            --message-body="$payload" \
            --description="$description"
    fi
    
    log_success "Created/updated job: $job_name"
}

# Deploy daily check-in jobs
deploy_daily_checkins() {
    log_info "Deploying daily check-in jobs..."
    
    # Morning check-ins
    create_scheduler_job \
        "fylgja-daily-checkins-morning-utc" \
        "Daily morning check-ins for UTC timezone users" \
        "0 6 * * *" \
        "UTC" \
        "fylgja-daily-checkins" \
        '{"timezone":"UTC","time_of_day":"morning","question_style":"energetic"}'
    
    create_scheduler_job \
        "fylgja-daily-checkins-morning-est" \
        "Daily morning check-ins for EST timezone users" \
        "0 11 * * *" \
        "UTC" \
        "fylgja-daily-checkins" \
        '{"timezone":"America/New_York","time_of_day":"morning","question_style":"energetic"}'
    
    create_scheduler_job \
        "fylgja-daily-checkins-morning-pst" \
        "Daily morning check-ins for PST timezone users" \
        "0 14 * * *" \
        "UTC" \
        "fylgja-daily-checkins" \
        '{"timezone":"America/Los_Angeles","time_of_day":"morning","question_style":"energetic"}'
    
    # Evening check-ins
    create_scheduler_job \
        "fylgja-daily-checkins-evening-utc" \
        "Daily evening check-ins for UTC timezone users" \
        "0 19 * * *" \
        "UTC" \
        "fylgja-daily-checkins" \
        '{"timezone":"UTC","time_of_day":"evening","question_style":"reflective"}'
    
    create_scheduler_job \
        "fylgja-daily-checkins-evening-est" \
        "Daily evening check-ins for EST timezone users" \
        "0 0 * * *" \
        "UTC" \
        "fylgja-daily-checkins" \
        '{"timezone":"America/New_York","time_of_day":"evening","question_style":"reflective"}'
    
    create_scheduler_job \
        "fylgja-daily-checkins-evening-pst" \
        "Daily evening check-ins for PST timezone users" \
        "0 3 * * *" \
        "UTC" \
        "fylgja-daily-checkins" \
        '{"timezone":"America/Los_Angeles","time_of_day":"evening","question_style":"reflective"}'
}

# Deploy reminder jobs
deploy_reminders() {
    log_info "Deploying reminder jobs..."
    
    create_scheduler_job \
        "fylgja-task-reminders-morning" \
        "Morning task reminders" \
        "0 9 * * *" \
        "UTC" \
        "fylgja-reminders" \
        '{"reminderType":"task_reminder","time_of_day":"morning","priority":"medium"}'
    
    create_scheduler_job \
        "fylgja-task-reminders-afternoon" \
        "Afternoon task reminders" \
        "0 14 * * *" \
        "UTC" \
        "fylgja-reminders" \
        '{"reminderType":"task_reminder","time_of_day":"afternoon","priority":"medium"}'
    
    create_scheduler_job \
        "fylgja-goal-reminders-weekly" \
        "Weekly goal progress reminders" \
        "0 10 * * 1" \
        "UTC" \
        "fylgja-reminders" \
        '{"reminderType":"goal_reminder","frequency":"weekly","priority":"high"}'
    
    create_scheduler_job \
        "fylgja-reflection-reminders" \
        "Bi-weekly reflection prompts" \
        "0 18 * * 0,3" \
        "UTC" \
        "fylgja-reminders" \
        '{"reminderType":"reflection_reminder","frequency":"bi-weekly","priority":"medium"}'
}

# Deploy summary jobs
deploy_summaries() {
    log_info "Deploying summary generation jobs..."
    
    create_scheduler_job \
        "fylgja-weekly-summaries" \
        "Generate weekly summaries for users" \
        "0 8 * * 0" \
        "UTC" \
        "fylgja-weekly-summaries" \
        '{"summaryType":"weekly","includeInsights":true,"includeGoalProgress":true,"includeReflections":true}'
    
    create_scheduler_job \
        "fylgja-monthly-summaries" \
        "Generate monthly summaries for users" \
        "0 9 1 * *" \
        "UTC" \
        "fylgja-monthly-summaries" \
        '{"summaryType":"monthly","includeInsights":true,"includeGoalProgress":true,"includeReflections":true,"includeTrends":true}'
}

# Deploy maintenance jobs
deploy_maintenance() {
    log_info "Deploying maintenance jobs..."
    
    create_scheduler_job \
        "fylgja-database-cleanup" \
        "Daily database cleanup and optimization" \
        "0 2 * * *" \
        "UTC" \
        "fylgja-maintenance" \
        '{"maintenanceType":"database_cleanup","priority":"medium","retentionDays":90}'
    
    create_scheduler_job \
        "fylgja-cache-refresh" \
        "Refresh system caches" \
        "0 */6 * * *" \
        "UTC" \
        "fylgja-maintenance" \
        '{"maintenanceType":"cache_refresh","priority":"low"}'
    
    create_scheduler_job \
        "fylgja-performance-analysis" \
        "Daily performance analysis and reporting" \
        "0 3 * * *" \
        "UTC" \
        "fylgja-maintenance" \
        '{"maintenanceType":"performance_analysis","priority":"medium","analysisWindow":"24h"}'
    
    create_scheduler_job \
        "fylgja-health-check" \
        "System health monitoring" \
        "*/15 * * * *" \
        "UTC" \
        "fylgja-maintenance" \
        '{"maintenanceType":"health_check","priority":"high","checkComponents":["database","ai_service","cache","scheduler"]}'
}

# Deploy proactive engagement jobs
deploy_proactive_engagement() {
    log_info "Deploying proactive engagement jobs..."
    
    create_scheduler_job \
        "fylgja-inactive-user-engagement" \
        "Engage users who haven't been active recently" \
        "0 16 * * *" \
        "UTC" \
        "fylgja-proactive-engagement" \
        '{"engagementType":"inactive_user","inactivityThreshold":"3d","priority":"medium"}'
    
    create_scheduler_job \
        "fylgja-motivational-checkins" \
        "Weekly motivational messages for engaged users" \
        "0 15 * * 5" \
        "UTC" \
        "fylgja-proactive-engagement" \
        '{"engagementType":"motivational","targetAudience":"active_users","priority":"low"}'
    
    create_scheduler_job \
        "fylgja-goal-progress-nudges" \
        "Bi-weekly goal progress encouragement" \
        "0 12 * * 2,5" \
        "UTC" \
        "fylgja-proactive-engagement" \
        '{"engagementType":"goal_progress","targetAudience":"users_with_goals","priority":"medium"}'
}

# Deploy special event jobs
deploy_special_events() {
    log_info "Deploying special event jobs..."
    
    create_scheduler_job \
        "fylgja-new-year-reflection" \
        "Special New Year reflection prompt" \
        "0 12 1 1 *" \
        "UTC" \
        "fylgja-reminders" \
        '{"reminderType":"special_event","eventType":"new_year","priority":"high"}'
    
    create_scheduler_job \
        "fylgja-mid-year-review" \
        "Mid-year goal and progress review" \
        "0 10 1 7 *" \
        "UTC" \
        "fylgja-reminders" \
        '{"reminderType":"special_event","eventType":"mid_year_review","priority":"high"}'
}

# List all created jobs
list_jobs() {
    log_info "Listing all Cloud Scheduler jobs..."
    gcloud scheduler jobs list --location=$REGION --format="table(name,schedule,state,lastAttemptTime)"
}

# Pause all jobs (for maintenance)
pause_all_jobs() {
    log_info "Pausing all Fylgja scheduler jobs..."
    gcloud scheduler jobs list --location=$REGION --filter="name:fylgja-*" --format="value(name)" | while read job; do
        gcloud scheduler jobs pause $job --location=$REGION
        log_info "Paused job: $job"
    done
    log_success "All jobs paused"
}

# Resume all jobs
resume_all_jobs() {
    log_info "Resuming all Fylgja scheduler jobs..."
    gcloud scheduler jobs list --location=$REGION --filter="name:fylgja-*" --format="value(name)" | while read job; do
        gcloud scheduler jobs resume $job --location=$REGION
        log_info "Resumed job: $job"
    done
    log_success "All jobs resumed"
}

# Delete all jobs (for cleanup)
delete_all_jobs() {
    log_warning "This will delete ALL Fylgja scheduler jobs. Are you sure? (y/N)"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        log_info "Deleting all Fylgja scheduler jobs..."
        gcloud scheduler jobs list --location=$REGION --filter="name:fylgja-*" --format="value(name)" | while read job; do
            gcloud scheduler jobs delete $job --location=$REGION --quiet
            log_info "Deleted job: $job"
        done
        log_success "All jobs deleted"
    else
        log_info "Operation cancelled"
    fi
}

# Test a specific job
test_job() {
    local job_name=$1
    if [ -z "$job_name" ]; then
        log_error "Job name is required for testing"
        exit 1
    fi
    
    log_info "Testing job: $job_name"
    gcloud scheduler jobs run $job_name --location=$REGION
    log_success "Test execution triggered for: $job_name"
}

# Main deployment function
deploy_all() {
    log_info "Starting Cloud Scheduler deployment for Fylgja..."
    
    check_prerequisites
    create_pubsub_topics
    deploy_daily_checkins
    deploy_reminders
    deploy_summaries
    deploy_maintenance
    deploy_proactive_engagement
    deploy_special_events
    
    log_success "Cloud Scheduler deployment completed successfully!"
    log_info "Use './deploy-scheduler.sh list' to see all created jobs"
}

# Help function
show_help() {
    echo "Fylgja Cloud Scheduler Deployment Script"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  deploy      Deploy all scheduler jobs (default)"
    echo "  list        List all scheduler jobs"
    echo "  pause       Pause all scheduler jobs"
    echo "  resume      Resume all scheduler jobs"
    echo "  delete      Delete all scheduler jobs"
    echo "  test JOB    Test a specific job"
    echo "  help        Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 deploy"
    echo "  $0 list"
    echo "  $0 test fylgja-health-check"
    echo "  $0 pause"
}

# Main script logic
case "${1:-deploy}" in
    "deploy")
        deploy_all
        ;;
    "list")
        list_jobs
        ;;
    "pause")
        pause_all_jobs
        ;;
    "resume")
        resume_all_jobs
        ;;
    "delete")
        delete_all_jobs
        ;;
    "test")
        test_job "$2"
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac

