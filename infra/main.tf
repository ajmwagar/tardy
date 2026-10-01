terraform {
  required_version = ">= 1.8.0, < 2.0.0"
  required_providers {
    fpl = {
      source = "registry.fpl.dev/fpl/shroud"
    }
  }
}

provider "fpl" {
  # FPL_ENDPOINT and FPL_TOKEN come from the selected human profile or CI's
  # project-scoped automation identity. They never belong in this root.
  default_project = var.project
}

resource "fpl_storage_bucket" "media" {
  project             = var.project
  name                = "media"
  jurisdiction        = "us"
  versioning          = true
  public_delivery     = false
  deletion_protection = true

  lifecycle { prevent_destroy = true }
}

resource "fpl_postgres_database" "primary" {
  project             = var.project
  name                = "primary"
  version             = 17
  plan                = var.postgres_plan
  jurisdiction        = "us"
  high_availability   = var.environment == "prod"
  deletion_protection = true

  lifecycle { prevent_destroy = true }
}

output "runtime_bindings" {
  description = "Opaque FPL runtime bindings. These are identifiers, not credentials."
  value = {
    media    = fpl_storage_bucket.media.binding_ref
    postgres = fpl_postgres_database.primary.binding_ref
  }
}
