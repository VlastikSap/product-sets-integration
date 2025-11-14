/**
 * Terraform configuration for Product Sets project
 * 
 * This sets up:
 * - BigQuery dataset and tables
 * - Cloud Functions for ETL
 * - Cloud Run API service
 * - Cloud Scheduler for daily imports
 * - IAM permissions
 */

terraform {
  required_version = ">= 1.5"
  
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ============================================================================
# Variables
# ============================================================================

variable "project_id" {
  description = "GCP Project ID"
  type        = string
  default     = "cm-monitoring"
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "dataset_location" {
  description = "BigQuery dataset location"
  type        = string
  default     = "US"
}

variable "shoptet_xml_url" {
  description = "Shoptet products XML feed URL"
  type        = string
  sensitive   = true
}

variable "eso_xml_url" {
  description = "ESO9 sets XML feed URL"
  type        = string
  sensitive   = true
}

variable "allowed_origin" {
  description = "Allowed CORS origin for API"
  type        = string
  default     = "https://www.chutmoravy.cz"
}

# ============================================================================
# BigQuery Dataset
# ============================================================================

resource "google_bigquery_dataset" "product_sets" {
  dataset_id                  = "product_sets"
  friendly_name               = "Product Sets"
  description                 = "Product sets data from Shoptet and ESO9"
  location                    = var.dataset_location
  default_table_expiration_ms = null
  
  labels = {
    environment = "production"
    managed_by  = "terraform"
  }
}

# Products table
resource "google_bigquery_table" "products" {
  dataset_id = google_bigquery_dataset.product_sets.dataset_id
  table_id   = "products"
  
  description = "Products from Shoptet XML feed"
  
  schema = jsonencode([
    {
      name        = "product_code"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Product code (primary key)"
    },
    {
      name        = "product_id"
      type        = "INTEGER"
      mode        = "NULLABLE"
      description = "Product ID from Shoptet feed"
    },
    {
      name        = "name"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Product name"
    },
    {
      name        = "url"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Product URL"
    },
    {
      name        = "img_url"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Main product image URL"
    },
    {
      name        = "short_description"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Short description (cleaned)"
    },
    {
      name        = "description_html"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Full HTML description"
    },
    {
      name        = "visibility"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Product visibility status"
    },
    {
      name        = "availability"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Product availability status"
    },
    {
      name        = "category_ids"
      type        = "STRING"
      mode        = "REPEATED"
      description = "Array of category IDs"
    },
    {
      name        = "raw_xml"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Raw XML data for debugging"
    },
    {
      name        = "updated_at"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "Last update timestamp"
    }
  ])
  
  labels = {
    environment = "production"
    managed_by  = "terraform"
  }
}

# Set items table
resource "google_bigquery_table" "set_items" {
  dataset_id = google_bigquery_dataset.product_sets.dataset_id
  table_id   = "set_items"
  
  description = "Set composition data from ESO9 XML feed"
  
  schema = jsonencode([
    {
      name        = "set_code"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Set code (references products.product_code)"
    },
    {
      name        = "item_code"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Item code in the set"
    },
    {
      name        = "amount"
      type        = "FLOAT"
      mode        = "NULLABLE"
      description = "Quantity of item in the set"
    },
    {
      name        = "updated_at"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "Last update timestamp"
    }
  ])
  
  labels = {
    environment = "production"
    managed_by  = "terraform"
  }
}

# Product sets view
resource "google_bigquery_table" "product_sets_view" {
  dataset_id = google_bigquery_dataset.product_sets.dataset_id
  table_id   = "product_sets_view"
  
  description = "View for querying sets by product"
  
  view {
    query = <<-SQL
      SELECT
        si.item_code AS product_code,
        si.set_code,
        p.name,
        p.url,
        p.img_url,
        p.short_description AS description
      FROM
        `${var.project_id}.${google_bigquery_dataset.product_sets.dataset_id}.${google_bigquery_table.set_items.table_id}` si
      JOIN
        `${var.project_id}.${google_bigquery_dataset.product_sets.dataset_id}.${google_bigquery_table.products.table_id}` p
      ON
        si.set_code = p.product_code
    SQL
    
    use_legacy_sql = false
  }
  
  labels = {
    environment = "production"
    managed_by  = "terraform"
  }
  
  depends_on = [
    google_bigquery_table.products,
    google_bigquery_table.set_items
  ]
}

# ============================================================================
# Service Accounts
# ============================================================================

resource "google_service_account" "import_functions" {
  account_id   = "import-functions-sa"
  display_name = "Service Account for Import Functions"
  description  = "Used by Cloud Functions to import data to BigQuery"
}

resource "google_service_account" "api_service" {
  account_id   = "product-sets-api-sa"
  display_name = "Service Account for Product Sets API"
  description  = "Used by Cloud Run to query BigQuery"
}

# ============================================================================
# IAM Permissions
# ============================================================================

# Import functions need BigQuery data editor
resource "google_bigquery_dataset_iam_member" "import_functions_editor" {
  dataset_id = google_bigquery_dataset.product_sets.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.import_functions.email}"
}

resource "google_project_iam_member" "import_functions_jobuser" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.import_functions.email}"
}

# API service needs BigQuery data viewer
resource "google_bigquery_dataset_iam_member" "api_service_viewer" {
  dataset_id = google_bigquery_dataset.product_sets.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.api_service.email}"
}

resource "google_project_iam_member" "api_service_jobuser" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.api_service.email}"
}

# ============================================================================
# Cloud Storage for Function Code
# ============================================================================

resource "google_storage_bucket" "function_source" {
  name     = "${var.project_id}-function-source"
  location = var.region
  
  uniform_bucket_level_access = true
  
  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }
}

# ============================================================================
# Outputs
# ============================================================================

output "dataset_id" {
  description = "BigQuery dataset ID"
  value       = google_bigquery_dataset.product_sets.dataset_id
}

output "import_functions_sa_email" {
  description = "Import functions service account email"
  value       = google_service_account.import_functions.email
}

output "api_service_sa_email" {
  description = "API service service account email"
  value       = google_service_account.api_service.email
}

output "function_source_bucket" {
  description = "Cloud Storage bucket for function source code"
  value       = google_storage_bucket.function_source.name
}
