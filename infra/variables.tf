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
  default     = "starter"
  description = "FPL catalog plan, not a DigitalOcean size."
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
