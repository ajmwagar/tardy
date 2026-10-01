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
