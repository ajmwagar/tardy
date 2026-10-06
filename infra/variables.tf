variable "company_id" {
  type        = string
  default     = "fpl"
  description = "Authoritative SSO company currently owning Tardy; distinct from the display owner."
  validation {
    condition     = length(trimspace(var.company_id)) > 0
    error_message = "Use the owning SSO company ID."
  }
}

variable "project" {
  type        = string
  default     = "tardy-prod"
  description = "FPL customer project charged for and authorized to run Tardy."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,62}$", var.project))
    error_message = "Use a canonical lowercase FPL project slug."
  }
}

variable "environment" {
  type        = string
  default     = "prod"
  description = "Named customer environment."
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Use dev, staging, or prod."
  }
}

variable "postgres_plan" {
  type        = string
  default     = "production"
  description = "FPL catalog plan, not a DigitalOcean size."

  validation {
    condition     = contains(["starter", "production"], var.postgres_plan)
    error_message = "Use an FPL PostgreSQL catalog plan: starter or production."
  }
}

variable "api_image" {
  type        = string
  description = "Immutable OCI image reference produced by the Tardy release pipeline."
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.api_image))
    error_message = "Pin the API image by sha256 digest; mutable tags are not deployable."
  }
}

variable "api_domain" {
  type        = string
  default     = "api.tardy.news"
  description = "Verified public domain routed through FPL ingress."
}

variable "apple_client_id" {
  type        = string
  default     = "dev.fpl.tardy"
  description = "Sign in with Apple audience. For the native app this is the immutable iOS bundle identifier, not a secret."
  validation {
    condition     = length(trimspace(var.apple_client_id)) > 0
    error_message = "Apple client ID must not be empty."
  }
}

variable "api_cpu" {
  type        = number
  default     = 1
  description = "Requested API vCPUs."
}

variable "api_memory_mib" {
  type        = number
  default     = 512
  description = "Requested API memory in MiB."
}

variable "stripe_binding_ref" {
  type        = string
  default     = null
  nullable    = true
  description = "Opaque Shroud binding containing Stripe runtime environment values. This is an identifier, never a Stripe secret."
  validation {
    condition     = var.stripe_binding_ref == null || startswith(var.stripe_binding_ref, "binding://")
    error_message = "Stripe credentials must be supplied through an opaque binding:// reference."
  }
}

variable "stripe_real_tardy_price_id" {
  type        = string
  description = "Stripe Price ID for the $20/month REAL Tardy subscription. Price IDs are public identifiers."
  validation {
    condition     = startswith(var.stripe_real_tardy_price_id, "price_")
    error_message = "REAL Tardy must reference a Stripe price_ identifier."
  }
}

variable "stripe_super_tardy_price_id" {
  type        = string
  description = "Stripe Price ID for the $250 one-time SUPER Tardy purchase. Price IDs are public identifiers."
  validation {
    condition     = startswith(var.stripe_super_tardy_price_id, "price_")
    error_message = "SUPER Tardy must reference a Stripe price_ identifier."
  }
}
