terraform {
  required_version = ">= 1.8.0, < 2.0.0"

  # FPL's protected executor supplies this backend's non-secret key during
  # init. Credentials come only from short-lived AWS_* environment variables.
  backend "s3" {}

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

resource "fpl_fab_project" "tardy" {
  slug                = var.project
  display_name        = "Tardy"
  owner               = "tardy"
  default_environment = var.environment

  labels = {
    application = "tardy"
    managed_by  = "opentofu"
  }
}

resource "fpl_fab_repository" "tardy" {
  project           = fpl_fab_project.tardy.slug
  name              = "tardy"
  git_url           = "https://github.com/ajmwagar/tardy.git"
  github_owner      = "ajmwagar"
  github_repo       = "tardy"
  default_branch    = "master"
  pipeline_path     = ".fab/pipelines.json"
  registration_mode = "existing"
  environments      = [var.environment]

  labels = {
    application = "tardy"
    managed_by  = "opentofu"
  }
}

resource "fpl_fab_site" "landing" {
  id                      = "tardy"
  project                 = var.project
  github_repo             = "ajmwagar/tardy"
  git_url                 = "https://github.com/ajmwagar/tardy.git"
  production_branch       = "master"
  domain                  = "tardy.news"
  path                    = "/"
  auto_promote_production = true
  install_command         = "true"
  build_command           = "mkdir -p dist && cp -R web/public/. dist/ && cp agent/llms.txt dist/llms.txt && cp skills/tardy/SKILL.md dist/SKILL.md"
  publish_dir             = "dist"
  framework               = "static"
  env                     = {}

  depends_on = [fpl_fab_repository.tardy]
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
