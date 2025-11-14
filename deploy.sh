#!/bin/bash

###############################################################################
# Deployment script for Product Sets project
# 
# This script deploys:
# 1. Cloud Functions for data import
# 2. Cloud Run API service
# 3. Cloud Scheduler jobs
###############################################################################

set -e

# Configuration
PROJECT_ID="cm-monitoring"
REGION="us-central1"
DATASET_ID="product_sets"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Print functions
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required commands exist
check_requirements() {
    print_info "Checking requirements..."
    
    if ! command -v gcloud &> /dev/null; then
        print_error "gcloud CLI is not installed"
        exit 1
    fi
    
    if ! command -v terraform &> /dev/null; then
        print_warning "Terraform is not installed (optional)"
    fi
    
    print_info "Requirements check passed"
}

# Set GCP project
set_project() {
    print_info "Setting GCP project to $PROJECT_ID..."
    gcloud config set project $PROJECT_ID
}

# Enable required APIs
enable_apis() {
    print_info "Enabling required GCP APIs..."
    
    gcloud services enable cloudfunctions.googleapis.com
    gcloud services enable cloudscheduler.googleapis.com
    gcloud services enable run.googleapis.com
    gcloud services enable bigquery.googleapis.com
    gcloud services enable cloudbuild.googleapis.com
    gcloud services enable secretmanager.googleapis.com
    
    print_info "APIs enabled"
}

# Deploy Shoptet import function
deploy_shoptet_function() {
    print_info "Deploying Shoptet import function..."
    
    cd cloud-functions/import-shoptet
    
    gcloud functions deploy import-shoptet-products \
        --gen2 \
        --runtime=nodejs20 \
        --region=$REGION \
        --source=. \
        --entry-point=importShoptetProducts \
        --trigger-http \
        --allow-unauthenticated \
        --timeout=540s \
        --memory=512Mi \
        --set-env-vars=GCP_PROJECT=$PROJECT_ID \
        --set-secrets=SHOPTET_XML_URL=shoptet-xml-url:latest
    
    cd ../..
    
    print_info "Shoptet import function deployed"
}

# Deploy ESO import function
deploy_eso_function() {
    print_info "Deploying ESO import function..."
    
    cd cloud-functions/import-eso
    
    gcloud functions deploy import-eso-sets \
        --gen2 \
        --runtime=nodejs20 \
        --region=$REGION \
        --source=. \
        --entry-point=importEsoSets \
        --trigger-http \
        --allow-unauthenticated \
        --timeout=540s \
        --memory=512Mi \
        --set-env-vars=GCP_PROJECT=$PROJECT_ID \
        --set-secrets=ESO_XML_URL=eso-xml-url:latest
    
    cd ../..
    
    print_info "ESO import function deployed"
}

# Deploy API service to Cloud Run
deploy_api_service() {
    print_info "Deploying API service to Cloud Run..."
    
    cd cloud-functions/api
    
    # Build and deploy
    gcloud run deploy product-sets-api \
        --source=. \
        --platform=managed \
        --region=$REGION \
        --allow-unauthenticated \
        --memory=512Mi \
        --cpu=1 \
        --min-instances=0 \
        --max-instances=10 \
        --set-env-vars=GCP_PROJECT=$PROJECT_ID,ALLOWED_ORIGIN=https://www.chutmoravy.cz \
        --port=8080
    
    cd ../..
    
    # Get service URL
    API_URL=$(gcloud run services describe product-sets-api --region=$REGION --format='value(status.url)')
    print_info "API deployed at: $API_URL"
}

# Create Cloud Scheduler jobs
create_scheduler_jobs() {
    print_info "Creating Cloud Scheduler jobs..."
    
    # Get function URLs
    SHOPTET_URL=$(gcloud functions describe import-shoptet-products --gen2 --region=$REGION --format='value(serviceConfig.uri)')
    ESO_URL=$(gcloud functions describe import-eso-sets --gen2 --region=$REGION --format='value(serviceConfig.uri)')
    
    # Create or update Shoptet import job (daily at 3 AM)
    if gcloud scheduler jobs describe import-shoptet-daily --location=$REGION &> /dev/null; then
        print_info "Updating existing Shoptet scheduler job..."
        gcloud scheduler jobs update http import-shoptet-daily \
            --location=$REGION \
            --schedule="0 3 * * *" \
            --uri=$SHOPTET_URL \
            --http-method=GET \
            --time-zone="Europe/Prague"
    else
        print_info "Creating new Shoptet scheduler job..."
        gcloud scheduler jobs create http import-shoptet-daily \
            --location=$REGION \
            --schedule="0 3 * * *" \
            --uri=$SHOPTET_URL \
            --http-method=GET \
            --time-zone="Europe/Prague"
    fi
    
    # Create or update ESO import job (daily at 3:15 AM, after Shoptet)
    if gcloud scheduler jobs describe import-eso-daily --location=$REGION &> /dev/null; then
        print_info "Updating existing ESO scheduler job..."
        gcloud scheduler jobs update http import-eso-daily \
            --location=$REGION \
            --schedule="15 3 * * *" \
            --uri=$ESO_URL \
            --http-method=GET \
            --time-zone="Europe/Prague"
    else
        print_info "Creating new ESO scheduler job..."
        gcloud scheduler jobs create http import-eso-daily \
            --location=$REGION \
            --schedule="15 3 * * *" \
            --uri=$ESO_URL \
            --http-method=GET \
            --time-zone="Europe/Prague"
    fi
    
    print_info "Scheduler jobs created"
}

# Main deployment flow
main() {
    print_info "Starting deployment..."
    
    check_requirements
    set_project
    enable_apis
    
    # Deploy functions
    deploy_shoptet_function
    deploy_eso_function
    
    # Deploy API
    deploy_api_service
    
    # Setup scheduler
    create_scheduler_jobs
    
    print_info "Deployment completed successfully!"
    print_info ""
    print_info "Next steps:"
    print_info "1. Create secrets in Secret Manager:"
    print_info "   - shoptet-xml-url"
    print_info "   - eso-xml-url"
    print_info "2. Test the functions manually"
    print_info "3. Update frontend JavaScript with API URL"
}

# Run main function
main
