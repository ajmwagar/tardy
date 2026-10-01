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

resource "fpl_fab_site" "landing" {
  id                      = "tardy-news"
  project                 = var.project
  github_repo             = "ajmwagar/tardy"
  git_url                 = "https://github.com/ajmwagar/tardy.git"
  production_branch       = "master"
  domain                  = "tardy.news"
  path                    = "/"
  auto_promote_production = true
  build_command           = "cp agent/llms.txt web/public/llms.txt && cp skills/tardy/SKILL.md web/public/SKILL.md"
  publish_dir             = "web/public"
  framework               = "static"
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

resource "fpl_shroud_service" "api" {
  project    = var.project
  name       = "api"
  image      = var.api_image
  cpu        = var.api_cpu
  memory_mib = var.api_memory_mib
  rollout    = "blue_green"

  bindings = {
    media    = fpl_storage_bucket.media.binding_ref
    postgres = fpl_postgres_database.primary.binding_ref
  }

  env = {
    TARDY_BIND            = "0.0.0.0:3000"
    TARDY_PUBLIC_BASE_URL = "https://${var.api_domain}"
    RUST_LOG              = "info"
  }

  port {
    name   = "http"
    port   = 3000
    domain = var.api_domain
    path   = "/"
  }

  health {
    type            = "http"
    path            = "/healthz"
    expected_status = 200
  }
}

output "runtime_bindings" {
  description = "Opaque FPL runtime bindings. These are identifiers, not credentials."
  value = {
    media    = fpl_storage_bucket.media.binding_ref
    postgres = fpl_postgres_database.primary.binding_ref
  }
}

output "api_url" {
  description = "Public URL promoted only after the Shroud health gate passes."
  value       = fpl_shroud_service.api.url
}
