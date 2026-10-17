terraform {
  required_version = ">= 1.5"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 5.0" }
  }
}

variable "project_id" { type = string }
variable "region" {
  type    = string
  default = "us-central1"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_project_service" "apis" {
  for_each = toset([
    "generativelanguage.googleapis.com", # Gemini API
    "maps-backend.googleapis.com",
    "places.googleapis.com",
    "secretmanager.googleapis.com",
    "iap.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# Empty secret containers; values are added with `gcloud secrets versions add`
# so they never appear in Terraform state or git.
resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(["GEMINI_API_KEY", "GOOGLE_MAPS_API_KEY", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "JWT_SECRET", "DATABASE_URL"])
  secret_id = each.key
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}
