terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Uncomment once the state bucket exists (see README, step 1). Local state is
  # fine for the first apply and dangerous for anything after it.
  # backend "s3" {
  #   bucket         = "edai-tfstate-ap-south-1"
  #   key            = "edai/prod/terraform.tfstate"
  #   region         = "ap-south-1"
  #   dynamodb_table = "edai-tflock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "edai"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# CloudFront only accepts ACM certificates issued in us-east-1, regardless of
# where the rest of the stack lives.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "edai"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
